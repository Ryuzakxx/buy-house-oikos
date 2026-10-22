// Listings found on property portals: the searches to run for a brief, which links are single listings, and how a
// listing's text becomes a property the matching engine can score. No I/O: js/api/web-search.js runs the searches.

// Portals searched. A page of their results can be opened through the search service and yields every listing on it
// (in practice casa.it; the others are kept for their single listings). Immobiliare.it and idealista refuse automated
// reading, and searching them brings back pages of results that cannot be opened, so they are not searched.
const PORTALS = ['casa.it', 'wikicasa.it', 'gate-away.com'];

// Path of a single listing on each portal; the number is the portal's own id. Links to any of these are recognised.
const LISTING_PATH = {
  'casa.it': /^\/immobili\/(\d+)/,
  'wikicasa.it': /^\/(?:[a-z]{2}\/)?annuncio\/(\d+)/,
  'gate-away.com': /^\/properties\/.+\/id\/(\d+)/,
  'immobiliare.it': /^\/(?:[a-z]{2}\/)?annunci\/(\d+)/,
  'idealista.it': /^\/(?:[a-z]{2}\/)?immobile\/(\d+)/,
  'kyero.com': /^\/[a-z]{2}\/property\/(\d+)/,
};

// Towns searched in each region of the brief, the coast first when the brief wants the sea. A town leads to pages of
// listings for that town, where a whole region leads to vague ones. Each town costs one search.
export const PLACES = {
  puglia: { coast: ['Ostuni', 'Monopoli', 'Polignano a Mare', 'Fasano', 'Otranto', 'Gallipoli'], inland: ['Ceglie Messapica', 'Cisternino', 'Martina Franca', 'Locorotondo', 'Lecce'] },
  tuscany: { coast: ['Castiglione della Pescaia', 'Orbetello', 'Capalbio', 'Pietrasanta'], inland: ['Montepulciano', 'Pienza', 'Cortona', 'Greve in Chianti', 'Lucca', 'Volterra'] },
  sicily: { coast: ['Noto', 'Siracusa', 'Taormina', 'Cefalù', 'Scicli'], inland: ['Modica', 'Ragusa', 'Caltagirone'] },
  'lake-como': { coast: ['Menaggio', 'Bellagio', 'Tremezzina', 'Varenna'], inland: ['Cernobbio', 'Lenno', 'Como'] },
  liguria: { coast: ['Sanremo', 'Alassio', 'Finale Ligure', 'Rapallo', 'Lerici', 'Camogli'], inland: ['Dolceacqua', 'Apricale', 'Sarzana'] },
  sardinia: { coast: ['San Teodoro', 'Arzachena', 'Santa Teresa Gallura', 'Alghero', 'Villasimius', 'Budoni'], inland: ['Olbia', 'Luras'] },
};
export const PLACES_PER_ROUND = 3;

// Words Italian listings use in their titles for each type of the brief.
const TYPE_WORDS = { villa: ['Villa'], apartment: ['Appartamento'], townhouse: ['Casa indipendente centro storico'], rustic: ['Rustico da ristrutturare'] };
const FARMHOUSE_WORDS = { puglia: ['Masseria', 'Trullo'], tuscany: ['Casale', 'Casolare'], sicily: ['Casale', 'Baglio'] };

const TYPES = ['villa', 'farmhouse', 'apartment', 'townhouse', 'rustic'];
const CONDITIONS = ['move-in', 'light-refresh', 'renovation', 'restoration'];

const criteria = (w) => [...(w.mustHave || []), ...(w.niceToHave || []), ...(w.dealBreakers || [])];
const wanted = (w, key) => criteria(w).find((c) => c.key === key) || null;

function placesFor(region, wantsSea) {
  if (String(region).startsWith('other:')) return [region.slice(6)];
  const p = PLACES[region];
  if (!p) return [];
  return wantsSea ? [...p.coast, ...p.inland] : [...p.inland, ...p.coast];
}

function typeWords(types, region) {
  if (!types.length) return ['Casa'];
  return types.flatMap((t) => (t === 'farmhouse' ? FARMHOUSE_WORDS[region] || ['Casale'] : TYPE_WORDS[t] || []));
}

function features(w) {
  const out = [];
  if (wanted(w, 'pool')) out.push('con piscina');
  if (wanted(w, 'seaView')) out.push('vista mare');
  if ((wanted(w, 'land')?.value ?? 0) >= 10000) out.push('con terreno');
  const beds = wanted(w, 'bedrooms')?.value;
  if (beds >= 2) out.push(`${beds} camere da letto`);
  return out.slice(0, 2);
}

