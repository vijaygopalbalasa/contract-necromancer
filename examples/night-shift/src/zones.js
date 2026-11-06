// Zone primitives. The only module that calls Intl.
// An instant is UTC milliseconds; a zone is an IANA name.

const partsCache = new Map();

function formatterFor(zone) {
  let fmt = partsCache.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    partsCache.set(zone, fmt);
  }
  return fmt;
}

// True when Intl accepts the name as a time zone and it is not an offset string.
// Node 24 accepts offset strings like "+05:30" as a time zone, but the product wants IANA names.
export function isValidZone(name) {
  if (typeof name !== 'string' || name.length === 0) return false;
  if (name[0] === '+' || name[0] === '-') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

// { year, month, day, hour, minute } for the instant in the given zone.
export function localParts(ms, zone) {
  const parts = formatterFor(zone).formatToParts(new Date(ms));
  const out = {};
  for (const { type, value } of parts) {
    if (type === 'year') out.year = Number(value);
    else if (type === 'month') out.month = Number(value);
    else if (type === 'day') out.day = Number(value);
    else if (type === 'hour') out.hour = Number(value) % 24; // h23 yields 00..23, guard against 24
    else if (type === 'minute') out.minute = Number(value);
  }
  return out;
}

// Offset in minutes east of UTC at the instant.
export function offsetAt(ms, zone) {
  const p = localParts(ms, zone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  const floored = Math.floor(ms / 60000) * 60000;
  return (asUtc - floored) / 60000;
}

export function formatOffset(minutes) {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${sign}${hh}:${mm}`;
}

export function formatDate({ year, month, day }) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function formatTime({ hour, minute }) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
