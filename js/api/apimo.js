// Property feed adapter. Mock: /data/properties.json, a simplified copy of an Apimo export.
// Production: point SOURCE at your backend, which calls Apimo server-side so the API token never reaches the browser.
import { latency } from './storage.js';

const SOURCE = '/data/properties.json';
let cache = null;

async function fetchRaw() {
  if (!cache) {
    cache = fetch(SOURCE).then((res) => {
      if (!res.ok) throw new Error(`Property feed returned ${res.status}`);
      return res.json();
    });
    cache.catch(() => { cache = null; });
  }
  return cache;
}

export function normalize(raw) {
  const text = {};
  for (const c of raw.comments || []) text[c.language] = { title: c.title, subtitle: c.subtitle, comment: c.comment };
  return {
    id: raw.id,
    reference: raw.reference,
    slug: raw.slug,
    status: raw.status,
    source: raw.source,
    partnerAgencyId: raw.partnerAgencyId || null,
    type: raw.type,
    subtype: raw.subtype,
    price: raw.price?.hide ? null : raw.price?.value ?? null,
    currency: raw.price?.currency || 'EUR',
    region: raw.city?.region ?? null,
    city: raw.city?.name ?? '',
    area: raw.city?.area ?? '',
    rooms: raw.rooms ?? null,
    bedrooms: raw.bedrooms ?? null,
    bathrooms: raw.bathrooms ?? null,
    surface: raw.area?.value ?? null,
    land: raw.landArea?.value ?? null,
    pool: raw.pool ?? null,
    poolPossible: raw.poolPossible ?? null,
    seaView: raw.seaView ?? null,
    distances: { sea: raw.distances?.sea ?? null, airport: raw.distances?.airport ?? null, town: raw.distances?.town ?? null },
    airportName: raw.airportName || '',
    condition: raw.condition ?? null,
    energyClass: raw.energyClass ?? null,
    text,
    title: (text.en || Object.values(text)[0] || {}).title || raw.reference,
    pictures: raw.pictures || [],
  };
}

// The site publishes no catalogue: properties are only read by the matching engine and the consultant area.
export async function listProperties() {
  await latency();
  const data = await fetchRaw();
  return data.properties.map(normalize);
}

export async function getProperty(id) {
  const all = await listProperties();
  return all.find((p) => String(p.id) === String(id)) || null;
}
