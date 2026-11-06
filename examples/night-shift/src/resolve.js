// Resolve a local time to a UTC instant (Req 1.1, 1.2, 1.3).
// Input is assumed already valid (callers run parseStart first).
import { localParts, offsetAt, formatDate, formatTime } from './zones.js';

const DAY = 864e5;

function wallOf({ date, time }) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh, mm);
}

// Read a millisecond value as a UTC wall clock (used to format a local wall time from instant + offset).
function wallParts(ms) {
  const d = new Date(ms);
  return { hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

// Does the candidate instant read back as the requested wall-clock date and time in the zone?
function matches(ms, date, time, zone) {
  const p = localParts(ms, zone);
  return formatDate(p) === date && formatTime(p) === time;
}

// Binary search to the minute for the instant where the offset changes, between lo and hi.
function findTransition(lo, hi, zone) {
  const offLo = offsetAt(lo, zone);
  let a = lo;
  let b = hi;
  while (b - a > 60000) {
    const mid = a + Math.floor((b - a) / 2 / 60000) * 60000;
    if (offsetAt(mid, zone) === offLo) a = mid;
    else b = mid;
  }
  return { at: b, before: offLo, after: offsetAt(b, zone) };
}

export function resolveLocal({ date, time, zone }, choice) {
  const wall = wallOf({ date, time });

  const offsets = new Set([offsetAt(wall - DAY, zone), offsetAt(wall + DAY, zone)]);
  const candidates = [];
  for (const o of offsets) {
    const ms = wall - o * 60000;
    if (matches(ms, date, time, zone)) candidates.push(ms);
  }
  candidates.sort((a, b) => a - b);

  if (candidates.length === 1) {
    return { ok: true, ms: candidates[0] };
  }

  if (candidates.length >= 2) {
    const earlier = candidates[0];
    const later = candidates[candidates.length - 1];
    if (choice === 'earlier') return { ok: true, ms: earlier };
    if (choice === 'later') return { ok: true, ms: later };
    return {
      ok: false,
      reason: 'ambiguous',
      error: `${time} happens twice in ${zone} on ${date}; choose the earlier or the later one.`,
      options: { earlier, later },
    };
  }

  // Zero candidates: clocks jumped forward over this wall time. Name the skipped local range.
  // At the transition instant the wall clock jumps from (at + before) to (at + after), read as UTC wall time.
  const { at, before, after } = findTransition(wall - DAY, wall + DAY, zone);
  const skipStart = formatTime(wallParts(at + before * 60000));
  const skipEnd = formatTime(wallParts(at + after * 60000));
  return {
    ok: false,
    reason: 'gap',
    error: `${time} does not exist in ${zone} on ${date} because clocks skip from ${skipStart} to ${skipEnd}; pick another time.`,
  };
}
