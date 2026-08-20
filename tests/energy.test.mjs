import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dateKey,
  interpretEnergy,
  mergeDailyHistory,
  sumMonthKwh,
} from '../lib/energy.js';

test('mergeDailyHistory updates today with latest meter reading instead of keeping first snapshot', () => {
  const now = new Date('2026-08-20T16:30:00+07:00');
  const merged = mergeDailyHistory({
    '2026-08-20': 1.2,
    '2026-08-19': 4.5,
  }, {
    now,
    todayKwh: 5.9,
    logDaysKwh: {},
  });

  assert.equal(merged['2026-08-20'], 5.9);
  assert.equal(merged['2026-08-19'], 4.5);
});

test('mergeDailyHistory backfills missing recent days from integrated power logs', () => {
  const now = new Date('2026-08-20T16:30:00+07:00');
  const merged = mergeDailyHistory({
    '2026-08-18': 3.2,
  }, {
    now,
    todayKwh: 0.24,
    logDaysKwh: {
      '2026-08-19': 4.8,
      '2026-08-20': 0.239,
    },
  });

  assert.deepEqual(merged, {
    '2026-08-18': 3.2,
    '2026-08-19': 4.8,
    '2026-08-20': 0.24,
  });
  assert.equal(sumMonthKwh(merged, now), 8.24);
});

test('interpretEnergy converts Tuya status and integrates power samples into hourly/daily kWh', () => {
  const start = Date.parse('2026-08-20T00:00:00+07:00');
  const end = Date.parse('2026-08-20T01:00:00+07:00');
  const result = interpretEnergy(
    [
      { code: 'cur_voltage', value: '2308' },
      { code: 'cur_current', value: '134' },
      { code: 'cur_power', value: '10000' },
      { code: 'add_ele', value: '1000' },
    ],
    [
      { code: 'cur_power', event_time: start, value: '10000' },
      { code: 'cur_power', event_time: end, value: '10000' },
    ]
  );

  assert.equal(result.volt, 230.8);
  assert.equal(result.amp, 0.134);
  assert.equal(result.power, 1000);
  assert.equal(result.todayKwh, 1);
  assert.equal(result.hours[1], 1000);
  assert.equal(result.daysKwh[dateKey(new Date(end))], 1);
});
