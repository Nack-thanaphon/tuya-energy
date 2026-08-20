// Tuya OpenAPI proxy — keeps CLIENT_SECRET server-side.
// Gateway openapi-sg.iotbing.com uses legacy MD5 signing (probed & verified):
//   token:   MD5(client_id + client_secret + t)
//   call:    MD5(client_id + access_token + client_secret + t)
import { NextResponse } from 'next/server';
import { describeCycle, formatDayLocal, getBillingCycleBounds } from '../../../lib/billing-cycle.js';
import { getDailyEnergyRange, summarizeDailyRows, upsertManyDailyEnergy, upsertDailyEnergy } from '../../../lib/db.js';

const CLIENT_ID = process.env.TUYA_CLIENT_ID || 'v4887jcpnwfd47vvmrm8';
const CLIENT_SECRET = process.env.TUYA_CLIENT_SECRET || 'bcb53e380dbc49678e0144ff895476e8';
const DEVICE_ID = process.env.TUYA_DEVICE_ID || 'a35ebdbb5bd405d546x8ii';
const BASE = 'https://openapi-sg.iotbing.com';
const DAY_MS = 86_400_000;
const BILLING_CYCLE = {
  cutoffDay: 8,
  cutoffHour: 1,
  cutoffMinute: 0,
  timezoneOffsetMinutes: 420,
};

let tokenCache = { token: null, exp: 0 };
const md5hex = s => crypto.createHash('md5').update(s).digest('hex').toUpperCase();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const nodeCrypto = await import('node:crypto');
const crypto = nodeCrypto.default;

async function apiGet(path) {
  const t = String(Date.now());
  const needToken = !path.startsWith('/v1.0/token');
  if (needToken && (!tokenCache.token || Date.now() > tokenCache.exp)) await refreshToken();
  const token = tokenCache.token || '';
  const sign = needToken
    ? md5hex(CLIENT_ID + token + CLIENT_SECRET + t)
    : md5hex(CLIENT_ID + CLIENT_SECRET + t);
  const headers = {
    client_id: CLIENT_ID, sign, sign_method: 'MD5', t,
    'Content-Type': 'application/json',
  };
  if (needToken) headers.access_token = token;
  const res = await fetch(BASE + path, { headers, cache: 'no-store' });
  const json = await res.json().catch(() => ({ success: false, msg: 'bad json' }));
  // stale token → refresh once and retry
  if ([1004, 1010, 1011, 1015].includes(json.code) && needToken) {
    tokenCache = { token: null, exp: 0 };
    await refreshToken();
    return apiGet(path);
  }
  return json;
}

async function refreshToken() {
  const r = await apiGet('/v1.0/token?grant_type=1');
  const res = r.result || {};
  if (r.success && res.access_token) {
    tokenCache = { token: res.access_token, exp: Date.now() + Math.max(60, (res.expire_time || 3600) - 300) * 1000 };
  }
}

