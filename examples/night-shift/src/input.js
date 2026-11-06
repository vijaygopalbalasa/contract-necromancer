// Input validation (Req 1.4). Checks run date, then time, then zone, and report the first failure,
// so there is always exactly one sentence naming exactly one field.
import { isValidZone } from './zones.js';

// Untrusted link values are cut to 40 characters before being echoed into a sentence.
function cut(value) {
  const s = typeof value === 'string' ? value : '';
  return s.length > 40 ? s.slice(0, 40) : s;
}

function isRealDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y, m, d] = date.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const back = new Date(ms);
  return back.getUTCFullYear() === y && back.getUTCMonth() === m - 1 && back.getUTCDate() === d;
}

function isRealTime(time) {
  if (!/^\d{2}:\d{2}$/.test(time)) return false;
  const [hh, mm] = time.split(':').map(Number);
  return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
}

export function parseStart({ date, time, zone } = {}) {
  if (date === undefined || date === null || date === '') {
    return { ok: false, error: 'The date is missing; use YYYY-MM-DD.' };
  }
  if (!isRealDate(date)) {
    return { ok: false, error: `The date "${cut(date)}" is not a real date; use YYYY-MM-DD.` };
  }

  if (time === undefined || time === null || time === '') {
    return { ok: false, error: 'The time is missing; use HH:MM in 24-hour time.' };
  }
  if (!isRealTime(time)) {
    return { ok: false, error: `The time "${cut(time)}" is not valid; use HH:MM in 24-hour time.` };
  }

  if (zone === undefined || zone === null || zone === '') {
    return { ok: false, error: 'The time zone is missing; use a name like America/New_York.' };
  }
  if (!isValidZone(zone)) {
    return { ok: false, error: `The time zone "${cut(zone)}" is not a known IANA name; use a name like America/New_York.` };
  }

  return { ok: true, value: { date, time, zone } };
}
