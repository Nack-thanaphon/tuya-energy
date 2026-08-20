'use client';
import { useEffect, useState, useCallback } from 'react';
import { REF_KWH_DAY, TIERS, billCalc, interpretEnergy, marginalRate } from '../lib/energy.js';

/*
 * Tuya PJ-1103 units (calibrated on live meter 2026-08-19):
 *   cur_voltage 2308 → 230.8 V (0.1V) · cur_current 134 → 0.134 A (mA)
 *   cur_power 179 → 17.9 W (0.1W) · add_ele → Wh since daily reset
 * MEA residential tariff 1.2 — VERIFIED against real bill (129 kWh → 497.12฿ ตรงเป๊ะ):
 *   tiers 3.2484 (≤150) / 4.2218 (151–400) / 4.4217 (>400)
 *   + Ft 0.1623 ฿/kWh + service 24.62 ฿ + VAT 7%
 * National reference: World Bank 2,673 kWh/cap/yr × 3.2 ≈ 7.1 kWh/day/household
 */

const fmt = (n, d = 2) => (n == null || isNaN(n)) ? '—' :
  Number(n).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d });


export default function Home() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [ft, setFt] = useState(0.1623);
  const [service, setService] = useState(24.62);
  const [flash, setFlash] = useState('');
  const [range, setRange] = useState('month'); // 'month' (default) | 'day'

  useEffect(() => {
    setFt(parseFloat(localStorage.getItem('ft') ?? '0.1623'));
    setService(parseFloat(localStorage.getItem('service') ?? '24.62'));
  }, []);

  const load = useCallback(async () => {
    try { setData(await (await fetch('/api/data')).json()); setErr(null); }
    catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

  const save = () => {
    localStorage.setItem('ft', ft); localStorage.setItem('service', service);
    setFlash('บันทึกแล้ว ✓'); setTimeout(() => setFlash(''), 2000);
  };

  const dev = data?.device || {};
  const m = interpretEnergy(data?.status || [], data?.logs || []);
  const billing = data?.billing || null;
  const loading = !data && !err; // first load, no data yet

  const cycleRows = billing?.rows || [];
  const monthKwh = billing?.total_kwh ?? 0;
  const monthBill = monthKwh > 0 ? billCalc(monthKwh, ft, service) : null;
  const monthDays = Object.fromEntries(cycleRows.map(row => [row.day, Number(row.kwh || 0) * 1000]));
  const exactKwh = billing?.exact_kwh ?? 0;
  const estimatedKwh = billing?.estimated_kwh ?? 0;

  // projection: today's usage × days in this billing cycle
  const cycleDayCount = billing?.cycle_day_count ?? 31;
  const projKwh = m.todayKwh != null ? m.todayKwh * cycleDayCount : null;
  const projBill = projKwh != null ? billCalc(projKwh, ft, service) : null;
  // today's cost at marginal rate (+Ft, ×VAT)
  const mg = projKwh != null ? marginalRate(projKwh) : TIERS[0].rate;
  const todayBaht = m.todayKwh != null
    ? m.todayKwh * (mg + ft) * 1.07 : null;
  // burn rate now (฿/hour) — W→kW conversion
  const bahtPerHour = m.power != null ? m.power / 1000 * (mg + ft) * 1.07 : null;
  const vsAvg = m.todayKwh != null ? Math.min(200, Math.round(m.todayKwh / REF_KWH_DAY * 100)) : null;


  return (
    <div className="shell">
      <header className="top">
        <div className="who"><span className="dotLive" /></div>
        <button className="refresh" onClick={load}>รีเฟรช</button>
      </header>

      <main className="content">
        {/* hero — today / month depending on range */}
        {range === 'day' ? (
          <section className="hero">
            <div className="heroLabel">วันนี้ใช้ไป</div>
            {loading ? <SkeletonHero /> : (
              <>
                <div className="bigNum">
                  {m.todayKwh != null ? fmt(m.todayKwh) : '—'}
                  <span className="unit">หน่วย (kWh)</span>
                </div>
                <div className="heroSub">
                  {todayBaht != null ? `≈ ${fmt(todayBaht)} บาท` : 'กำลังรอข้อมูลจากมิเตอร์…'}
                  {bahtPerHour != null && ` · กำลังใช้ ${fmt(bahtPerHour, 2)} ฿/ชม`}
                </div>
              </>
            )}
            {!loading && vsAvg != null && (
              <div className="vsWrap">
                <div className="vsText">
                  {vsAvg <= 100
                    ? `ต่ำกว่าค่าเฉลี่ยบ้านไทย (~${fmt(REF_KWH_DAY, 1)} หน่วย/วัน) ${100 - vsAvg}%`
                    : `สูงกว่าค่าเฉลี่ยบ้านไทย ${vsAvg - 100}% ⚡`}
                </div>
              </div>
            )}
          </section>
        ) : (
          <section className="hero">
            <div className="heroLabel">รอบบิลนี้ {billing?.label ? `(${billing.label})` : ''}</div>
            {loading ? <SkeletonHero /> : (
              <>
                <div className="bigNum">
                  {fmt(monthKwh)}
                  <span className="unit">หน่วย (kWh)</span>
                </div>
                <div className="heroSub">
                  {monthBill != null ? `≈ ${fmt(monthBill.total)} บาท` : 'ยังไม่มีข้อมูลสะสม'}
                  {!loading && billing && ` · exact ${fmt(exactKwh)} / estimated ${fmt(estimatedKwh)}`}
                </div>
              </>
            )}
          </section>
        )}

        {/* chart — toggle เดือน/วัน */}
        <section className="card">
          <div className="cardHead">
            <h3 style={{ marginBottom: 0 }}>
              {range === 'day' ? 'ใช้ไฟตามชั่วโมงวันนี้' : 'ใช้ไฟรายวัน (รอบบิลนี้)'}
            </h3>
            <div className="seg">
              <button className={range === 'month' ? 'on' : ''} onClick={() => setRange('month')}>เดือน</button>
              <button className={range === 'day' ? 'on' : ''} onClick={() => setRange('day')}>วัน</button>
            </div>
          </div>
          {loading
            ? <SkeletonChart />
            : range === 'day'
              ? <HourChart hours={m.hours} />
              : <CycleChart rows={cycleRows} todayDay={billing?.today_day} />}
        </section>

        {/* live strip */}
        <section className="strip">
          {loading ? [0, 1, 2, 3].map(i => (
            <div key={i}><span className="sk skLine" style={{ width: '70%', display: 'block', margin: '0 auto' }} /></div>
          )) : (
            <>
              <div><b>{fmt(m.power, 0)}</b><span>วัตต์</span></div>
              <div><b>{fmt(m.volt, 1)}</b><span>โวลต์</span></div>
              <div><b>{fmt(m.amp, 2)}</b><span>แอมแปร์</span></div>
              <div><b>{bahtPerHour != null ? fmt(bahtPerHour, 2) : '—'}</b><span>บาท/ชม</span></div>
            </>
          )}
        </section>

        {err && <div className="warn">⚠ ติดต่อเซิร์ฟเวอร์ไม่ได้: {err}</div>}
        {data?.errors?.length > 0 && <div className="warn">⚠ คลาวด์: {data.errors.join(' · ')}</div>}

        {/* projected bill — MEA formula */}
        <section className="card">
          <div className="cardHead">
            <h3 style={{ marginBottom: 0 }}>ประมาณการบิลรอบนี้ (ถ้าใช้เท่าวันนี้ทุกวัน)</h3>
          </div>
          {loading ? <SkeletonBill /> : projBill != null ? (
            <>
              <div className="projRow">
                <span>ใช้ {fmt(projKwh, 0)} หน่วย/{cycleDayCount} วัน</span>
                <b className="projTotal">{fmt(projBill.total, 0)} บาท</b>
              </div>
              <div className="breakdown">
                <div><span>ค่าพลังงาน (ขั้นบันได)</span><span>{fmt(projBill.energy)}</span></div>
                <div><span>ค่าไฟผันแปร Ft</span><span>{fmt(projBill.ftCost)}</span></div>
                <div><span>ค่าบริการ</span><span>{fmt(projBill.service)}</span></div>
                <div><span>VAT 7%</span><span>{fmt(projBill.vat)}</span></div>
                <div className="mgRow"><span>หน่วยถัดไปอยู่อัตรา</span><span>{fmt(mg, 4)} ฿ + Ft</span></div>
              </div>
            </>
          ) : <div className="empty">กำลังรอข้อมูล…</div>}
        </section>

        {/* settings */}
        <details className="card settings">
          <summary>ตั้งค่า (Ft / ค่าบริการ)</summary>
          <div className="setRow">
            <label>Ft (บาท/หน่วย)
              <input type="number" step="0.0001" min="0" value={ft}
                onChange={e => setFt(+e.target.value)} />
            </label>
            <label>ค่าบริการ (บาท)
              <input type="number" step="0.01" min="0" value={service}
                onChange={e => setService(+e.target.value)} />
            </label>
            <button onClick={save}>บันทึก</button>
            {flash && <span className="flash">{flash}</span>}
          </div>
          <p className="tip">ค่าเริ่มต้น Ft 0.1623 + ค่าบริการ 24.62 มาจากบิล MEA จริง (ก.ย. 67) — Ft เปลี่ยนทุกงวด ดูค่าล่าสุดได้ที่ MEA Open Data</p>
        </details>

        <footer className="src">
          ที่มา · [1] ค่ามิเตอร์สดจาก Tuya Open API <code>openapi-sg.iotbing.com</code> (สอบกับ Tuya app แล้ว 19/8/2569: V/A/W ตรง) ·
          [2] สูตรค่าไฟ MEA ประเภท 1.2 ขั้นบันได 3.2484/4.2218/4.4217 + Ft + ค่าบริการ + VAT 7% — <b>พิสูจน์กับบิลจริง 129 หน่วย = 497.12฿ ตรงเป๊ะ</b> (MEA Open Data: opendata.mea.or.th) ·
          [3] "วันนี้" ใช้รีจิสเตอร์ add_ele ของมิเตอร์ (รีเซ็ตรายวัน) · "สะสมรวม" ตั้งแต่ติดตั้งดูได้ใน Tuya app ·
          [4] ค่าเฉลี่ยบ้านไทย ~7.1 หน่วย/วัน จาก World Bank <code>EG.USE.ELEC.KH.PC</code> 2,673 kWh/คน/ปี × 3.2 คน <b>[3][4] เป็นค่าประมาณ</b> ·
          [5] กราฟรายชั่วโมง/รายวัน คำนวณจากตัวอย่างกำลังไฟจริง {m.sampleCount || 0} จุด (trapezoid) — logs คลาวด์เก็บได้ ~1,000 จุดล่าสุด
        </footer>
      </main>
    </div>
  );
}

/* ---------- skeletons ---------- */
function SkeletonHero() {
  return (
    <>
      <div className="sk skBig" />
      <div className="sk skLine" />
    </>
  );
}
function SkeletonBill() {
  return (
    <div className="breakdown">
      {[0, 1, 2, 3].map(i => <div key={i}><span>&nbsp;</span><span className="sk" style={{ width: 90, height: 18 }} /></div>)}
    </div>
  );
}
function SkeletonChart() {
  return (
    <div className="lineChartWrap">
      <div className="sk" style={{ height: '100%', width: '100%', borderRadius: 16 }} />
    </div>
  );
}

/* ---------- charts ---------- */
function HourChart({ hours }) {
  const data = Array.from({ length: 24 }, (_, h) => ({
    key: `h-${h}`,
    label: String(h),
    wh: hours[h] || 0,
    title: `${String(h).padStart(2, '0')}:00 — ${fmt((hours[h] || 0) / 1000, 3)} หน่วย`,
    isHighlight: false,
  }));
  if (!data.some(d => d.wh > 0)) return <div className="empty">ยังไม่มีข้อมูลวันนี้</div>;
  return <LineChart data={data} xTickEvery={3} />;
}

function CycleChart({ rows, todayDay }) {
  const data = (rows || []).map((row, index) => ({
    key: row.day,
    label: String(Number(row.day.slice(-2))),
    wh: Number(row.kwh || 0) * 1000,
    title: `${row.day} — ${fmt(Number(row.kwh || 0), 3)} หน่วย · ${row.quality}`,
    isHighlight: row.day === todayDay,
    quality: row.quality,
    index,
  }));
  if (!data.some(d => d.wh > 0)) return <div className="empty">ยังไม่มีข้อมูลรอบบิลนี้</div>;
  return <LineChart data={data} xTickEvery={5} showQualityDots />;
}

function LineChart({ data, xTickEvery = 1, showQualityDots = false }) {
  const width = 1000;
  const height = 260;
  const topPad = 20;
  const bottomPad = 34;
  const sidePad = 10;
  const innerWidth = width - sidePad * 2;
  const innerHeight = height - topPad - bottomPad;
  const rawMax = Math.max(...data.map(d => d.wh), 1);
  const ceiling = rawMax * 1.15;
  const stepX = data.length > 1 ? innerWidth / (data.length - 1) : innerWidth;
  const points = data.map((d, i) => {
    const x = sidePad + stepX * i;
    const y = topPad + innerHeight - (d.wh / ceiling) * innerHeight;
    return { ...d, x, y };
  });
  const polyline = points.map(p => `${p.x},${p.y}`).join(' ');

  return (
    <div className="lineChartWrap">
      <svg className="lineChart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-label="energy trend chart">
        <line x1={sidePad} y1={topPad + innerHeight} x2={width - sidePad} y2={topPad + innerHeight} className="chartAxis" />
        <line x1={sidePad} y1={topPad} x2={sidePad} y2={topPad + innerHeight} className="chartAxis chartAxisFaint" />
        <line x1={sidePad} y1={topPad + innerHeight * 0.5} x2={width - sidePad} y2={topPad + innerHeight * 0.5} className="chartGuide" />
        <line x1={sidePad} y1={topPad} x2={width - sidePad} y2={topPad} className="chartGuide" />
        <polyline points={polyline} className="chartLine" />
        {points.map((p, index) => (
          <g key={p.key}>
            <title>{p.title}</title>
            <circle
              cx={p.x}
              cy={p.y}
              r={p.isHighlight ? 5.5 : 3.5}
              className={`chartDot${p.isHighlight ? ' isToday' : ''}${showQualityDots && p.quality === 'estimated' ? ' isEstimated' : ''}`}
            />
            {(index % xTickEvery === 0 || p.isHighlight || index === data.length - 1) && (
              <text x={p.x} y={height - 8} textAnchor="middle" className="chartLabel">{p.label}</text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}
