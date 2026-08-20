import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DB_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DB_DIR, 'energy.sqlite');

let db;

function nowIso() {
  return new Date().toISOString();
}

export function getDb() {
  if (!db) {
    fs.mkdirSync(DB_DIR, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);
  }
  return db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_energy (
      device_id TEXT NOT NULL,
      day TEXT NOT NULL,
      kwh REAL NOT NULL,
      quality TEXT NOT NULL CHECK (quality IN ('exact', 'estimated', 'backfill')),
      source TEXT NOT NULL,
      note TEXT DEFAULT '',
      captured_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (device_id, day)
    );

    CREATE TABLE IF NOT EXISTS bill_reference (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      reading_date TEXT,
      cycle_start_day TEXT,
      cycle_end_day_exclusive TEXT,
      kwh_total REAL NOT NULL,
      amount_total REAL,
      ft_rate REAL,
      service_fee REAL,
      vat_amount REAL,
      note TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_daily_energy_device_day ON daily_energy(device_id, day);
    CREATE INDEX IF NOT EXISTS idx_bill_reference_device_created ON bill_reference(device_id, created_at);
  `);
}

export function upsertDailyEnergy({
  device_id,
  day,
  kwh,
  quality,
  source,
  note = '',
  captured_at = null,
  overwrite = false,
}) {
  const database = getDb();
  const existing = database.prepare(`SELECT * FROM daily_energy WHERE device_id = ? AND day = ?`).get(device_id, day);
  const ts = nowIso();
  const next = {
    device_id,
    day,
    kwh: Number(kwh),
    quality,
    source,
    note,
    captured_at,
  };

  if (!existing) {
    database.prepare(`
      INSERT INTO daily_energy (device_id, day, kwh, quality, source, note, captured_at, created_at, updated_at)
      VALUES (@device_id, @day, @kwh, @quality, @source, @note, @captured_at, @created_at, @updated_at)
    `).run({ ...next, created_at: ts, updated_at: ts });
    return { inserted: true, updated: false };
  }

  const shouldOverwrite = overwrite || existing.quality !== 'exact';
  if (!shouldOverwrite) return { inserted: false, updated: false, skipped: true };

  database.prepare(`
    UPDATE daily_energy
    SET kwh = @kwh,
        quality = @quality,
        source = @source,
        note = @note,
        captured_at = @captured_at,
        updated_at = @updated_at
    WHERE device_id = @device_id AND day = @day
  `).run({ ...next, updated_at: ts });

  return { inserted: false, updated: true };
}

export function upsertManyDailyEnergy(rows, options = {}) {
  const database = getDb();
  const tx = database.transaction((items) => {
    for (const row of items) upsertDailyEnergy({ ...row, ...options });
  });
  tx(rows);
}

export function getDailyEnergyRange(deviceId, startDay, endDayExclusive) {
  return getDb().prepare(`
    SELECT device_id, day, kwh, quality, source, note, captured_at, created_at, updated_at
    FROM daily_energy
    WHERE device_id = ? AND day >= ? AND day < ?
    ORDER BY day ASC
  `).all(deviceId, startDay, endDayExclusive);
}

export function getExistingDaySet(deviceId, startDay, endDayExclusive) {
  const rows = getDb().prepare(`
    SELECT day FROM daily_energy
    WHERE device_id = ? AND day >= ? AND day < ?
  `).all(deviceId, startDay, endDayExclusive);
  return new Set(rows.map(r => r.day));
}

export function insertBillReference({
  device_id,
  reading_date = null,
  cycle_start_day = null,
  cycle_end_day_exclusive = null,
  kwh_total,
  amount_total = null,
  ft_rate = null,
  service_fee = null,
  vat_amount = null,
  note = '',
}) {
  const info = getDb().prepare(`
    INSERT INTO bill_reference (
      device_id, reading_date, cycle_start_day, cycle_end_day_exclusive,
      kwh_total, amount_total, ft_rate, service_fee, vat_amount, note, created_at
    ) VALUES (
      @device_id, @reading_date, @cycle_start_day, @cycle_end_day_exclusive,
      @kwh_total, @amount_total, @ft_rate, @service_fee, @vat_amount, @note, @created_at
    )
  `).run({
    device_id,
    reading_date,
    cycle_start_day,
    cycle_end_day_exclusive,
    kwh_total,
    amount_total,
    ft_rate,
    service_fee,
    vat_amount,
    note,
    created_at: nowIso(),
  });
  return info.lastInsertRowid;
}

export function summarizeDailyRows(rows) {
  const byDay = {};
  let exactKwh = 0;
  let estimatedKwh = 0;
  for (const row of rows) {
    byDay[row.day] = row;
    if (row.quality === 'exact') exactKwh += Number(row.kwh || 0);
    else estimatedKwh += Number(row.kwh || 0);
  }
  return {
    totalKwh: exactKwh + estimatedKwh,
    exactKwh,
    estimatedKwh,
    byDay,
  };
}

export { DB_PATH };