// The searches for one round: PLACES_PER_ROUND towns, one region at a time. Round 1 moves on to the next towns, for
// when round 0 did not find enough.
export function planSearches(w, { round = 0 } = {}) {
  const regions = wanted(w, 'region')?.value || Object.keys(PLACES);
  const wantsSea = Boolean(wanted(w, 'seaView')) || (wanted(w, 'distanceSea')?.value ?? Infinity) <= 10;
  const types = (wanted(w, 'type')?.value || []).filter((t) => TYPES.includes(t));
  const lists = regions.map((region) => placesFor(region, wantsSea).map((place) => ({ region, place })));
  const order = [];
  for (let i = 0; lists.some((l) => i < l.length); i += 1) for (const l of lists) if (l[i]) order.push(l[i]);
  const extra = features(w).join(' ');
  return order.slice(round * PLACES_PER_ROUND, (round + 1) * PLACES_PER_ROUND).map(({ region, place }, i) => {
    const words = typeWords(types, region);
    const query = `${words[(round * PLACES_PER_ROUND + i) % words.length]} in vendita ${place}${extra ? ` ${extra}` : ''}`;
    return { region, place, params: { query, max_results: 10, include_domains: PORTALS, include_raw_content: 'markdown' } };
  });
}

const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-');

// Pages of results to open, when the search returned them without their content (it only keeps some pages in
// full). Each result carries the search that found it (r.plan). Preferred: casa.it, about the town searched, first
// page in the default order. Towns take turns, two pages each at most; five pages cost one credit.
export function pagesToOpen(results, { max = 5, perPlace = 2 } = {}) {
  const rank = (r) => {
    const u = new URL(r.url);
    return (onSite(u.hostname, 'casa.it') ? 4 : 0) + (u.pathname.includes(slug(r.plan.place)) ? 2 : 0) + (u.search ? 0 : 1);
  };
  const byPlace = new Map();
  const seen = new Set();
  for (const r of results) {
    if (r.raw_content || listingUrl(r.url) || seen.has(r.url)) continue;
    seen.add(r.url);
    if (!byPlace.has(r.plan.place)) byPlace.set(r.plan.place, []);
    byPlace.get(r.plan.place).push(r);
  }
  const lists = [...byPlace.values()].map((l) => l.sort((a, b) => rank(b) - rank(a)).slice(0, perPlace));
  const out = [];
  for (let i = 0; out.length < max && lists.some((l) => i < l.length); i += 1) {
    for (const l of lists) if (l[i] && out.length < max) out.push({ url: l[i].url, plan: l[i].plan });
  }
  return out;
}

// True for casa.it and www.casa.it, not for wikicasa.it.
const onSite = (hostname, site) => hostname === site || hostname.endsWith(`.${site}`);

// { url, portal, id } when href is a single listing on a known portal, else null.
export function listingUrl(href, base) {
  let url;
  try {
    url = new URL(href, base);
  } catch {
    return null;
  }
  const portal = Object.keys(LISTING_PATH).find((p) => onSite(url.hostname, p));
  const m = portal && url.pathname.match(LISTING_PATH[portal]);
  return m ? { url: `${url.origin}${url.pathname}`, portal, id: m[1] } : null;
}

