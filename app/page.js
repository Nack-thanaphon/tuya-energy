'use client';
import { useEffect, useState, useCallback } from 'react';

/* ---------- helpers ---------- */
const DP_LABELS = {
  forward_energy_total: 'พลังงานสะสม', add_ele: 'พลังงานสะสม',
  total_energy: 'พลังงานสะสม', total_forward_energy: 'พลังงานสะสม',
  cur_power: 'กำลังไฟขณะนี้', power: 'กำลังไฟขณะนี้', active_power: 'กำลังไฟขณะนี้',
  cur_voltage: 'แรงดันไฟฟ้า', voltage: 'แรงดันไฟฟ้า',
  cur_current: 'กระแสไฟฟ้า', current: 'กระแสไฟฟ้า', electricity: 'กระแสไฟฟ้า',
  switch_1: 'สวิตช์', fault: 'สถานะผิดปกติ',
};
const fmt = (n, d = 2) => n == null || isNaN(n) ? '—' : Number(n).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d });

function interpret(status) {
  const m = {}, all = [];
  for (const s of status) {
    const label = DP_LABELS[s.code] || s.code;
    const e = { code: s.code, label, raw: s.value };
    const v = parseFloat(s.value);
    if (!isNaN(v)) {
      if (/energy/.test(s.code)) { const x = v > 100000 ? v / 1000 : v; e.val = x; e.unit = 'kWh'; m.kwh = x; }
      else if (/power/.test(s.code)) { const x = v > 50000 ? v / 100 : v; e.val = x; e.unit = 'W'; m.power = x; }
      else if (/voltage/.test(s.code)) { const x = v > 100000 ? v / 1000 : v > 1000 ? v / 10 : v; e.val = x; e.unit = 'V'; m.volt = x; }
      else if (/current|electricity/.test(s.code)) { const x = v > 500 ? v / 1000 : v; e.val = x; e.unit = 'A'; m.amp = x; }
      else { e.val = v; e.unit = ''; }
    }
    all.push(e);
  }
  return { m, all };
}

