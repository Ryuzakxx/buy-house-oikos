// Buyer CRM adapter. Mock: one JSON document in localStorage, seeded from /data/demo-buyers.json.
// Production: keep the function names and return shapes, and call the backend that writes to the real CRM.
import { read, write, remove, uid, latency } from './storage.js';

const KEY = 'crm.v1';
const SEED = '/data/demo-buyers.json';

/*
Buyer {
  id, createdAt, updatedAt,
  status: 'new' | 'brief-confirmed' | 'searching' | 'shortlist-sent' | 'visiting' | 'offer' | 'bought' | 'paused',
  source: 'chat' | 'voice' | 'webcall' | 'contact' | 'consultant',
  contact: { name, email, phone, country, language },
  buyerCountry,                       // ISO code from a country landing page, if any
  leadSource,                         // see js/ui/lead-source.js getLeadSource()
  consents: { processing, recording, marketing }, each { granted, at, text }
  wishlist: { mustHave[], niceToHave[], dealBreakers[], context{}, status: 'draft'|'submitted'|'confirmed', confirmedAt },
  shortlist: [{ propertyId, addedAt, score, status: 'proposed'|'visit-planned'|'visited'|'offer'|'rejected' }],
  feedback: [{ id, propertyId, at, verdict: 'liked'|'maybe'|'rejected', reasons[], note, changes[] }],
  interactions: [{ id, at, type, summary, by: 'buyer'|'consultant'|'system' }],
  bookings: [{ id, startsAt, timeZone, language, recordingConsent, notes }],
  transcripts: [{ id, at, text, source }]
}
*/

async function load() {
  let db = read(KEY);
  if (!db) {
    const res = await fetch(SEED);
    if (!res.ok) throw new Error(`Demo data returned ${res.status}`);
    const seed = await res.json();
    db = { version: 1, buyers: seed.buyers };
    if (!write(KEY, db)) throw new Error('Browser storage is not available, so the demo CRM cannot save.');
  }
  return db;
}

function save(db) {
  if (!write(KEY, db)) throw new Error('Browser storage is full or blocked; the change was not saved.');
}

const now = () => new Date().toISOString();

export function consentRecord(granted, text) {
  return { granted: Boolean(granted), at: now(), text };
}

export async function listBuyers() {
  await latency();
  const db = await load();
  return [...db.buyers].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getBuyer(id) {
  await latency();
  const db = await load();
  return db.buyers.find((b) => b.id === id) || null;
}

export async function findBuyerByEmail(email) {
  const db = await load();
  return db.buyers.find((b) => b.contact?.email?.toLowerCase() === String(email).toLowerCase()) || null;
}

export async function createBuyer({ contact, wishlist, leadSource, consents, source, interaction }) {
  await latency();
  const db = await load();
  const buyer = {
    id: uid('b'),
    createdAt: now(),
    updatedAt: now(),
    status: 'new',
    source,
    contact,
    buyerCountry: leadSource?.buyerCountry || null,
    leadSource: leadSource || null,
    consents,
    wishlist: wishlist || { mustHave: [], niceToHave: [], dealBreakers: [], context: {}, status: 'draft' },
    shortlist: [],
    feedback: [],
    interactions: interaction ? [{ id: uid('i'), at: now(), by: 'buyer', ...interaction }] : [],
    bookings: [],
    transcripts: [],
  };
  db.buyers.push(buyer);
  save(db);
  return buyer;
}

export async function updateBuyer(id, update) {
  await latency(60);
  const db = await load();
  const i = db.buyers.findIndex((b) => b.id === id);
  if (i === -1) throw new Error('Buyer not found');
  const next = typeof update === 'function' ? update(structuredClone(db.buyers[i])) : { ...db.buyers[i], ...update };
  db.buyers[i] = { ...next, updatedAt: now() };
  save(db);
  return db.buyers[i];
}

export function addInteraction(id, { type, summary, by = 'consultant' }) {
  return updateBuyer(id, (b) => ({ ...b, interactions: [...b.interactions, { id: uid('i'), at: now(), type, summary, by }] }));
}

export function updateWishlist(id, wishlist, { by = 'consultant', summary = 'Brief edited' } = {}) {
  return updateBuyer(id, (b) => ({
    ...b,
    wishlist: { ...wishlist, updatedAt: now() },
    interactions: [...b.interactions, { id: uid('i'), at: now(), type: 'wishlist', summary, by }],
  }));
}

export function addBooking(id, booking) {
  return updateBuyer(id, (b) => ({ ...b, bookings: [...(b.bookings || []), { id: uid('bk'), ...booking }] }));
}

export function addTranscript(id, { text, source }) {
  return updateBuyer(id, (b) => ({
    ...b,
    transcripts: [...(b.transcripts || []), { id: uid('t'), at: now(), text, source }],
    interactions: [...b.interactions, { id: uid('i'), at: now(), type: 'transcript', summary: `Call transcript added (${text.length} characters)`, by: 'consultant' }],
  }));
}

export async function resetDemo() {
  remove(KEY);
  await load();
}