// Markdown to plain text: no images, links reduced to their text, whitespace collapsed.
export function plain(md, max = 1200) {
  return String(md)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*>|`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The listings a search result points to: the page itself when it is a single listing; otherwise every listing it
// links to, each with the text of its card (from the line of its first link to the next listing's).
export function listingsInResult(result) {
  const self = listingUrl(result.url);
  if (self) return [{ ...self, title: result.title || '', text: plain(result.raw_content || result.content || '') }];
  const page = result.raw_content || '';
  const starts = [];
  const seen = new Set();
  for (const m of page.matchAll(/\]\(([^)\s]+)/g)) {
    const found = listingUrl(m[1], result.url);
    if (!found || seen.has(`${found.portal}:${found.id}`)) continue;
    seen.add(`${found.portal}:${found.id}`);
    starts.push({ ...found, at: page.lastIndexOf('\n', m.index) + 1 });
  }
  return starts
    .map((s, i) => {
      const card = page.slice(s.at, starts[i + 1]?.at ?? page.length);
      const title = card.match(new RegExp(`\\[([^\\]]{3,})\\]\\([^)]*${escape(s.id)}`))?.[1].trim() || '';
      return { url: s.url, portal: s.portal, id: s.id, title, text: plain(card) };
    })
    .filter((c) => c.text.length >= 40);
}

// Numbers as Italian listings write them: "1.100.000" and "295000" are whole numbers, "1,5" and "3.5" decimals.
export function amount(s) {
  const t = String(s).replace(/[^\d.,]/g, '');
  if (/^\d{1,3}(?:\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ''));
  if (t.includes(',')) return Number(t.replace(/\./g, '').replace(',', '.'));
  return Number(t);
}

const TYPE_PATTERNS = [
  ['farmhouse', /masseria|trull|casale|casolare|lamia|baglio|cascina/i],
  ['villa', /villa/i],
  ['apartment', /appartament|attico|monolocale|bilocale|trilocale|quadrilocale|mansarda|loft/i],
  ['rustic', /rudere|rustico/i],
  ['townhouse', /casa indipendente|casa semindipendente|palazz/i],
];

// What can be read from a listing without a language model. Used when the model is missing or fails.
export function quickFacts(text, title = '') {
  const s = ` ${text} `;
  const count = (re) => {
    const m = s.match(re);
    return m ? Number(m[1] ?? m[2]) : null;
  };
  // Thousands only with a dot: card text runs on, so in "€ 450.000 180 m²" a space would join price and size.
  const prices = [...s.matchAll(/€\s?(\d{1,3}(?:\.\d{3})+|\d{5,})|(\d{1,3}(?:\.\d{3})+|\d{5,})\s?(?:€|euro)/gi)].map((m) => amount(m[1] ?? m[2]));
  const surface = s.match(/(\d{1,3}(?:\.\d{3})+|\d{2,5})\s?(?:m²|mq|m2|sqm)(?![a-z])/i);
  const hectares = s.match(/(\d+(?:[.,]\d+)?)\s?ettar/i);
  const landM2 = s.match(/terreno[^.\d]{0,30}?(\d{1,3}(?:\.\d{3})+|\d{3,6})\s?(?:m²|mq|m2)(?![a-z])/i);
  const sea = s.match(/(\d+(?:[.,]\d+)?)\s?(km|chilometri|metri|mt|m)\s(?:circa\s)?(?:dal|dalla|dalle|dai)\s(?:mare|spiagg|costa)/i);
  const poolPossible = /(?:possibilit|realizzabil|realizzare|progett|costruire)[^.]{0,40}piscina|piscina[^.]{0,20}(?:realizzabil|da realizzare|in progetto)/i.test(s);
  const kind = `${title} ${text.slice(0, 200)}`;
  return {
    price: prices.find((n) => n >= 10000) ?? null,
    surface: surface ? amount(surface[1]) : null,
    rooms: count(/(\d{1,2})\s?\+?\s?locali|locali:?\s?(\d{1,2})/i),
    bedrooms: count(/(\d{1,2})\s?camer[ae] da letto|camere da letto:?\s?(\d{1,2})/i),
    bathrooms: count(/(\d{1,2})\s?bagn[oi]|bagn[oi]:?\s?(\d{1,2})/i),
    land: hectares ? Math.round(amount(hectares[1]) * 10000) : landM2 ? amount(landM2[1]) : null,
    type: TYPE_PATTERNS.find(([, re]) => re.test(kind))?.[0] ?? null,
    pool: !poolPossible && /piscina/i.test(s) ? true : null,
    poolPossible: poolPossible || null,
    seaView: /vista (?:sul |panoramica sul )?mare|affaccio sul mare/i.test(s) || null,
    distanceSea: sea ? amount(sea[1]) / (/^k|^c/i.test(sea[2]) ? 1 : 1000) : null,
  };
}

// False when a known price is beyond what the brief accepts: over a price deal breaker, or more than 20% over budget
// (where the matching engine stops giving any credit).
export function withinBudget(w, price) {
  if (price == null) return true;
  const breaker = (w.dealBreakers || []).find((c) => c.key === 'price');
  if (breaker) return price <= breaker.value;
  const budget = wanted(w, 'price');
  return !budget || price <= budget.value * 1.2;
}

const INSTRUCTIONS = `For each listing below, report only what its text states. Use null when the text does not say it: never guess.
Fields:
- i: the listing number
- title: short English title, at most 8 words, for example "Restored trullo with pool and olive grove"
- city: the town or locality
- type: "villa", "farmhouse" (masseria, trullo, casale, lamia, country house), "apartment", "townhouse" (house in a town or historic centre), "rustic" (ruin or rustico to restore) or null
- price: asking price in euros, as a number
- rooms ("locali"), bedrooms ("camere da letto"), bathrooms: numbers
- surface: living area in m²
- land: land or garden in m² (1 ettaro = 10000)
- pool: true if it has a pool, false only if the text says it has none
- poolPossible: true if the text says a pool could be built
- seaView: true if the text mentions a sea view
- distanceSea, distanceTown, distanceAirport: kilometres, only when given in km or metres
- condition: "move-in" (new, renovated, ready to live in), "light-refresh" (good, some updating), "renovation" (to renovate), "restoration" (ruin, to restore completely) or null
- summary: one English sentence of at most 25 words with what a buyer would want to know
Reply with JSON only: {"listings":[{"i":0,...}]}, one object per listing.`;

export function extractionMessages(cards) {
  const listings = cards.map((c, i) => `Listing ${i} (${c.portal})\n${c.title ? `${c.title}\n` : ''}${c.text}`).join('\n\n');
  return [
    { role: 'system', content: 'You read Italian property listings and reply with JSON only.' },
    { role: 'user', content: `${INSTRUCTIONS}\n\n${listings}` },
  ];
}

function parseJson(text) {
  const s = String(text).replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```(?:json)?/g, '');
  for (const [open, close] of [['{', '}'], ['[', ']']]) {
    const a = s.indexOf(open);
    const b = s.lastIndexOf(close);
    if (a === -1 || b <= a) continue;
    try {
      return JSON.parse(s.slice(a, b + 1));
    } catch {
      // try the other bracket
    }
  }
  throw new Error('The language model did not reply with JSON.');
}

