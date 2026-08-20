import { NextResponse } from 'next/server';
import { buildEstimatedDailyRows, countCycleDays, formatDayLocal, getBillingCycleBounds } from '../../../lib/billing-cycle.js';
import { getExistingDaySet, getDailyEnergyRange, insertBillReference, summarizeDailyRows, upsertManyDailyEnergy } from '../../../lib/db.js';

const DEVICE_ID = process.env.TUYA_DEVICE_ID || 'a35ebdbb5bd405d546x8ii';
const DEFAULTS = {
  cutoffDay: 8,
  cutoffHour: 1,
  cutoffMinute: 0,
  timezoneOffsetMinutes: 420,
};

export async function POST(request) {
  try {
    const body = await request.json();
    const now = body.now ? new Date(body.now) : new Date();
    const cycleBounds = getBillingCycleBounds(now, DEFAULTS);
    const todayDay = formatDayLocal(now, DEFAULTS.timezoneOffsetMinutes);

    const prevCycleNow = new Date(cycleBounds.startAt.getTime() - 60_000);
    const previousCycle = getBillingCycleBounds(prevCycleNow, DEFAULTS);
    const previousCycleDays = countCycleDays(previousCycle);

    const previousBillKwh = Number(body.previousBillKwh);
    if (!Number.isFinite(previousBillKwh) || previousBillKwh <= 0) {
      return NextResponse.json({ error: 'previousBillKwh must be a positive number' }, { status: 400 });
    }

    const dailyKwhEstimate = previousBillKwh / previousCycleDays;
    const existingDays = getExistingDaySet(DEVICE_ID, cycleBounds.startDay, cycleBounds.endDayExclusive);
    const rows = buildEstimatedDailyRows({
      deviceId: DEVICE_ID,
      cycleBounds,
      todayDay,
      existingDays,
      dailyKwhEstimate,
      source: 'bill_average',
      note: body.note || `Bootstrapped from previous bill average ${previousBillKwh} kWh / ${previousCycleDays} days`,
    });

    upsertManyDailyEnergy(rows);

    const billRefId = insertBillReference({
      device_id: DEVICE_ID,
      reading_date: body.readingDate || null,
      cycle_start_day: previousCycle.startDay,
      cycle_end_day_exclusive: previousCycle.endDayExclusive,
      kwh_total: previousBillKwh,
      amount_total: body.amountTotal ?? null,
      ft_rate: body.ftRate ?? null,
      service_fee: body.serviceFee ?? null,
      vat_amount: body.vatAmount ?? null,
      note: body.note || 'Imported previous utility bill reference',
    });

    const rowsAfter = getDailyEnergyRange(DEVICE_ID, cycleBounds.startDay, cycleBounds.endDayExclusive);
    const summary = summarizeDailyRows(rowsAfter);

    return NextResponse.json({
      ok: true,
      importedRows: rows.length,
      billReferenceId: billRefId,
      cycle: cycleBounds,
      previousCycle,
      previousCycleDays,
      dailyKwhEstimate,
      summary,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
