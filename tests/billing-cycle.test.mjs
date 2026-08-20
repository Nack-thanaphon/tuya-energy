import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getBillingCycleBounds,
  listCycleDays,
  buildEstimatedDailyRows,
} from '../lib/billing-cycle.js';

test('getBillingCycleBounds uses cutoff day 8 at 01:00 Asia/Bangkok style offset', () => {
  const bounds = getBillingCycleBounds(new Date('2026-08-20T11:00:00+07:00'), {
    cutoffDay: 8,
    cutoffHour: 1,
    cutoffMinute: 0,
    timezoneOffsetMinutes: 420,
  });

  assert.equal(bounds.startAt.toISOString(), '2026-08-07T18:00:00.000Z');
  assert.equal(bounds.endAt.toISOString(), '2026-09-07T18:00:00.000Z');
  assert.equal(bounds.startDay, '2026-08-08');
  assert.equal(bounds.endDayExclusive, '2026-09-08');
});

test('getBillingCycleBounds rolls back to previous month when before cutoff', () => {
  const bounds = getBillingCycleBounds(new Date('2026-08-07T23:30:00+07:00'), {
    cutoffDay: 8,
    cutoffHour: 1,
    cutoffMinute: 0,
    timezoneOffsetMinutes: 420,
  });

  assert.equal(bounds.startAt.toISOString(), '2026-07-07T18:00:00.000Z');
  assert.equal(bounds.endAt.toISOString(), '2026-08-07T18:00:00.000Z');
  assert.equal(bounds.startDay, '2026-07-08');
  assert.equal(bounds.endDayExclusive, '2026-08-08');
});

test('listCycleDays returns day keys inside the billing cycle window', () => {
  const bounds = getBillingCycleBounds(new Date('2026-08-20T11:00:00+07:00'), {
    cutoffDay: 8,
    cutoffHour: 1,
    cutoffMinute: 0,
    timezoneOffsetMinutes: 420,
  });
  const days = listCycleDays(bounds);

  assert.equal(days[0], '2026-08-08');
  assert.equal(days.at(-1), '2026-09-07');
  assert.equal(days.length, 31);
});

test('buildEstimatedDailyRows seeds only missing pre-today days as estimated', () => {
  const rows = buildEstimatedDailyRows({
    deviceId: 'dev-1',
    cycleBounds: getBillingCycleBounds(new Date('2026-08-20T11:00:00+07:00'), {
      cutoffDay: 8,
      cutoffHour: 1,
      cutoffMinute: 0,
      timezoneOffsetMinutes: 420,
    }),
    todayDay: '2026-08-20',
    existingDays: new Set(['2026-08-10', '2026-08-12']),
    dailyKwhEstimate: 4.16,
    source: 'bill_average',
    note: 'Bootstrapped from previous utility bill average',
  });

  assert.equal(rows[0].day, '2026-08-08');
  assert.equal(rows.at(-1).day, '2026-08-19');
  assert.equal(rows.every(r => r.quality === 'estimated'), true);
  assert.equal(rows.every(r => r.source === 'bill_average'), true);
  assert.equal(rows.some(r => r.day === '2026-08-10'), false);
  assert.equal(rows.some(r => r.day === '2026-08-12'), false);
});
