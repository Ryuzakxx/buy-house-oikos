// Time zone helpers built on Intl only. Office hours are defined in Italian time.
import { LOCALE } from './i18n.js';

export const OFFICE_ZONE = 'Europe/Rome';

export function zoneOffsetMinutes(timeZone, date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

// The UTC instant of a wall-clock time in a zone; the second pass settles daylight-saving edges.
export function zonedInstant(isoDate, hour, minute, timeZone) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  const first = zoneOffsetMinutes(timeZone, new Date(guess));
  const candidate = new Date(guess - first * 60000);
  const second = zoneOffsetMinutes(timeZone, candidate);
  return second === first ? candidate : new Date(guess - second * 60000);
}

export function detectedZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || OFFICE_ZONE;
  } catch {
    return OFFICE_ZONE;
  }
}

export function allZones(detected) {
  const list = typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone')
    : ['Europe/Rome', 'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'Europe/Amsterdam', 'Europe/Zurich', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Australia/Sydney'];
  return list.includes(detected) ? list : [detected, ...list];
}

export function formatInZone(date, timeZone, options, locale = LOCALE) {
  return new Intl.DateTimeFormat(locale, { timeZone, ...options }).format(date);
}
