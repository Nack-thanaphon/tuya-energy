export const REF_KWH_DAY = 7.1;
export const TIERS = [
  { upTo: 150, rate: 3.2484 },
  { upTo: 400, rate: 4.2218 },
  { upTo: Infinity, rate: 4.4217 },
];

export const dateKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function marginalRate(kwh) {
  for (const t of TIERS) if (kwh <= t.upTo) return t.rate;
  return TIERS[TIERS.length - 1].rate;
}

export function billCalc(kwh, ft, service) {
  let energy = 0;
  let prev = 0;
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

export function interpretEnergy(status, logs = []) {
  const m = { hours: {}, daysWh: {}, daysKwh: {} };
  for (const s of status) {
    const v = parseFloat(s.value);
    if (Number.isNaN(v)) continue;
    if (s.code === 'cur_voltage') m.volt = v / 10;
    else if (s.code === 'cur_current') m.amp = v / 1000;
    else if (s.code === 'cur_power') m.power = v / 10;
    else if (s.code === 'add_ele') m.addEleKwh = v / 1000;
  }

  const pows = logs
    .filter(l => l.code === 'cur_power' && !Number.isNaN(parseFloat(l.value)))
    .map(l => ({ t: l.event_time, w: parseFloat(l.value) / 10 }))
    .sort((a, b) => a.t - b.t);

  m.sampleCount = pows.length;
  for (let i = 1; i < pows.length; i++) {
    const a = pows[i - 1];
    const b = pows[i];
    const wh = Math.max(0, (a.w + b.w) / 2 * (b.t - a.t) / 3.6e6);
    const d = new Date(b.t);
    const hKey = d.getHours();
    const dKey = dateKey(d);
    m.hours[hKey] = (m.hours[hKey] || 0) + wh;
    m.daysWh[dKey] = (m.daysWh[dKey] || 0) + wh;
  }

  for (const [day, wh] of Object.entries(m.daysWh)) {
    m.daysKwh[day] = wh / 1000;
  }

  m.todayKwh = m.addEleKwh ?? null;
  return m;
}

export function mergeDailyHistory(history = {}, { now = new Date(), todayKwh = null, logDaysKwh = {} } = {}) {
  const next = {};
  for (const [day, value] of Object.entries(history || {})) {
    const num = Number(value);
    if (Number.isFinite(num) && num >= 0) next[day] = num;
  }

  for (const [day, value] of Object.entries(logDaysKwh || {})) {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) continue;
    next[day] = Math.max(next[day] || 0, num);
  }

  if (todayKwh != null) {
    const day = dateKey(now);
    const num = Number(todayKwh);
    if (Number.isFinite(num) && num >= 0) next[day] = Math.max(next[day] || 0, num);
  }

  return next;
}

export function sumMonthKwh(history = {}, now = new Date()) {
  const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return Object.entries(history).reduce((sum, [day, value]) => (
    day.startsWith(prefix) ? sum + Number(value || 0) : sum
  ), 0);
}
