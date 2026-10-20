// Partner agencies and sale attribution, read only by the consultant area. Mock: JSON seed plus localStorage.
// Production: sales and signed agreements (with their share rate) live in the backend.
import { read, write, remove, uid, latency } from './storage.js';
import { withBase } from '../core/base.js';

const KEY = 'partners.v1';
export const DEFAULT_RATE = 0.01;

async function load() {
  let db = read(KEY);
  if (!db) {
    const [agencies, sales] = await Promise.all(['/data/partner-agencies.json', '/data/demo-sales.json'].map(withBase).map(async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url} returned ${res.status}`);
      return res.json();
    }));
    db = { version: 1, rate: DEFAULT_RATE, agencies: agencies.agencies, sales: sales.sales };
    write(KEY, db);
  }
  return db;
}

export async function listAgencies() {
  await latency();
  return (await load()).agencies;
}

export async function listSales() {
  await latency();
  return [...(await load()).sales].sort((a, b) => b.saleDate.localeCompare(a.saleDate));
}

export async function getRate() {
  return (await load()).rate ?? DEFAULT_RATE;
}

export async function setRate(rate) {
  const db = await load();
  db.rate = rate;
  if (!write(KEY, db)) throw new Error('Browser storage is not available; the rate was not saved.');
}

export async function recordSale({ propertyId, buyerId, saleDate, value }) {
  await latency();
  const db = await load();
  const sale = { id: uid('sale'), propertyId: Number(propertyId), buyerId, saleDate, value: Number(value), recordedAt: new Date().toISOString() };
  db.sales.push(sale);
  if (!write(KEY, db)) throw new Error('Browser storage is not available; the sale was not saved.');
  return sale;
}

// The share is due when the home came from a partner agency and the buyer was introduced by us.
export function attribution(sale, property, buyer, agency, rate) {
  const fromPartner = property?.source === 'partner' && Boolean(agency);
  const ourBuyer = Boolean(buyer);
  const due = fromPartner && ourBuyer;
  let reason = 'Share due: partner listing sold to a buyer we introduced';
  if (!fromPartner) reason = 'No share: Oikos listing';
  else if (!ourBuyer) reason = 'No share: buyer not introduced by us';
  return { due, amount: due ? Math.round(sale.value * rate) : 0, reason };
}

export async function resetPartners() {
  remove(KEY);
  await load();
}

export async function addPartnerLead(lead) {
  await latency();
  const db = await load();
  db.leads = [...(db.leads || []), { id: uid('pl'), at: new Date().toISOString(), ...lead }];
  if (!write(KEY, db)) throw new Error('Browser storage is not available; the request was not saved.');
}

export async function listPartnerLeads() {
  return (await load()).leads || [];
}