/* ---------- page ---------- */
export default function Home() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [rate, setRate] = useState(4);
  const [baseline, setBaseline] = useState(0);
  const [goal, setGoal] = useState(0);
  const [flash, setFlash] = useState('');

  useEffect(() => {
    setRate(parseFloat(localStorage.getItem('rate') ?? '4'));
    setBaseline(parseFloat(localStorage.getItem('baseline') ?? '0'));
    setGoal(parseFloat(localStorage.getItem('goal') || '0') || 0);
  }, []);

  const load = useCallback(async () => {
    try { setData(await (await fetch('/api/data')).json()); setErr(null); }
    catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

  const save = () => {
    localStorage.setItem('rate', rate); localStorage.setItem('baseline', baseline); localStorage.setItem('goal', goal || 0);
    setFlash('บันทึกแล้ว'); setTimeout(() => setFlash(''), 2000);
  };

  const dev = data?.device || {};
  const { m, all } = interpret(data?.status || []);
  const used = m.kwh != null ? Math.max(0, m.kwh - baseline) : null;
  const baht = used != null ? used * rate : null;
  const pct = goal > 0 && used != null ? Math.min(100, used / goal * 100) : null;

  return (
    <div className="shell">
      {/* top bar */}
      <header className="top">
        <div className="brand">
          <div className="logo">⚡</div>
          <div>
            <div className="name">{dev.name || 'มิเตอร์ไฟ'}</div>
            <div className="meta">{dev.product}{dev.model ? ` · ${dev.model}` : ''}</div>
          </div>
        </div>
        <div className="right">
          <span className={dev.online ? 'status on' : 'status'}>
            <i className={dev.online ? 'dot on' : 'dot'} />{dev.online ? 'เชื่อมต่อแล้ว' : 'ออฟไลน์'}
          </span>
          <button className="ghost" onClick={load}>รีเฟรช</button>
        </div>
      </header>

      <div className="content">
        {/* hero — this bill */}
        <section className="hero">
          <div className="heroTop">
            <div className="heroLabel">ค่าไฟบิลนี้</div>
            <div className="when">{data ? 'อัปเดต ' + new Date(data.fetched_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : 'กำลังโหลด…'}</div>
          </div>
          <div className="amount">{baht != null ? fmt(baht) : '—'}<span className="cur">฿</span></div>
          {used != null && (
            <div className="heroSub">{fmt(used)} หน่วย × {fmt(rate, 2)} บาท/หน่วย</div>
          )}
          {pct != null && (
            <div className="goalWrap">
              <div className="goalBar"><div className={pct >= 100 ? 'goalFill over' : 'goalFill'} style={{ width: pct + '%' }} /></div>
              <div className="goalText">
                เป้าหมาย {fmt(goal, 0)} หน่วย · ใช้ไป {fmt(pct, 0)}%{pct >= 100 ? ' — เกินเป้าแล้ว' : ''}
              </div>
            </div>
          )}
        </section>

        {/* live metrics */}
        <section className="metrics">
          <Metric icon="🔌" label="กำลังไฟ" value={fmt(m.power, 1)} unit="W" sub="ขณะนี้" />
          <Metric icon="⚡" label="พลังงานสะสม" value={fmt(m.kwh)} unit="หน่วย" sub="ตั้งแต่ติดตั้ง" />
          <Metric icon="🔋" label="แรงดัน" value={fmt(m.volt, 1)} unit="V" sub="ขณะนี้" />
          <Metric icon="🌀" label="กระแส" value={fmt(m.amp)} unit="A" sub="ขณะนี้" />
        </section>

        {err && <div className="warn">⚠ ติดต่อเซิร์ฟเวอร์ไม่ได้: {err}</div>}
        {data?.errors?.length > 0 && <div className="warn">⚠ คลาวด์: {data.errors.join(' · ')}</div>}

        {/* chart */}
        <section className="card">
          <div className="cardHead">
            <h3>การใช้ไฟย้อนหลัง 7 วัน</h3>
          </div>
          <Chart logs={data?.logs || []} />
        </section>

        {/* settings */}
        <section className="card">
          <div className="cardHead"><h3>ตั้งค่าค่าไฟ</h3></div>
          <div className="form">
            <Field label="อัตราค่าไฟ (บาท/หน่วย)"><input type="number" step="0.01" min="0" value={rate} onChange={e => setRate(Math.round(e.target.value * 100) / 100)} /></Field>
            <Field label="มิเตอร์ต้นบิล (หน่วย)"><input type="number" step="0.01" min="0" value={baseline} onChange={e => setBaseline(+e.target.value)} /></Field>
            <Field label="เป้าหมายเดือนนี้ (หน่วย)"><input type="number" step="1" min="0" value={goal || ''} placeholder="ไม่ตั้ง" onChange={e => setGoal(+e.target.value)} /></Field>
            <div className="formAction">
              <button onClick={save}>บันทึก</button>
              {flash && <span className="flash">{flash}</span>}
            </div>
          </div>
          <p className="tip">เปิดบิลไฟฟ้า → ดู "บาท/หน่วย" ใส่ช่องแรก · จดตัวเลขมิเตอร์วันเริ่มบิลใส่ช่องที่สอง ค่าไฟจะคิดตั้งแต่วันนั้น</p>
        </section>

        {/* raw + events */}
        <div className="twoCol">
          <section className="card">
            <div className="cardHead"><h3>ค่าจากมิเตอร์</h3></div>
            {all.length ? (
              <ul className="kv">
                {all.map(e => (
                  <li key={e.code}>
                    <span className="kvLabel">{e.label}</span>
                    <span className="kvVal">{e.val != null ? `${fmt(e.val, e.unit === 'kWh' ? 2 : 1)} ${e.unit}` : String(e.raw)}</span>
                  </li>
                ))}
              </ul>
            ) : <Empty text="มิเตอร์เชื่อมต่อแล้ว แต่ยังไม่ส่งค่าไฟฟ้าออกมา — ลองเปิด/ปิดสวิตช์มิเตอร์ หรือรอ 1–2 นาทีแล้วกดรีเฟรช" />}
          </section>

          <section className="card">
            <div className="cardHead"><h3>ประวัติการเชื่อมต่อ</h3></div>
            {(data?.events || []).length ? (
              <ul className="timeline">
                {data.events.slice(0, 8).map((e, i) => (
                  <li key={i}><i className="tlDot" /><span>{new Date(e.event_time).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span><span className="tlWhat">{e.event_id === 1 ? 'เชื่อมต่อ' : 'เหตุการณ์ ' + e.event_id}</span></li>
                ))}
              </ul>
            ) : <Empty text="ไม่มีประวัติ" />}
          </section>
        </div>

        <footer>
          ที่มา · [1] ข้อมูลมิเตอร์จาก Tuya Open API <code>openapi-sg.iotbing.com</code> (ดึงสดผ่าน API route) ·
          [2] อัตราเริ่มต้น 4 บาท/หน่วยเป็นค่าประมาณ <b>[unverified]</b> — ใส่อัตราจริงจากบิลไฟ ·
          [3] การแปลงหน่วยรหัส DP อ้างอิงมาตรฐาน Tuya metering (aqcz) <b>[unverified]</b> เทียบกับจอมิเตอร์ได้
        </footer>
      </div>
    </div>
  );
}

/* ---------- components ---------- */
function Metric({ icon, label, value, unit, sub }) {
  return (
    <div className="metric">
      <div className="mIcon">{icon}</div>
      <div className="mBody">
        <div className="mLabel">{label} <span className="mSub">{sub}</span></div>
        <div className="mVal">{value}<span className="mUnit">{unit}</span></div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return <label className="field">{label}{children}</label>;
}

function Empty({ text }) {
  return <div className="empty">{text}</div>;
}

function Chart({ logs }) {
  const pts = (logs || []).filter(l => l.code && /power|energy/.test(l.code) && !isNaN(parseFloat(l.value)))
    .map(l => ({ t: l.event_time, v: parseFloat(l.value) })).sort((a, b) => a.t - b.t);
  if (pts.length < 2) return <Empty text="ยังไม่มีข้อมูล — รอมิเตอร์รายงานค่าแรกแล้วกราฟจะขึ้นเอง" />;
  const W = 900, H = 230, P = 34;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
  const vmax = Math.max(...pts.map(p => p.v), 1);
  const X = t => P + (t - t0) / (t1 - t0 || 1) * (W - 2 * P);
  const Y = v => H - P - v / vmax * (H - 2 * P);
  const path = pts.map((p, i) => (i ? 'L' : 'M') + X(p.t).toFixed(1) + ' ' + Y(p.v).toFixed(1)).join(' ');
  // 4 horizontal gridlines
  const grid = [0.25, 0.5, 0.75].map(f => Y(vmax * f));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart">
      {grid.map((y, i) => <line key={i} x1={P} x2={W - P} y1={y} y2={y} stroke="rgba(15,23,42,.07)" strokeWidth="1" />)}
      <path d={`${path} L ${X(t1).toFixed(1)} ${Y(0)} L ${X(t0).toFixed(1)} ${Y(0)} Z`} fill="url(#grad)" />
      <path d={path} fill="none" stroke="#0f766e" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      <defs>
        <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#14b8a6" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#14b8a6" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <text x={P} y={20} fontSize="12.5" fill="#64748b">สูงสุด {fmt(vmax, 1)}</text>
      <text x={P} y={H - 10} fontSize="12.5" fill="#64748b">{new Date(t0).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}</text>
      <text x={W - P} y={H - 10} fontSize="12.5" textAnchor="end" fill="#64748b">{new Date(t1).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}</text>
    </svg>
  );
}
