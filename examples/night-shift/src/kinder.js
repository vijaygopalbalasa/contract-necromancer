// Kinder time (Req 3.2): the on-the-hour start on the host date that marks the fewest
// guests as up in the dead of night, earliest hour on ties. Guest zones are assumed valid.
import { resolveLocal } from './resolve.js';
import { planGuests } from './guests.js';

function deadCount(ms, hostZone, guestZones) {
  const plan = planGuests(ms, hostZone, guestZones);
  return plan.rows.reduce((n, row) => n + (row.deadOfNight ? 1 : 0), 0);
}

export function suggestKinderTime({ date, zone }, guestZones) {
  let best = null;

  for (let h = 0; h < 24; h += 1) {
    const time = `${String(h).padStart(2, '0')}:00`;
    const open = resolveLocal({ date, time, zone });

    // Candidate instants for this hour, earliest first, with the choice that selects each.
    let candidates;
    if (open.ok) {
      candidates = [{ ms: open.ms, choice: undefined }];
    } else if (open.reason === 'ambiguous') {
      candidates = [
        { ms: open.options.earlier, choice: 'earlier' },
        { ms: open.options.later, choice: 'later' },
      ];
    } else {
      // gap: this hour does not exist, never offered.
      continue;
    }

    for (const cand of candidates) {
      const count = deadCount(cand.ms, zone, guestZones);
      if (best === null || count < best.count) {
        best = { date, time, ms: cand.ms, count };
        if (cand.choice !== undefined) best.choice = cand.choice;
        else delete best.choice;
      }
    }
  }

  return best;
}
