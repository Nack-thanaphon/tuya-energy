const DAY_MS = 86_400_000;

function pad(n) {
  return String(n).padStart(2, '0');
}

function shiftToLocal(date, timezoneOffsetMinutes) {
  return new Date(date.getTime() + timezoneOffsetMinutes * 60_000);
}

function shiftFromLocalParts(year, monthIndex, day, hour, minute, timezoneOffsetMinutes) {
  return new Date(Date.UTC(year, monthIndex, day, hour, minute) - timezoneOffsetMinutes * 60_000);
}

export function formatDayLocal(date, timezoneOffsetMinutes = 420) {
  const local = shiftToLocal(date, timezoneOffsetMinutes);
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
}

export function getBillingCycleBounds(now = new Date(), {
  cutoffDay = 8,
  cutoffHour = 1,
  cutoffMinute = 0,
  timezoneOffsetMinutes = 420,
} = {}) {
  const localNow = shiftToLocal(now, timezoneOffsetMinutes);
  let year = localNow.getUTCFullYear();
  let monthIndex = localNow.getUTCMonth();

  const beforeCutoff = (
    localNow.getUTCDate() < cutoffDay ||
    (localNow.getUTCDate() === cutoffDay && localNow.getUTCHours() < cutoffHour) ||
    (localNow.getUTCDate() === cutoffDay && localNow.getUTCHours() === cutoffHour && localNow.getUTCMinutes() < cutoffMinute)
  );

  if (beforeCutoff) {
    monthIndex -= 1;
    if (monthIndex < 0) {
      monthIndex = 11;
      year -= 1;
    }
  }

  const startAt = shiftFromLocalParts(year, monthIndex, cutoffDay, cutoffHour, cutoffMinute, timezoneOffsetMinutes);
  const nextMonthIndex = monthIndex === 11 ? 0 : monthIndex + 1;
  const nextYear = monthIndex === 11 ? year + 1 : year;
  const endAt = shiftFromLocalParts(nextYear, nextMonthIndex, cutoffDay, cutoffHour, cutoffMinute, timezoneOffsetMinutes);

  return {
    startAt,
    endAt,
    startDay: formatDayLocal(startAt, timezoneOffsetMinutes),
    endDayExclusive: formatDayLocal(endAt, timezoneOffsetMinutes),
    cutoffDay,
    cutoffHour,
    cutoffMinute,
    timezoneOffsetMinutes,
  };
}

export function listCycleDays(cycleBounds) {
  const days = [];
  for (let t = cycleBounds.startAt.getTime(); t < cycleBounds.endAt.getTime(); t += DAY_MS) {
    days.push(formatDayLocal(new Date(t), cycleBounds.timezoneOffsetMinutes));
  }
  return days;
}

export function buildEstimatedDailyRows({
  deviceId,
  cycleBounds,
  todayDay,
  existingDays = new Set(),
  dailyKwhEstimate,
  source = 'bill_average',
  note = '',
}) {
  const estimate = Number(dailyKwhEstimate);
  if (!Number.isFinite(estimate) || estimate < 0) return [];
  const rows = [];
  for (const day of listCycleDays(cycleBounds)) {
    if (day >= todayDay) break;
    if (existingDays.has(day)) continue;
    rows.push({
      device_id: deviceId,
      day,
      kwh: estimate,
      quality: 'estimated',
      source,
      note,
    });
  }
  return rows;
}

export function countCycleDays(cycleBounds) {
  return listCycleDays(cycleBounds).length;
}

export function describeCycle(cycleBounds) {
  return `${cycleBounds.startDay} → ${formatDayLocal(new Date(cycleBounds.endAt.getTime() - DAY_MS), cycleBounds.timezoneOffsetMinutes)}`;
}
