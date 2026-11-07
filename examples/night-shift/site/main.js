// Render the view model into the page. All logic lives in src/page.js; this only maps fields to DOM nodes.
// Values from the link are untrusted and are written with textContent only, never raw markup.
import { buildView, readForm, formToSearch, refusalFor } from '../src/page.js';

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null && text !== '') node.textContent = text;
  if (className) node.className = className;
  return node;
}

function hostLine(host) {
  const p = el('p', '', 'host');
  const strong = el('strong', `${host.date} ${host.time}`);
  p.appendChild(el('span', 'Party starts at '));
  p.appendChild(strong);
  p.appendChild(el('span', ` (${host.offset}) in ${host.zone}.`));
  return p;
}

function rowCells(tr, row) {
  tr.appendChild(el('td', `${row.marker} ${row.zone}`.trim(), 'zone'));
  tr.appendChild(el('td', `${row.date} ${row.time}`));
  tr.appendChild(el('td', row.offset, 'offset'));
  tr.appendChild(el('td', row.dayLabel, 'day'));
  const noteCell = el('td', '', 'note');
  if (row.note) noteCell.textContent = row.note; // the words "dead of night"
  tr.appendChild(noteCell);
}

function rowsTable(rows) {
  const table = el('table');
  const thead = el('thead');
  const headRow = el('tr');
  for (const label of ['Guest zone', 'Local start', 'Offset', 'Day', '']) {
    headRow.appendChild(el('th', label));
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = el('tbody');
  for (const row of rows) {
    const tr = el('tr');
    if (row.deadOfNight) tr.className = 'night';
    rowCells(tr, row);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

function renderOk(main, view) {
  main.appendChild(hostLine(view.host));

  if (view.rows.length === 0) {
    main.appendChild(el('p', 'No guests yet.', 'empty'));
  } else {
    main.appendChild(rowsTable(view.rows));
  }

  if (view.kinder) {
    const p = el('p', '', 'kinder');
    p.appendChild(el('span', 'Some guests are up in the dead of night. '));
    const link = el('a', `Try a kinder time: ${view.kinder.time}`);
    link.href = view.kinder.search;
    p.appendChild(link);
    main.appendChild(p);
  }
}

function field(label, name, value, hint) {
  const wrap = el('div', '', 'field');
  const id = `field-${name}`;
  const lab = el('label', label);
  lab.htmlFor = id;
  const input = el('input');
  input.type = 'text';
  input.id = id;
  input.name = name;
  input.value = value;
  input.placeholder = hint;
  input.autocomplete = 'off';
  input.spellcheck = false;
  wrap.appendChild(lab);
  wrap.appendChild(input);
  return wrap;
}

// The form is built from the fields that readForm took from the link (or from the working example).
function renderForm(main, fields) {
  const form = el('form');
  form.noValidate = true;
  form.appendChild(field('Date', 'date', fields.date, 'YYYY-MM-DD'));
  form.appendChild(field('Start time (24-hour)', 'time', fields.time, 'HH:MM'));
  form.appendChild(field('Your city (time zone)', 'zone', fields.zone, 'America/New_York'));
  form.appendChild(field('Guest cities (time zones, separated by commas)', 'guests', fields.guests, 'Europe/London, Asia/Kolkata'));
  const button = el('button', 'Show times');
  button.type = 'submit';
  form.appendChild(button);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const next = formToSearch({
      date: data.get('date'),
      time: data.get('time'),
      zone: data.get('zone'),
      guests: data.get('guests'),
    });
    try {
      window.history.pushState(null, '', next);
    } catch {
      window.location.assign(next); // the address could not be changed in place, so load the new link
      return;
    }
    render();
  });
  main.appendChild(form);
}

// A refusal sits right under the form so the page is never empty; a time that happens twice adds its two choices.
function renderRefusal(main, refusal) {
  const p = el('p', refusal.message, 'message');
  p.setAttribute('role', 'alert');
  main.appendChild(p);
  if (refusal.links.length > 0) {
    const ul = el('ul');
    for (const choice of refusal.links) {
      const li = el('li');
      const a = el('a', choice.label);
      a.href = choice.search;
      li.appendChild(a);
      ul.appendChild(li);
    }
    main.appendChild(ul);
  }
}

function render() {
  const form = readForm(window.location.search);
  // Without a complete link the page shows the working example, and that example's result.
  const view = form.example ? buildView(form.search) : buildView(window.location.search);
  const main = document.querySelector('main');
  while (main.firstChild) main.removeChild(main.firstChild);
  main.appendChild(el('h1', 'Night Shift'));
  renderForm(main, form.fields);

  const refusal = refusalFor(view);
  if (refusal) renderRefusal(main, refusal);
  else renderOk(main, view);
}

window.addEventListener('popstate', render);
render();
