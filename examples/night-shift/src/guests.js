// Guest rows, day labels, ordering, dead-of-night marking (Req 2.1, 2.2, 2.3, 3.1).
import { isValidZone, localParts, offsetAt, formatOffset, formatDate, formatTime } from './zones.js';
import { isDeadOfNight } from './night.js';

// Whole-day difference between two local dates, as calendar days.
function dayDiff(guestParts, hostParts) {
  const g = Date.UTC(guestParts.year, guestParts.month - 1, guestParts.day);
  const h = Date.UTC(hostParts.year, hostParts.month - 1, hostParts.day);
  return Math.round((g - h) / 864e5);
}

function labelFor(offset) {
  if (offset === 0) return '';
  const word = offset < 0 ? 'before' : 'after';
  const n = Math.abs(offset);
  return n === 1 ? `the day ${word}` : `${n} days ${word}`;
}

export function planGuests(startMs, hostZone, guestZones) {
  for (const zone of guestZones) {
    if (!isValidZone(zone)) {
      return { ok: false, error: `The guest time zone "${zone}" is not a known IANA name; use a name like Asia/Kolkata.` };
    }
  }

  const hostParts = localParts(startMs, hostZone);

  const rows = guestZones.map((zone) => {
    const parts = localParts(startMs, zone);
    const dayOffset = dayDiff(parts, hostParts);
    return {
      zone,
      date: formatDate(parts),
      time: formatTime(parts),
      offset: formatOffset(offsetAt(startMs, zone)),
      dayOffset,
      dayLabel: labelFor(dayOffset),
      deadOfNight: isDeadOfNight({ hour: parts.hour }),
    };
  });

  // Order by local date and time together, ties by zone name (plain string comparison).
  rows.sort((a, b) => {
    const ka = `${a.date} ${a.time}`;
    const kb = `${b.date} ${b.time}`;
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    if (a.zone < b.zone) return -1;
    if (a.zone > b.zone) return 1;
    return 0;
  });

  return { ok: true, rows };
}
