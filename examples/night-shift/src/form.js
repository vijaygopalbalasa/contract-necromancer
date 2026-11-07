// The form on the page (Req 4.4): reading a link into form fields, building a link from form fields,
// and picking the refusal to show next to the form. Pure functions; nothing here reads a global.

export const EXAMPLE_FORM = Object.freeze({
  date: '2026-10-31',
  time: '20:00',
  zone: 'America/New_York',
  guests: 'Europe/London, Asia/Kolkata, Asia/Tokyo, Asia/Kathmandu',
});

// Guests are comma separated; spaces are trimmed and empty items dropped (same rule as Req 4.1).
function splitGuests(text) {
  return String(text ?? '')
    .split(',')
    .map((g) => g.trim())
    .filter((g) => g.length > 0);
}

// Percent-encode a value but keep "/" and ":" readable, so the link looks like the one in Req 4.1.
function encodePart(value) {
  return encodeURIComponent(value).replace(/%2F/gi, '/').replace(/%3A/gi, ':');
}

export function formToSearch(values = {}) {
  const text = (v) => String(v ?? '').trim();
  const guests = splitGuests(values.guests).map(encodePart).join(',');
  return `?date=${encodePart(text(values.date))}&time=${encodePart(text(values.time))}`
    + `&zone=${encodePart(text(values.zone))}&guests=${guests}`;
}

export const EXAMPLE_SEARCH = formToSearch(EXAMPLE_FORM);

// Read a location.search string into the fields for the form.
// When the date, the time or the zone is absent from the link, the whole working example is used instead
// (example: true). A guests part that is absent is fine: Req 4.1 allows a link with no guests.
export function readForm(search) {
  const s = typeof search === 'string' ? search : '';
  const params = new URLSearchParams(s.startsWith('?') ? s.slice(1) : s);
  if (!params.has('date') || !params.has('time') || !params.has('zone')) {
    return { example: true, fields: { ...EXAMPLE_FORM }, search: EXAMPLE_SEARCH };
  }
  return {
    example: false,
    fields: {
      date: params.get('date'),
      time: params.get('time'),
      zone: params.get('zone'),
      guests: splitGuests(params.get('guests')).join(', '),
    },
    search: s.startsWith('?') ? s : `?${s}`,
  };
}

// The message (and, for a time that happens twice, the two choices) to show next to the form.
// Returns null when the view is a normal result.
export function refusalFor(view) {
  if (!view || (view.status !== 'error' && view.status !== 'choose')) return null;
  return { message: view.message, links: view.links ?? [] };
}
