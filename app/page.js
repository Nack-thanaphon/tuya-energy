'use client';
import { useEffect, useState, useCallback } from 'react';

// ---------- constants ----------
const DP_LABELS = {
  forward_energy_total: 'พลังงานสะสม (kWh)',
  add_ele: 'พลังงานสะสม (kWh)',
  total_energy: 'พลังงานสะสม (kWh)',
  total_forward_energy: 'พลังงานสะสม (kWh)',
  cur_power: 'กำลังไฟขณะนี้',
  power: 'กำลังไฟขณะนี้',
  active_power: ' กำลังไฟขณะนี้',
  cur_voltage: 'แรงดันไฟฟ้า',
  voltage: 'แรงดันไฟฟ้า',
  cur_current: 'กระแสไฟฟ้า',
  current: 'กระแสไฟฟ้า',
  electricity: 'กระแสไฟฟ้า',
};
const fmt = (n, d = 2) => n == null || isNaN(n) ? '—' : Number(n).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d });

// unit normalisation (kWh / W / V / A)
function interpret(status) {
  const m = {};
  const all = [];
  for (const s of status) {
    const label = DP_LABELS[s.code] || s.code;
    const e = { code: s.code, label, raw: s.value };
    const v = parseFloat(s.value);
    if (!isNaN(v)) {
      if (/energy/.test(s.code)) {
        const kWh = v > 100000 ? v / 1000 : v;      // Wh → kWh
        e.val = kWh; e.unit = 'kWh'; m.kwh = kWh;
      } else if (/power/.test(s.code)) {
        const W = v > 50000 ? v / 100 : v;           // 0.01W → W
        e.val = W; e.unit = 'W'; m.power = W;
      } else if (/voltage/.test(s.code)) {
        const V = v > 100000 ? v / 1000 : v > 1000 ? v / 10 : v; // mV→V, 0.1V→V
        e.val = V; e.unit = 'V'; m.volt = V;
      } else if (/current|electricity/.test(s.code)) {
        const A = v > 500 ? v / 1000 : v;            // mA → A
        e.val = A; e.unit = 'A'; m.amp = A;
      }
    }
    all.push(e);
  }
  return { m, all };
}

// ---------- small components ----------
function Card({ label, value, unit, big }) {
  return (
    <div className="card">
      <div className="k">{label}</div>
      <div className={big ? 'v big' : 'v'}>{value}<span className="u">{unit}</span></div>
    </div>
  );
}

