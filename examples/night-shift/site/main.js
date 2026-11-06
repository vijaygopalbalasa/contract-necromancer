// Render the view model into the page. All logic lives in src/page.js; this only maps fields to DOM nodes.
// Values from the link are untrusted and are written with textContent only, never raw markup.
import { buildView } from '../src/page.js';

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

function renderChoose(main, view) {
  main.appendChild(el('p', view.message, 'message'));
  const ul = el('ul');
  for (const choice of view.links) {
    const li = el('li');
    const a = el('a', choice.label);
    a.href = choice.search;
    li.appendChild(a);
    ul.appendChild(li);
  }
  main.appendChild(ul);
}

function renderError(main, view) {
  main.appendChild(el('p', view.message, 'message'));
}

function render() {
  const view = buildView(window.location.search);
  const main = document.querySelector('main');
  while (main.firstChild) main.removeChild(main.firstChild);
  main.appendChild(el('h1', 'Night Shift'));

  if (view.status === 'ok') renderOk(main, view);
  else if (view.status === 'choose') renderChoose(main, view);
  else renderError(main, view);
}

render();