const num = (v) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /\d/.test(v) ? amount(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};
const flag = (v) => (v === true || v === false ? v : null);
const oneOf = (v, list) => (list.includes(v) ? v : null);
const words = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// The model's reply as one entry per listing, in order; null where it said nothing usable.
export function parseExtraction(text, count) {
  const data = parseJson(text);
  const items = Array.isArray(data) ? data : data?.listings || [];
  const out = Array(count).fill(null);
  items.forEach((x, k) => {
    const i = Number.isInteger(x?.i) ? x.i : k;
    if (!x || i < 0 || i >= count) return;
    out[i] = {
      title: words(x.title, 80), city: words(x.city, 60), summary: words(x.summary, 240),
      type: oneOf(x.type, TYPES), condition: oneOf(x.condition, CONDITIONS),
      price: num(x.price), rooms: num(x.rooms), bedrooms: num(x.bedrooms), bathrooms: num(x.bathrooms), surface: num(x.surface), land: num(x.land),
      pool: flag(x.pool), poolPossible: flag(x.poolPossible), seaView: flag(x.seaView),
      distanceSea: num(x.distanceSea), distanceTown: num(x.distanceTown), distanceAirport: num(x.distanceAirport),
    };
  });
  return out;
}

// A listing in the shape of js/api/apimo.js normalize(), so the matching engine and the consultant area read it
// like any other property. What the model read wins over the patterns; anything unknown stays null ("to check").
// Numbers the model left out fall back to the patterns, which only copy figures from the text. Pool and view come
// from the patterns only when the model did not read the listing: a keyword is weaker evidence.
export function toProperty(card, read) {
  const f = card.facts || quickFacts(card.text, card.title);
  const x = read || {};
  const pick = (key) => x[key] ?? f[key] ?? null;
  const said = (key) => (read ? x[key] ?? null : f[key] ?? null);
  return {
    id: `web-${card.portal}-${card.id}`,
    reference: `${card.portal} ${card.id}`,
    source: 'web',
    status: 'available',
    url: card.url,
    portal: card.portal,
    title: x.title || card.title || `Listing on ${card.portal}`,
    summary: x.summary || '',
    type: pick('type'),
    price: pick('price'),
    currency: 'EUR',
    region: card.region ?? null,
    city: x.city || card.place || '',
    area: '',
    rooms: pick('rooms'),
    bedrooms: pick('bedrooms'),
    bathrooms: pick('bathrooms'),
    surface: pick('surface'),
    land: pick('land'),
    pool: said('pool'),
    poolPossible: said('poolPossible'),
    seaView: said('seaView'),
    distances: { sea: pick('distanceSea'), airport: x.distanceAirport ?? null, town: x.distanceTown ?? null },
    airportName: '',
    condition: x.condition ?? null,
    energyClass: null,
    readBy: read ? 'model' : 'patterns',
    foundWith: card.query || '',
  };
}

const KNOWN = ['price', 'type', 'bedrooms', 'bathrooms', 'surface', 'land', 'pool', 'seaView', 'condition'];
const knownCount = (p) => KNOWN.filter((k) => p[k] != null).length + Object.values(p.distances).filter((v) => v != null).length;
const town = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');

// The same home is often on several portals: same price and town, living area within 5%.
function sameHome(a, b) {
  if (a.id === b.id) return true;
  if (a.price == null || a.price !== b.price || !town(a.city) || town(a.city) !== town(b.city)) return false;
  return a.surface != null && b.surface != null && Math.abs(a.surface - b.surface) <= Math.max(5, a.surface * 0.05);
}

// One entry per home, keeping the listing with more known details.
export function mergeDuplicates(properties) {
  const out = [];
  for (const p of properties) {
    const i = out.findIndex((q) => sameHome(p, q));
    if (i === -1) out.push(p);
    else if (knownCount(p) > knownCount(out[i])) out[i] = p;
  }
  return out;
}
