// Consultant area: list of buyers with brief, matches, status and lead source.
import { listBuyers, createBuyer } from '../api/crm.js';
import { listProperties } from '../api/apimo.js';
import { matchProperties } from '../api/matching.js';
import { describeLeadSource } from '../ui/lead-source.js';
import { h, $, formatDate, errorBox } from '../ui/dom.js';
import { STATUS_LABELS, SOURCE_LABELS, initResetButtons, consentFlags, briefSummary, loading } from './internal-common.js';

let app;
let filters = { text: '', status: '' };

export async function init() {
  app = $('#buyers-app');
  initResetButtons(render);
  await render();
}

async function render() {
  app.replaceChildren(loading('Loading buyers…'));
  let buyers;
  let properties;
  try {
    [buyers, properties] = await Promise.all([listBuyers(), listProperties()]);
  } catch (error) {
    app.replaceChildren(errorBox("Buyers couldn't be loaded", `${error.message}. Reload the page; if it keeps failing, use "Reset demo data".`));
    return;
  }
  const addButton = h('button', { class: 'btn', type: 'button', onClick: addBuyer }, 'Add a buyer by hand');
  if (!buyers.length) {
    app.replaceChildren(h('div', { class: 'empty-state' },
      h('h2', {}, 'No buyers yet'),
      h('p', {}, 'Buyers appear here when someone sends a brief, books a video call or writes from the contact page. You can also add one after a phone call.'),
      addButton));
    return;
  }

  const search = h('input', { type: 'search', id: 'buyer-search', value: filters.text, placeholder: 'Name, email or country' });
  const status = h('select', { id: 'buyer-status' }, h('option', { value: '' }, 'All statuses'),
    ...Object.entries(STATUS_LABELS).map(([v, l]) => h('option', { value: v, selected: v === filters.status }, l)));
  const tbody = h('tbody');
  const count = h('p', { class: 'hint', role: 'status' });

  const fill = () => {
    filters = { text: search.value.trim().toLowerCase(), status: status.value };
    const rows = buyers.filter((b) => (!filters.status || b.status === filters.status)
      && (!filters.text || [b.contact?.name, b.contact?.email, b.contact?.country].join(' ').toLowerCase().includes(filters.text)));
    count.textContent = `${rows.length} of ${buyers.length} buyers`;
    tbody.replaceChildren(...(rows.length ? rows.map((b) => row(b, properties)) : [h('tr', {}, h('td', { colspan: '6' }, 'No buyer matches these filters.'))]));
  };
  search.addEventListener('input', fill);
  status.addEventListener('change', fill);

  app.replaceChildren(
    h('div', { class: 'toolbar' },
      h('div', { class: 'field' }, h('label', { for: 'buyer-search' }, 'Search'), search),
      h('div', { class: 'field' }, h('label', { for: 'buyer-status' }, 'Status'), status),
      addButton),
    count,
    h('div', { class: 'table-wrap' }, h('table', { class: 'data-table' },
      h('caption', {}, 'Buyers, newest first'),
      h('thead', {}, h('tr', {}, ...['Buyer', 'Must haves', 'Matches', 'Status', 'Came from', 'Consents'].map((t) => h('th', { scope: 'col' }, t)))),
      tbody)));
  fill();
}

function row(b, properties) {
  const matches = matchProperties(b.wishlist || {}, properties, { minScore: 60 }).length;
  return h('tr', {},
    h('th', { scope: 'row' },
      h('a', { href: `/internal/buyer/?id=${encodeURIComponent(b.id)}` }, b.contact?.name || 'Unnamed buyer'),
      h('span', { class: 'cell-sub' }, [b.contact?.country, formatDate(b.createdAt)].filter(Boolean).join(' · '))),
    h('td', {}, briefSummary(b.wishlist)),
    h('td', { class: 'num' }, matches ? String(matches) : h('span', {}, '0', h('span', { class: 'cell-sub' }, 'search outside'))),
    h('td', {}, h('span', { class: 'status' }, STATUS_LABELS[b.status] || b.status), h('span', { class: 'cell-sub' }, SOURCE_LABELS[b.source] || '')),
    h('td', {}, describeLeadSource(b.leadSource), b.buyerCountry ? h('span', { class: 'cell-sub' }, `Country page: ${b.buyerCountry}`) : null),
    h('td', {}, consentFlags(b.consents)));
}

async function addBuyer() {
  const name = prompt('Buyer name (you can complete the details on the next page):');
  if (!name || !name.trim()) return;
  try {
    const buyer = await createBuyer({
      source: 'consultant',
      contact: { name: name.trim(), email: '', phone: '', country: '', language: 'en' },
      consents: {},
      leadSource: null,
      interaction: { type: 'note', summary: 'Buyer added by a consultant' },
    });
    location.href = `/internal/buyer/?id=${encodeURIComponent(buyer.id)}`;
  } catch (error) {
    alert(`The buyer was not added: ${error.message}`);
  }
}
