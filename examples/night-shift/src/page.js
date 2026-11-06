// Page view model (Req 4.1, 4.2, and the error paths of Req 1).
// buildView takes a location.search string and returns a plain view model. It reads no globals.
import { parseStart } from './input.js';
import { resolveLocal } from './resolve.js';
import { planGuests } from './guests.js';
import { suggestKinderTime } from './kinder.js';
import { offsetAt, formatOffset } from './zones.js';

function parseQuery(search) {
  const s = typeof search === 'string' ? search : '';
  const params = new URLSearchParams(s.startsWith('?') ? s.slice(1) : s);
  const guestsRaw = params.get('guests') ?? '';
  const guests = guestsRaw
    .split(',')
    .map((g) => g.trim())
    .filter((g) => g.length > 0);
  return {
    date: params.get('date') ?? undefined,
    time: params.get('time') ?? undefined,
    zone: params.get('zone') ?? undefined,
    pick: params.get('pick') ?? undefined,
    guests,
  };
}

// Build a query string from fields, with guests comma-joined. Omits empty pick.
function toSearch({ date, time, zone, guests, pick }) {
  const params = new URLSearchParams();
  params.set('date', date);
  params.set('time', time);
  params.set('zone', zone);
  params.set('guests', guests.join(','));
  if (pick) params.set('pick', pick);
  return `?${params.toString()}`;
}

export function buildView(search) {
  const q = parseQuery(search);

  const parsed = parseStart({ date: q.date, time: q.time, zone: q.zone });
  if (!parsed.ok) {
    return { status: 'error', message: parsed.error };
  }
  const { date, time, zone } = parsed.value;

  const pick = q.pick === 'earlier' || q.pick === 'later' ? q.pick : undefined;
  const resolved = resolveLocal({ date, time, zone }, pick);

  if (!resolved.ok && resolved.reason === 'ambiguous') {
    return {
      status: 'choose',
      message: resolved.error,
      links: [
        { label: 'Use the earlier one', search: toSearch({ date, time, zone, guests: q.guests, pick: 'earlier' }) },
        { label: 'Use the later one', search: toSearch({ date, time, zone, guests: q.guests, pick: 'later' }) },
      ],
    };
  }
  if (!resolved.ok) {
    // gap
    return { status: 'error', message: resolved.error };
  }

  const plan = planGuests(resolved.ms, zone, q.guests);
  if (!plan.ok) {
    return { status: 'error', message: plan.error };
  }

  const rows = plan.rows.map((row) => ({
    ...row,
    marker: row.deadOfNight ? '👻' : '',
    note: row.deadOfNight ? 'dead of night' : '',
  }));

  // Kinder time: offered only when someone is in the dead of night and a different hour has a lower count.
  let kinder = null;
  const currentDead = rows.filter((r) => r.deadOfNight).length;
  if (currentDead > 0) {
    const suggestion = suggestKinderTime({ date, zone }, q.guests);
    if (suggestion && suggestion.count < currentDead) {
      kinder = {
        time: suggestion.time,
        count: suggestion.count,
        search: toSearch({ date, time: suggestion.time, zone, guests: q.guests, pick: suggestion.choice }),
      };
    }
  }

  return {
    status: 'ok',
    host: { date, time, offset: formatOffset(offsetAt(resolved.ms, zone)), zone },
    rows,
    kinder,
  };
}
