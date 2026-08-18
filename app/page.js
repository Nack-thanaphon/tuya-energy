'use client';
import { useEffect, useState, useCallback } from 'react';

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

const REF_KWH_DAY = 7.1;
const TIERS = [
  { upTo: 150, rate: 3.2484 },
  { upTo: 400, rate: 4.2218 },
  { upTo: Infinity, rate: 4.4217 },
];

/* MEA 1.2 bill: E(x) piecewise + Ft + service, × VAT 7% */
function billCalc(kwh, ft, service) {
  let energy = 0, prev = 0;
  for (const t of TIERS) {
    if (kwh > prev) energy += (Math.min(kwh, t.upTo) - prev) * t.rate;
    prev = t.upTo;
    if (kwh <= t.upTo) break;
  }
  const ftCost = kwh * ft;
  const base = energy + ftCost + service;
  const vat = base * 0.07;
  return { energy, ftCost, service, vat, total: base + vat, marginal: marginalRate(kwh) };
}
function marginalRate(kwh) {
  for (const t of TIERS) if (kwh <= t.upTo) return t.rate;
  return TIERS[TIERS.length - 1].rate;
}

function interpret(status, logs = []) {
  const m = { hours: {} };
  for (const s of status) {
    const v = parseFloat(s.value);
    if (isNaN(v)) continue;
    if (s.code === 'cur_voltage') m.volt = v / 10;
    else if (s.code === 'cur_current') m.amp = v / 1000;
    else if (s.code === 'cur_power') m.power = v / 10;
    else if (s.code === 'add_ele') m.addEleKwh = v / 1000;
  }
  // integrated Wh per hour (from power samples) for the hourly chart
  const pows = logs
    .filter(l => l.code === 'cur_power' && !isNaN(parseFloat(l.value)))
    .map(l => ({ t: l.event_time, w: parseFloat(l.value) / 10 }))
    .sort((a, b) => a.t - b.t);
  m.sampleCount = pows.length;
  for (let i = 1; i < pows.length; i++) {
    const a = pows[i - 1], b = pows[i];
    const wh = Math.max(0, (a.w + b.w) / 2 * (b.t - a.t) / 3.6e6);
    m.hours[new Date(b.t).getHours()] = (m.hours[new Date(b.t).getHours()] || 0) + wh;
  }
  // today = add_ele (daily-reset register) — matches Tuya app behaviour
  m.todayKwh = m.addEleKwh ?? null;
  return m;
}

export default function Home() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [ft, setFt] = useState(0.1623);
  const [service, setService] = useState(24.62);
  const [flash, setFlash] = useState('');

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
  const m = interpret(data?.status || [], data?.logs || []);

  // projection: today's usage × days in this month
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const projKwh = m.todayKwh != null ? m.todayKwh * daysInMonth : null;
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
        {/* hero — today */}
        <section className="hero">
          <div className="heroLabel">วันนี้ใช้ไป</div>
          <div className="bigNum">
            {m.todayKwh != null ? fmt(m.todayKwh) : '—'}
            <span className="unit">หน่วย (kWh)</span>
          </div>
          <div className="heroSub">
            {todayBaht != null ? `≈ ${fmt(todayBaht)} บาท` : 'กำลังรอข้อมูลจากมิเตอร์…'}
            {bahtPerHour != null && ` · กำลังใช้ ${fmt(bahtPerHour, 2)} ฿/ชม`}
          </div>
          {vsAvg != null && (
            <div className="vsWrap">
              <div className="vsBar">
                <div className="vsAvgMark" />
                <div className="vsFill" style={{ width: Math.min(100, vsAvg) + '%' }} />
              </div>
              <div className="vsText">
                {vsAvg <= 100
                  ? `ต่ำกว่าค่าเฉลี่ยบ้านไทย (~${fmt(REF_KWH_DAY, 1)} หน่วย/วัน) ${100 - vsAvg}% 🌱`
                  : `สูงกว่าค่าเฉลี่ยบ้านไทย ${vsAvg - 100}% ⚡`}
              </div>
            </div>
          )}
        </section>

        {/* live strip */}
        <section className="strip">
          <div><b>{fmt(m.power, 0)}</b><span>วัตต์</span></div>
          <div><b>{fmt(m.volt, 1)}</b><span>โวลต์</span></div>
          <div><b>{fmt(m.amp, 2)}</b><span>แอมแปร์</span></div>
          <div><b>{bahtPerHour != null ? fmt(bahtPerHour, 2) : '—'}</b><span>บาท/ชม</span></div>
        </section>

        {err && <div className="warn">⚠ ติดต่อเซิร์ฟเวอร์ไม่ได้: {err}</div>}
        {data?.errors?.length > 0 && <div className="warn">⚠ คลาวด์: {data.errors.join(' · ')}</div>}

        {/* projected bill — MEA formula */}
        <section className="card">
          <h3>ประมาณการบิลเดือนนี้ (ถ้าใช้เท่าวันนี้ทุกวัน)</h3>
          {projBill != null ? (
            <>
              <div className="projRow">
                <span>ใช้ {fmt(projKwh, 0)} หน่วย/{daysInMonth} วัน</span>
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

        {/* hourly */}
        <section className="card">
          <h3>ใช้ไฟตามชั่วโมงวันนี้</h3>
          <HourChart hours={m.hours} />
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
          [5] กราฟรายชั่วโมง คำนวณจากตัวอย่างกำลังไฟจริง {m.sampleCount || 0} จุด (trapezoid)
        </footer>
      </main>
    </div>
  );
}

/* ---------- charts ---------- */
function HourChart({ hours }) {
  const data = Array.from({ length: 24 }, (_, h) => ({ h, wh: hours[h] || 0 }));
  const max = Math.max(...data.map(d => d.wh), 1);
  if (!data.some(d => d.wh > 0)) return <div className="empty">ยังไม่มีข้อมูลวันนี้</div>;
  return (
    <div className="bars">
      {data.map(d => (
        <div key={d.h} className="barCol" title={`${String(d.h).padStart(2, '0')}:00 — ${fmt(d.wh / 1000, 3)} หน่วย`}>
          <div className="bar" style={{ height: `${Math.max(2, d.wh / max * 100)}%` }} />
          <span className="barLabel">{d.h % 3 === 0 ? d.h : ''}</span>
        </div>
      ))}
    </div>
  );
}
