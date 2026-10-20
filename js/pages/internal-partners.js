// Consultant area: where properties come from, completed sales and the commission share due from partner agencies.
import { listAgencies, listSales, getRate, setRate, recordSale, attribution, listPartnerLeads } from '../api/partners.js';
import { listProperties } from '../api/apimo.js';
import { listBuyers, updateBuyer, addInteraction } from '../api/crm.js';
import { formatEuro } from '../core/wishlist.js';
import { describeLeadSource } from '../ui/lead-source.js';
import { h, $, formatDate, errorBox } from '../ui/dom.js';
import { initResetButtons, loading } from './internal-common.js';

let app;

export async function init() {
  app = $('#partners-app');
  initResetButtons(render);
  await render();
}

async function render(focusId) {
  app.replaceChildren(loading('Loading partners and sales…'));
  let agencies; let sales; let properties; let buyers; let rate; let leads;
  try {
    [agencies, sales, properties, buyers, rate, leads] = await Promise.all([listAgencies(), listSales(), listProperties(), listBuyers(), getRate(), listPartnerLeads()]);
  } catch (error) {
    app.replaceChildren(errorBox("Partner data couldn't be loaded", `${error.message}. Reload the page, or reset the demo data.`));
    return;
  }
  const byId = (list, id) => list.find((x) => String(x.id) === String(id));
  const rows = sales.map((sale) => {
    const property = byId(properties, sale.propertyId);
    const buyer = byId(buyers, sale.buyerId);
    const agency = property?.partnerAgencyId ? byId(agencies, property.partnerAgencyId) : null;
    return { sale, property, buyer, agency, share: attribution(sale, property, buyer, agency, rate) };
  });
  const totalDue = rows.reduce((sum, r) => sum + r.share.amount, 0);
  const partnerListings = properties.filter((p) => p.source === 'partner');

  const rateInput = h('input', { type: 'number', id: 'share-rate', min: '0', max: '10', step: '0.1', value: String(Math.round(rate * 1000) / 10) });
  const rateStatus = h('span', { class: 'hint', role: 'status' });
  const rateForm = h('form', { class: 'toolbar' },
    h('div', { class: 'field' }, h('label', { for: 'share-rate' }, 'Indicative share, % of sale price'), rateInput),
    h('button', { class: 'btn', type: 'submit' }, 'Update'), rateStatus);
  rateForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pct = Number(rateInput.value);
    if (!Number.isFinite(pct) || pct < 0 || pct > 10) { rateStatus.textContent = 'Enter a percentage between 0 and 10.'; return; }
    await setRate(pct / 100);
    render('share-rate');
  });

  const kpi = (value, label) => h('div', { class: 'kpi' }, h('span', { class: 'kpi__value' }, value), h('span', { class: 'kpi__label' }, label));

  const salesTable = rows.length
    ? h('div', { class: 'table-wrap' }, h('table', { class: 'data-table' },
      h('caption', {}, 'Completed sales'),
      h('thead', {}, h('tr', {}, ...['Date', 'Property', 'From', 'Buyer and lead source', 'Sale value', 'Share due'].map((t) => h('th', { scope: 'col', class: ['Sale value', 'Share due'].includes(t) ? 'num' : null }, t)))),
      h('tbody', {}, ...rows.map((r) => h('tr', {},
        h('td', {}, formatDate(r.sale.saleDate)),
        h('th', { scope: 'row' }, r.property?.title || `Property ${r.sale.propertyId}`, h('span', { class: 'cell-sub' }, r.property?.reference || '')),
        h('td', {}, r.agency ? r.agency.name : 'Oikos listing'),
        h('td', {}, r.buyer ? h('a', { href: `/internal/buyer/?id=${encodeURIComponent(r.buyer.id)}` }, r.buyer.contact.name) : 'Not in the CRM',
          h('span', { class: 'cell-sub' }, r.buyer ? describeLeadSource(r.buyer.leadSource) : '')),
        h('td', { class: 'num' }, formatEuro(r.sale.value)),
        h('td', { class: 'num' }, r.share.due ? formatEuro(r.share.amount) : '€0', h('span', { class: 'cell-sub' }, r.share.reason))))),
      h('tfoot', {}, h('tr', {}, h('th', { scope: 'row', colspan: '5' }, 'Total share due'), h('td', { class: 'num' }, formatEuro(totalDue))))))
    : h('div', { class: 'empty-state' }, h('h2', {}, 'No completed sales yet'), h('p', {}, 'Record a sale below when a deed is signed.'));

  const agencyTable = agencies.length
    ? h('div', { class: 'table-wrap' }, h('table', { class: 'data-table' },
      h('caption', {}, 'Partner agencies'),
      h('thead', {}, h('tr', {}, ...['Agency', 'Agreement since', 'Listings in the feed', 'Sales to our buyers', 'Share due'].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', {}, ...agencies.map((a) => {
        const own = rows.filter((r) => r.agency?.id === a.id);
        return h('tr', {},
          h('th', { scope: 'row' }, a.name, h('span', { class: 'cell-sub' }, `${a.town} (${a.province})`)),
          h('td', {}, formatDate(a.agreementSignedAt)),
          h('td', { class: 'num' }, String(partnerListings.filter((p) => p.partnerAgencyId === a.id).length)),
          h('td', { class: 'num' }, String(own.length)),
          h('td', { class: 'num' }, formatEuro(own.reduce((s, r) => s + r.share.amount, 0))));
      }))))
    : h('div', { class: 'empty-state' }, h('h2', {}, 'No partner agencies yet'));

  const leadsBlock = leads.length
    ? h('ul', { class: 'timeline' }, ...leads.map((l) => h('li', {}, h('time', { datetime: l.at }, formatDate(l.at, { dateStyle: 'medium', timeStyle: 'short' })), `${l.agency}, ${l.area}: ${l.name} (${l.email}), uses ${l.software}`)))
    : h('p', { class: 'crit-empty' }, 'No requests yet. They arrive from the form on the partner agencies page.');

  app.replaceChildren(
    h('div', { class: 'kpis' },
      kpi(String(agencies.length), 'Partner agencies with an agreement'),
      kpi(String(partnerListings.length), `Partner listings in the feed, of ${properties.length}`),
      kpi(String(sales.length), 'Completed sales recorded'),
      kpi(formatEuro(totalDue), `Share due at ${Math.round(rate * 1000) / 10}%`)),
    rateForm,
    h('p', { class: 'hint' }, 'The share is due when a partner agency\'s property is bought by a buyer we introduced. Rates are indicative; each signed agreement sets the real one.'),
    salesTable,
    saleForm(properties, buyers),
    agencyTable,
    h('section', { class: 'panel', 'aria-labelledby': 'leads-title' }, h('h2', { id: 'leads-title' }, 'Partnership requests from the website'), leadsBlock));
  if (focusId) document.getElementById(focusId)?.focus();
}

