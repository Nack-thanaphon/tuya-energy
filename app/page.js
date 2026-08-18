'use client';
import { useEffect, useState, useCallback } from 'react';

/*
 * Tuya PJ-1103 units (calibrated on live meter 2026-08-19):
 *   cur_voltage 2308 → 230.8 V (0.1V) · cur_current 134 → 0.134 A (mA)
 *   cur_power 179 → 17.9 W (0.1W) · add_ele 329 → 0.329 kWh (Wh)
 * National reference: World Bank EG.USE.ELEC.KH.PC Thailand 2020 = 2,673 kWh/capita/yr
 *   → ×3.2 persons/household ≈ 7.1 kWh/day/household (rough national average)
 */

const fmt = (n, d = 2) => (n == null || isNaN(n)) ? '—' :
  Number(n).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d });

const REF_KWH_DAY = 7.1; // national rough average, see header note

function interpret(status, logs = []) {
  const m = { hours: {}, days: {} };
  for (const s of status) {
    const v = parseFloat(s.value);
    if (isNaN(v)) continue;
    if (s.code === 'cur_voltage') m.volt = v / 10;
    else if (s.code === 'cur_current') m.amp = v / 1000;
    else if (s.code === 'cur_power') m.power = v / 10;
    else if (s.code === 'add_ele') m.totalKwh = v / 1000;
  }
  // power samples (W) sorted by time
  const pows = logs
    .filter(l => l.code === 'cur_power' && !isNaN(parseFloat(l.value)))
    .map(l => ({ t: l.event_time, w: parseFloat(l.value) / 10 }))
    .sort((a, b) => a.t - b.t);
  m.sampleCount = pows.length;
  // trapezoid integration per day + per hour (Wh)
  for (let i = 1; i < pows.length; i++) {
    const a = pows[i - 1], b = pows[i];
    const wh = Math.max(0, (a.w + b.w) / 2 * (b.t - a.t) / 3.6e6);
    const dayKey = new Date(b.t).toLocaleDateString('sv-SE');
    m.days[dayKey] = (m.days[dayKey] || 0) + wh;
    const h = new Date(b.t).getHours();
    m.hours[h] = (m.hours[h] || 0) + wh;
  }
  const todayKey = new Date().toLocaleDateString('sv-SE');
  m.todayKwh = m.days[todayKey] != null ? m.days[todayKey] / 1000 : null;
  m.dayList = Object.entries(m.days)
    .map(([day, wh]) => ({ day, kwh: wh / 1000 }))
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(-7);
  return m;
}

export default function Home() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [rate, setRate] = useState(4);
  const [flash, setFlash] = useState('');

  useEffect(() => {
    setRate(parseFloat(localStorage.getItem('rate') ?? '4'));
  }, []);

  const load = useCallback(async () => {
    try { setData(await (await fetch('/api/data')).json()); setErr(null); }
    catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

  const save = () => {
    localStorage.setItem('rate', rate);
    setFlash('บันทึกแล้ว ✓'); setTimeout(() => setFlash(''), 2000);
  };

  const dev = data?.device || {};
  const m = interpret(data?.status || [], data?.logs || []);
  const baht = m.todayKwh != null ? m.todayKwh * rate : null;
  const vsAvg = m.todayKwh != null && REF_KWH_DAY > 0
    ? Math.min(200, Math.round(m.todayKwh / REF_KWH_DAY * 100)) : null;

  return (
    <div className="shell">
      <header className="top">
        <div className="who">
          <span className="dotLive" /> {dev.name || 'มิเตอร์ไฟ'}
        </div>
        <button className="refresh" onClick={load}>รีเฟรช</button>
      </header>

      <main className="content">
        {/* hero — today */}
        <section className="hero">
          <div className="heroLabel">วันนี้ใช้ไป</div>
          <div className="bigNum">
            {m.todayKwh != null ? fmt(m.todayKwh) : '—'}
            <span className="unit">หน่วย</span>
          </div>
          <div className="heroSub">
            {baht != null ? `≈ ${fmt(baht)} บาท` : 'กำลังรอข้อมูลจากมิเตอร์…'}
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
          <div><b>{fmt(m.power, 1)}</b><span>วัตต์</span></div>
          <div><b>{fmt(m.volt, 1)}</b><span>โวลต์</span></div>
          <div><b>{fmt(m.amp, 2)}</b><span>แอมแปร์</span></div>
          <div><b>{fmt(m.totalKwh)}</b><span>หน่วยสะสม</span></div>
        </section>

        {err && <div className="warn">⚠ ติดต่อเซิร์ฟเวอร์ไม่ได้: {err}</div>}
        {data?.errors?.length > 0 && <div className="warn">⚠ คลาวด์: {data.errors.join(' · ')}</div>}

        {/* hourly */}
        <section className="card">
          <h3>ใช้ไฟตามชั่วโมงวันนี้</h3>
          <HourChart hours={m.hours} />
        </section>

        {/* last 7 days */}
        <section className="card">
          <h3>ย้อนหลัง {m.dayList?.length || 0} วัน (หน่วย/วัน)</h3>
          <DayChart days={m.dayList || []} />
        </section>

        {/* settings */}
        <details className="card settings">
          <summary>ตั้งค่าค่าไฟ</summary>
          <div className="setRow">
            <label>อัตราค่าไฟ (บาท/หน่วย)
              <input type="number" step="0.01" min="0" value={rate}
                onChange={e => setRate(+e.target.value)} />
            </label>
            <button onClick={save}>บันทึก</button>
            {flash && <span className="flash">{flash}</span>}
          </div>
          <p className="tip">เปิดบิลไฟ → ดู "บาท/หน่วย" ใส่ตรงนี้ แล้วจำนวนเงินด้านบนจะคิดตามอัตราจริง</p>
        </details>

        <footer className="src">
          ที่มา · [1] ค่ามิเตอร์สดจาก Tuya Open API <code>openapi-sg.iotbing.com</code> (หน่วยแปลงจาก DP จริง สอบกับจอมิเตอร์แล้ว 18/8/2569) ·
          [2] ค่าเฉลี่ยบ้านไทย ~7.1 หน่วย/วัน คำนวณจาก World Bank <code>EG.USE.ELEC.KH.PC</code> (ไทย 2,673 kWh/คน/ปี 2020) × 3.2 คน/ครัวเรือน — เป็นค่าประมาณรวมทุกภาคส่วน <b>[2] verified · ขนาดครัวเรือน [unverified]</b> ·
          [3] กราฟรายชั่วโมง/รายวัน คำนวณเชิงเส้น (trapezoid) จากตัวอย่างกำลังไฟจริง {m.sampleCount || 0} จุด
        </footer>
      </main>
    </div>
  );
}

/* ---------- charts (plain SVG) ---------- */
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

function DayChart({ days }) {
  if (days.length < 1) return <div className="empty">ยังไม่มีข้อมูลย้อนหลัง</div>;
  const max = Math.max(...days.map(d => d.kwh), 0.001);
  return (
    <div className="dayRow">
      {days.map(d => (
        <div key={d.day} className="dayCol" title={`${d.day} — ${fmt(d.kwh, 2)} หน่วย`}>
          <div className="dayVal">{fmt(d.kwh, 1)}</div>
          <div className="dayBar" style={{ height: `${Math.max(4, d.kwh / max * 80)}px` }} />
          <div className="dayLabel">{d.day.slice(8)}/{d.day.slice(5, 7)}</div>
        </div>
      ))}
    </div>
  );
}