export async function GET() {
  const now = Date.now();
  const out = { fetched_at: now, device: null, status: [], logs: [], events: [], errors: [], billing: null };
  try {
    const d = await apiGet(`/v1.0/iot-03/devices/${DEVICE_ID}`);
    if (d.success) {
      const dev = d.result;
      out.device = {
        name: dev.name, model: dev.model, product: dev.product_name,
        online: dev.online, sn: dev.sn, timezone: dev.time_zone, ip: dev.ip, category: dev.category,
      };
    } else out.errors.push('device: ' + (d.msg || d.code));
  } catch (e) { out.errors.push('device: ' + e.message); }

  try {
    const s = await apiGet(`/v1.0/iot-03/devices/${DEVICE_ID}/status`);
    if (s.success) out.status = s.result || [];
  } catch (e) { out.errors.push('status: ' + e.message); }

  try {
    let row = null, logs = [];
    for (let i = 0; i < 10; i++) {
      const ep = `/v1.0/devices/${DEVICE_ID}/logs?start_time=${now - 7 * DAY_MS}&end_time=${now}&type=7&size=100&query_type=1`
        + (row ? `&start_row_key=${row}` : '');
      const r = await apiGet(ep);
      const res = r.result || {};
      logs = logs.concat(res.logs || []);
      if (!res.has_next || !res.next_row_key || res.next_row_key === row) break;
      row = res.next_row_key;
    }
    out.logs = logs;
  } catch (e) { out.errors.push('logs: ' + e.message); }

  try {
    const ev = await apiGet(`/v1.0/devices/${DEVICE_ID}/logs?start_time=${now - 7 * DAY_MS}&end_time=${now}&type=1&size=20&query_type=1`);
    out.events = (ev.result || {}).logs || [];
  } catch (e) { out.errors.push('events: ' + e.message); }

  try {
    // type=8 = WiFi signal strength (RSSI dBm)
    const sig = await apiGet(`/v1.0/devices/${DEVICE_ID}/logs?start_time=${now - 7 * DAY_MS}&end_time=${now}&type=8&size=5&query_type=1`);
    const sigLogs = (sig.result || {}).logs || [];
    if (sigLogs.length) out.signal = parseFloat(sigLogs[0].event_value);
  } catch (e) { /* non-critical */ }

  try {
    const cycle = getBillingCycleBounds(new Date(now), BILLING_CYCLE);
    const todayDay = formatDayLocal(new Date(now), BILLING_CYCLE.timezoneOffsetMinutes);
    const statusMap = Object.fromEntries((out.status || []).map(item => [item.code, item.value]));
    const addEleRaw = Number(statusMap.add_ele);
    if (Number.isFinite(addEleRaw)) {
      upsertDailyEnergy({
        device_id: DEVICE_ID,
        day: todayDay,
        kwh: addEleRaw / 1000,
        quality: 'exact',
        source: 'tuya_status_add_ele',
        note: 'Daily meter register from Tuya status',
        captured_at: new Date(now).toISOString(),
        overwrite: true,
      });
    }

    const powerLogs = (out.logs || [])
      .filter(l => l.code === 'cur_power' && !Number.isNaN(parseFloat(l.value)))
      .map(l => ({ t: Number(l.event_time), w: parseFloat(l.value) / 10 }))
      .sort((a, b) => a.t - b.t);
    const dayWh = {};
    for (let i = 1; i < powerLogs.length; i++) {
      const a = powerLogs[i - 1];
      const b = powerLogs[i];
      const wh = Math.max(0, (a.w + b.w) / 2 * (b.t - a.t) / 3.6e6);
      const day = formatDayLocal(new Date(b.t), BILLING_CYCLE.timezoneOffsetMinutes);
      dayWh[day] = (dayWh[day] || 0) + wh;
    }

    const backfillRows = Object.entries(dayWh)
      .filter(([day]) => day >= cycle.startDay && day < cycle.endDayExclusive && day !== todayDay)
      .map(([day, wh]) => ({
        device_id: DEVICE_ID,
        day,
        kwh: wh / 1000,
        quality: 'backfill',
        source: 'tuya_cur_power_logs',
        note: 'Estimated from sampled power logs',
        captured_at: new Date(now).toISOString(),
      }));
    if (backfillRows.length) upsertManyDailyEnergy(backfillRows);

    const rows = getDailyEnergyRange(DEVICE_ID, cycle.startDay, cycle.endDayExclusive);
    const summary = summarizeDailyRows(rows);
    out.billing = {
      cycle,
      label: describeCycle(cycle),
      today_day: todayDay,
      total_kwh: summary.totalKwh,
      exact_kwh: summary.exactKwh,
      estimated_kwh: summary.estimatedKwh,
      cycle_day_count: Math.round((cycle.endAt.getTime() - cycle.startAt.getTime()) / DAY_MS),
      rows,
    };
  } catch (e) {
    out.errors.push('billing: ' + e.message);
  }

  return NextResponse.json(out);
}