export default function Home() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [rate, setRate] = useState(4);
  const [baseline, setBaseline] = useState(0);
  const [goal, setGoal] = useState(0);
  const [savedFlash, setSavedFlash] = useState('');

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
    localStorage.setItem('rate', rate); localStorage.setItem('baseline', baseline); localStorage.setItem('goal', goal);
    setSavedFlash('บันทึกแล้ว ✔'); setTimeout(() => setSavedFlash(''), 2000);
  };
  const setRate2 = v => setRate(Math.round(v * 100) / 100);

  const dev = data?.device || {};
  const { m, all } = interpret(data?.status || []);
  const used = m.kwh != null ? Math.max(0, m.kwh - baseline) : null;
  const baht = used != null ? used * rate : null;
  const pct = goal > 0 && used != null ? Math.min(100, used / goal * 100) : null;

  return (
    <main>
      {/* header */}
      <header>
        <div className="titleRow">
          <h1>มิเตอร์ไฟ {dev.name || '…'}</h1>
          <span className={dev.online ? 'pill on' : 'pill off'}>{dev.online ? 'ออนไลน์' : 'ออฟไลน์'}</span>
        </div>
        <div className="sub">{dev.product} {dev.model ? '· ' + dev.model : ''} · อัปเดต {data ? new Date(data.fetched_at).toLocaleString('th-TH') : '…'}</div>
      </header>

      {err && <div className="banner">⚠ ติดต่อเซิร์ฟเวอร์ไม่ได้: {err}</div>}
      {data?.errors?.length > 0 && <div className="banner">⚠ คลาวด์: {data.errors.join(' | ')}</div>}

      {/* main cost + metrics */}
      <section className="grid">
        <div className="card hero">
          <div className="k">💰 ค่าไฟตั้งแต่ต้นบิล</div>
          <div className="v big">{baht != null ? fmt(baht) : '—'}<span className="u">บาท</span></div>
          {used != null && (
            <div className="note">{fmt(used)} kWh × {fmt(rate, 2)} ฿
              {pct != null && <> · เป้า {fmt(goal, 0)} kWh ใช้ไป {fmt(pct, 0)}%</>}
            </div>
          )}
          {pct != null && (
            <div className="bar"><div className="fill" style={{ width: pct + '%' }} /></div>
          )}
        </div>
        <Card label="🔌 กำลังไฟขณะนี้" value={fmt(m.power, 1)} unit="W" />
        <Card label="⚡ พลังงานสะสม" value={fmt(m.kwh)} unit="kWh" />
        <Card label="🔋 แรงดัน" value={fmt(m.volt, 1)} unit="V" />
        <Card label="🌀 กระแส" value={fmt(m.amp)} unit="A" />
      </section>

      {/* settings */}
      <section className="panel">
        <h2>⚙️ ตั้งค่า</h2>
        <div className="formRow">
          <label>อัตราค่าไฟ (฿/kWh)<input type="number" step="0.01" min="0" value={rate} onChange={e => setRate2(+e.target.value)} /></label>
          <label>มิเตอร์ตอนต้นบิล (kWh)<input type="number" step="0.01" min="0" value={baseline} onChange={e => setBaseline(+e.target.value)} /></label>
          <label>เป้าหมายเดือนนี้ (kWh)<input type="number" step="1" min="0" value={goal || ''} onChange={e => setGoal(+e.target.value)} /></label>
          <button onClick={save}>บันทึก</button>
          <span className="note">{savedFlash}</span>
        </div>
        <p className="hint">เคล็ดลับ: ดู "บาท/หน่วย" จากบิลไฟฟ้า ใส่ช่องอัตรา · จดตัวเลขมิเตอร์วันเริ่มบิลใส่ช่องต้นบิล แล้วค่าไฟจะคิดตั้งแต่วันนั้น</p>
      </section>

      {/* chart */}
      <section className="panel">
        <h2>📈 การใช้ไฟ 7 วันล่าสุด</h2>
        <Chart logs={data?.logs || []} />
      </section>

      {/* raw table */}
      <section className="panel">
        <h2>📋 ค่าจากมิเตอร์ทั้งหมด</h2>
        {all.length ? (
          <table>
            <thead><tr><th>ค่า</th><th>รหัส</th><th>ตัวเลข</th></tr></thead>
            <tbody>
              {all.map(e => (
                <tr key={e.code}>
                  <td>{e.label}</td>
                  <td><code>{e.code}</code></td>
                  <td>{e.val != null ? fmt(e.val, e.unit === 'kWh' ? 2 : 1) + ' ' + e.unit : String(e.raw)} <span className="dim">(raw {String(e.raw)})</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">มิเตอร์เชื่อมคลาวด์แล้ว แต่ยังไม่ส่งค่าไฟฟ้าออกมา (DP report) — เปิด/ปิดสวิตช์มิเตอร์หรือรอ 1–2 นาทีให้รายงานค่ารอบแรก</div>
        )}
      </section>

      {/* events */}
      <section className="panel">
        <h2>🕘 ประวัติออนไลน์</h2>
        {(data?.events || []).length ? (
          <table>
            <tbody>
              {data.events.slice(0, 8).map((e, i) => (
                <tr key={i}><td className="dim">{new Date(e.event_time).toLocaleString('th-TH')}</td><td>{e.event_id === 1 ? 'ออนไลน์' : 'เหตุการณ์ #' + e.event_id}</td></tr>
              ))}
            </tbody>
          </table>
        ) : <div className="empty">ไม่มีประวัติ</div>}
      </section>

      <footer>
        ที่มา: [1] ข้อมูลมิเตอร์ — Tuya Open API <code>openapi-sg.iotbing.com</code> (endpoints <code>/v1.0/iot-03/devices/</code>, <code>/status</code>, <code>/logs</code>) ดึงสดผ่าน API route ของเว็บ ·
        [2] ค่าเริ่มต้น 4 ฿/kWh เป็นค่าประมาณ <b>[unverified]</b> — ใส่อัตราจริงจากบิลไฟของคุณ ·
        [3] การตีความรหัส DP อ้างอิงมาตรฐาน Tuya metering (หมวด aqcz) <b>[unverified]</b> — เทียบกับหน้าจอมิเตอร์ได้ในตาราง
      </footer>
    </main>
  );
}

function Chart({ logs }) {
  const pts = (logs || []).filter(l => l.code && /power|energy/.test(l.code) && !isNaN(parseFloat(l.value)))
    .map(l => ({ t: l.event_time, v: parseFloat(l.value) })).sort((a, b) => a.t - b.t);
  if (pts.length < 2) return <div className="empty">ยังไม่มีข้อมูลวาดกราฟ — รอมิเตอร์รายงานค่าแรก</div>;
  const W = 900, H = 220, P = 30;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
  const vmax = Math.max(...pts.map(p => p.v), 1);
  const X = t => P + (t - t0) / (t1 - t0 || 1) * (W - 2 * P);
  const Y = v => H - P - v / vmax * (H - 2 * P);
  const path = pts.map((p, i) => (i ? 'L' : 'M') + X(p.t).toFixed(1) + ' ' + Y(p.v).toFixed(1)).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 220 }}>
      <path d={path + ` L ${X(t1).toFixed(1)} ${Y(0)} L ${X(t0).toFixed(1)} ${Y(0)} Z`} fill="rgba(159,232,112,.25)" />
      <path d={path} fill="none" stroke="#163300" strokeWidth="2.5" />
      <text x={P} y={20} fontSize="13" fill="#454745">สูงสุด {fmt(vmax, 1)}</text>
      <text x={P} y={H - 8} fontSize="13" fill="#454745">{new Date(t0).toLocaleDateString('th-TH')}</text>
      <text x={W - P} y={H - 8} fontSize="13" textAnchor="end" fill="#454745">{new Date(t1).toLocaleDateString('th-TH')}</text>
    </svg>
  );
}