function saleForm(properties, buyers) {
  const today = new Date().toISOString().slice(0, 10);
  const status = h('p', { class: 'form-status', role: 'status', tabindex: '-1' });
  const form = h('form', { class: 'form', id: 'sale-form' },
    status,
    h('div', { class: 'form-row form-row--2' },
      h('div', { class: 'field' }, h('label', { for: 'sale-property' }, 'Property'), h('select', { id: 'sale-property', name: 'propertyId', required: true },
        ...properties.filter((p) => p.status !== 'sold').map((p) => h('option', { value: String(p.id) }, `${p.reference}: ${p.title}`)))),
      h('div', { class: 'field' }, h('label', { for: 'sale-buyer' }, 'Buyer'), h('select', { id: 'sale-buyer', name: 'buyerId' },
        h('option', { value: '' }, 'Buyer not in the CRM'),
        ...buyers.map((b) => h('option', { value: b.id }, b.contact?.name || b.id))))),
    h('div', { class: 'form-row form-row--2' },
      h('div', { class: 'field' }, h('label', { for: 'sale-date' }, 'Deed date'), h('input', { type: 'date', id: 'sale-date', name: 'saleDate', required: true, max: today, value: today })),
      h('div', { class: 'field' }, h('label', { for: 'sale-value' }, 'Sale price (€)'), h('input', { type: 'number', id: 'sale-value', name: 'value', required: true, min: '1000', step: '1000', inputmode: 'numeric' }))),
    h('div', { class: 'form-actions' }, h('button', { class: 'btn btn--primary', type: 'submit' }, 'Record the sale')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form));
    try {
      await recordSale({ ...data, buyerId: data.buyerId || null });
      if (data.buyerId) {
        await updateBuyer(data.buyerId, (b) => ({ ...b, status: 'bought' }));
        await addInteraction(data.buyerId, { type: 'sale', summary: `Deed signed for property ${data.propertyId}, ${formatEuro(Number(data.value))}` });
      }
      render('sale-title');
    } catch (error) {
      status.className = 'form-status form-status--error';
      status.textContent = `The sale was not recorded: ${error.message}`;
      status.focus();
    }
  });
  return h('section', { class: 'panel', 'aria-labelledby': 'sale-title' }, h('h2', { id: 'sale-title', tabindex: '-1' }, 'Record a completed sale'), form);
}
