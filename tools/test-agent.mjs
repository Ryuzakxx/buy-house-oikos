// Unit tests for the web search agent and the search service, with made-up portal pages and no network.
// Run: node tools/test-agent.mjs
import assert from 'node:assert/strict';
import { planSearches, pagesToOpen, listingUrl, listingsInResult, quickFacts, amount, parseExtraction, withinBudget, mergeDuplicates, toProperty, PLACES_PER_ROUND } from '../js/core/web-listings.js';
import { findOnWeb } from '../js/api/web-search.js';
import { pickCandidates } from '../js/api/matching.js';
import worker from '../worker/index.js';

let passed = 0;
const test = async (name, fn) => { await fn(); passed += 1; console.log(`ok  ${name}`); };

// A page of results as the search service returns it from a portal (markdown), and a single listing as a snippet.
const LIST_PAGE = {
  url: 'https://www.casa.it/vendita/residenziale/ostuni/con-piscina',
  title: 'Case con piscina in vendita a Ostuni',
  content: 'Case con piscina in vendita a Ostuni',
  raw_content: [
    '[](/ "Case in vendita")',
    '# Case con piscina in vendita a Ostuni',
    '[![Foto](https://img.example/1.jpg)](/immobili/11111111/)',
    'Ti interessa?',
    '[Villa in Contrada Uno](/immobili/11111111/ "Villa in Contrada Uno")',
    '€ 450.000',
    '180 m²6 locali3 bagni',
    'Villa con piscina e 3 camere da letto, terreno di 1,5 ettari, a 6 km dal mare.',
    '[Agenzia Uno](/agenzie/agenzia-uno-1/ "Vedi tutti gli annunci")',
    '[Masseria in Contrada Due](/immobili/22222222/ "Masseria in Contrada Due")',
    '€ 2.400.000',
    '600 m²12 locali6 bagni',
    'Masseria fortificata con piscina e foresteria.',
    '[Trullo in Contrada Tre](/immobili/33333333/ "Trullo in Contrada Tre")',
    '€ 380.000',
    '120 m²5 locali2 bagni',
    'Trullo restaurato con 4 camere da letto e piscina, pronto da abitare.',
  ].join('\n'),
};
const SNIPPET = {
  url: 'https://www.immobiliare.it/annunci/44444444/',
  title: 'Trullo Contrada Quattro, Ostuni',
  content: 'Vendita. Superficie: 140 m². Locali: 5. Camere da letto: 4. Trullo con piscina, € 520.000',
};
const LIST_SNIPPET = { url: 'https://www.idealista.it/vendita-case/ostuni-brindisi/con-piscina', title: 'Case con piscina', content: 'Ostuni 890.000€ trullo con piscina' };

const BRIEF = {
  mustHave: [{ key: 'region', op: 'in', value: ['puglia'] }, { key: 'price', op: 'lte', value: 600000 }, { key: 'pool', op: 'eq', value: true }],
  niceToHave: [{ key: 'seaView', op: 'eq', value: true }],
  dealBreakers: [{ key: 'condition', op: 'in', value: ['move-in', 'light-refresh'] }],
};

await test('a round searches three towns on the portals that can be read, coast first when the sea is wanted', () => {
  const plan = planSearches(BRIEF);
  assert.equal(plan.length, PLACES_PER_ROUND);
  assert.deepEqual(plan.map((p) => p.place), ['Ostuni', 'Monopoli', 'Polignano a Mare']);
  assert.equal(plan[0].params.query, 'Casa in vendita Ostuni con piscina vista mare');
  assert.equal(plan[0].params.include_raw_content, 'markdown');
  assert.ok(plan[0].params.include_domains.includes('casa.it'));
  assert.ok(!plan[0].params.include_domains.includes('immobiliare.it'), 'its pages cannot be opened');
  assert.deepEqual(planSearches(BRIEF, { round: 1 }).map((p) => p.place), ['Fasano', 'Otranto', 'Gallipoli']);
});

await test('pages to open: casa.it pages about the town first, towns take turns, two each, none twice', () => {
  const at = (place) => ({ place });
  const [monopoli, polignano] = [at('Monopoli'), at('Polignano a Mare')];
  const results = [
    { url: 'https://www.casa.it/vendita/residenziale/monopoli/con-piscina?page=2', plan: monopoli },
    { url: 'https://www.wikicasa.it/vendita-case/monopoli', plan: monopoli },
    { url: 'https://www.casa.it/vendita/residenziale/monopoli/con-piscina', plan: monopoli },
    { url: 'https://www.casa.it/vendita/residenziale/ostuni/con-piscina', raw_content: 'already here', plan: monopoli },
    { url: 'https://www.casa.it/immobili/123456/', plan: monopoli },
    { url: 'https://www.casa.it/vendita/ville/bari-provincia', plan: polignano },
    { url: 'https://www.casa.it/vendita/ville/polignano-a-mare', plan: polignano },
    { url: 'https://www.casa.it/vendita/residenziale/monopoli/con-piscina', plan: polignano },
  ];
  assert.deepEqual(pagesToOpen(results).map((o) => o.url), [
    'https://www.casa.it/vendita/residenziale/monopoli/con-piscina',
    'https://www.casa.it/vendita/ville/polignano-a-mare',
    'https://www.casa.it/vendita/residenziale/monopoli/con-piscina?page=2',
    'https://www.casa.it/vendita/ville/bari-provincia',
  ]);
  assert.equal(pagesToOpen(results, { max: 3 }).length, 3);
});

await test('types become the words of Italian listings, regions take turns, other areas are searched by name', () => {
  const farm = planSearches({ mustHave: [{ key: 'region', op: 'in', value: ['puglia'] }, { key: 'type', op: 'in', value: ['farmhouse', 'villa'] }] });
  assert.deepEqual([...new Set(farm.map((p) => p.params.query.split(' in vendita')[0]))], ['Masseria', 'Trullo', 'Villa']);
  const two = planSearches({ mustHave: [{ key: 'region', op: 'in', value: ['sicily', 'liguria'] }] });
  assert.deepEqual([...new Set(two.map((p) => p.place))], ['Modica', 'Dolceacqua', 'Ragusa']);
  const other = { mustHave: [{ key: 'region', op: 'in', value: ['other:Umbria'] }, { key: 'bedrooms', op: 'gte', value: 3 }] };
  assert.equal(planSearches(other)[0].params.query, 'Casa in vendita Umbria 3 camere da letto');
  assert.equal(planSearches(other, { round: 1 }).length, 0, 'nothing left for a second round');
});

await test('single listings are recognised on every portal; pages of results are not', () => {
  assert.equal(listingUrl('https://casa.it/immobili/53578892').id, '53578892');
  assert.equal(listingUrl('/immobili/123456/', 'https://www.casa.it/vendita/x').url, 'https://www.casa.it/immobili/123456/');
  assert.equal(listingUrl('https://www.immobiliare.it/annunci/128236040/?x=1').url, 'https://www.immobiliare.it/annunci/128236040/');
  assert.equal(listingUrl('https://www.idealista.it/en/immobile/31234567/').portal, 'idealista.it');
  assert.equal(listingUrl('https://www.gate-away.com/properties/puglia/brindisi/ostuni/id/744211').id, '744211');
  assert.equal(listingUrl('https://www.wikicasa.it/annuncio/24655270').portal, 'wikicasa.it');
  assert.equal(listingUrl('https://www.casa.it/vendita/residenziale/ostuni/con-piscina'), null);
  assert.equal(listingUrl('https://www.example.com/immobili/123'), null);
  assert.equal(listingUrl('not a url'), null);
});

await test('a page of results splits into one card per listing; a single listing is one card; a bare list snippet none', () => {
  const cards = listingsInResult(LIST_PAGE);
  assert.deepEqual(cards.map((c) => c.id), ['11111111', '22222222', '33333333']);
  assert.equal(cards[0].title, 'Villa in Contrada Uno');
  assert.ok(cards[0].text.includes('€ 450.000') && !cards[0].text.includes('2.400.000'));
  assert.ok(!cards[0].text.includes('img.example'), 'images dropped');
  assert.equal(listingsInResult(SNIPPET).length, 1);
  assert.equal(listingsInResult(LIST_SNIPPET).length, 0);
});

await test('numbers and facts are read the way Italian listings write them', () => {
  assert.equal(amount('1.100.000'), 1100000);
  assert.equal(amount('295000'), 295000);
  assert.equal(amount('3.979'), 3979);
  assert.equal(amount('1,5'), 1.5);
  assert.equal(amount('3.5'), 3.5);
  const [villa] = listingsInResult(LIST_PAGE);
  assert.deepEqual(quickFacts(villa.text, villa.title), {
    price: 450000, surface: 180, rooms: 6, bedrooms: 3, bathrooms: 3, land: 15000, type: 'villa', pool: true, poolPossible: null, seaView: null, distanceSea: 6,
  });
  const f = quickFacts(SNIPPET.content, SNIPPET.title);
  assert.equal(f.price, 520000);
  assert.equal(f.bedrooms, 4);
  assert.equal(f.type, 'farmhouse');
  assert.equal(quickFacts('Ostuni 890.000€ 7.542 €/m2').price, 890000, 'price per m² is not the price');
  const project = quickFacts('Casale con vista mare a 300 metri dal mare, possibilità di realizzare la piscina.');
  assert.deepEqual([project.pool, project.poolPossible, project.seaView, project.distanceSea], [null, true, true, 0.3]);
  assert.equal(quickFacts('a 15 minuti dalle spiagge').distanceSea, null, 'minutes are not kilometres');
});

await test("the model's reply is checked: fenced or wrapped JSON, unknown values dropped, missing listings null", () => {
  const reply = '<think>{draft}</think>```json\n{"listings":[{"i":1,"price":"450.000","type":"castle","pool":"yes","seaView":true,"bedrooms":3,"condition":"move-in","title":"Villa"}]}\n```';
  const [a, b] = parseExtraction(reply, 2);
  assert.equal(a, null);
  assert.equal(b.price, 450000);
  assert.equal(b.type, null);
  assert.equal(b.pool, null);
  assert.equal(b.seaView, true);
  assert.equal(b.condition, 'move-in');
  assert.throws(() => parseExtraction('Sorry, I cannot help.', 1));
});

await test('budget filter, duplicates across portals, and the 5 to 10 pick', () => {
  assert.equal(withinBudget(BRIEF, 700000), true, 'within 20% over budget');
  assert.equal(withinBudget(BRIEF, 800000), false);
  assert.equal(withinBudget({ dealBreakers: [{ key: 'price', op: 'lte', value: 600000 }] }, 650000), false);
  assert.equal(withinBudget(BRIEF, null), true);

  const card = (portal, id, facts) => ({ portal, id, url: `https://${portal}/${id}`, text: '', title: 'x', place: 'Ostuni', region: 'puglia', facts });
  const a = toProperty(card('casa.it', '1', { price: 400000, surface: 150 }));
  const b = toProperty(card('immobiliare.it', '2', { price: 400000, surface: 152, bedrooms: 3 }));
  const c = toProperty(card('casa.it', '3', { price: 400000, surface: 300 }));
  assert.deepEqual(mergeDuplicates([a, b, c]).map((p) => p.id), ['web-immobiliare.it-2', 'web-casa.it-3']);

  const m = (score, excluded = false) => ({ score, excluded });
  assert.equal(pickCandidates([m(90), m(80), m(70), m(50), m(40), m(30), m(20)]).length, 5, 'topped up to 5 with weaker ones');
  assert.equal(pickCandidates(Array.from({ length: 14 }, () => m(80))).length, 10, 'never more than 10');
  assert.equal(pickCandidates([m(90, true), m(50)]).length, 1, 'ruled out never picked');
});

// Fake providers. Search finds the page of results without its content, a single listing and a page that cannot be
// opened; opening a page gives its content for casa.it only, as Tavily does.
const fakeSearch = (log) => async (params) => {
  log.push(params.query);
  return { results: [{ ...LIST_PAGE, raw_content: undefined }, SNIPPET, LIST_SNIPPET] };
};
const fakeExtract = (log) => async (urls) => {
  log.push(urls);
  return { results: urls.filter((u) => u.includes('casa.it')).map((url) => ({ url, raw_content: LIST_PAGE.raw_content })) };
};
const fakeModel = (calls) => async (messages) => {
  calls.push(messages);
  const listings = messages[1].content.split(/\nListing (\d+) \([^)]*\)\n/).slice(1);
  const out = [];
  for (let k = 0; k < listings.length; k += 2) {
    const text = listings[k + 1];
    out.push({ i: Number(listings[k]), pool: /piscina/i.test(text) ? true : null, condition: /restaurat|pronto/i.test(text) ? 'move-in' : null, city: 'Ostuni', summary: 'Made up.' });
  }
  return JSON.stringify({ listings: out });
};

await test('the agent searches, opens, reads, scores and keeps the listings that fit; a second round when too few', async () => {
  const queries = [];
  const opened = [];
  const calls = [];
  const steps = [];
  const r = await findOnWeb(BRIEF, { search: fakeSearch(queries), extract: fakeExtract(opened), llm: fakeModel(calls), onProgress: (p) => steps.push(p.step) });
  assert.equal(r.stats.searches, 6, 'only 3 fit, so a second round ran');
  assert.deepEqual(opened, [[LIST_PAGE.url, LIST_SNIPPET.url]], 'each page opened once, in the first round');
  assert.equal(r.stats.listings, 4, 'the same listings found again are not read twice');
  assert.equal(r.stats.read, 3, 'the masseria at 2.4 million is over budget and never sent to the model');
  assert.equal(calls.length, 1);
  assert.deepEqual(r.picked.map((m) => m.property.id).sort(), ['web-casa.it-11111111', 'web-casa.it-33333333', 'web-immobiliare.it-44444444']);
  const trullo = r.picked.find((m) => m.property.id === 'web-casa.it-33333333');
  assert.equal(trullo.property.condition, 'move-in');
  assert.equal(trullo.property.price, 380000);
  assert.equal(trullo.property.region, 'puglia');
  assert.ok(trullo.score >= 60);
  assert.ok(r.picked.every((m) => m.property.url.startsWith('https://')));
  assert.deepEqual(steps, ['search', 'open', 'read', 'search', 'read', 'done']);
});

await test('without a working model the agent still answers, from what patterns can read', async () => {
  const broken = async () => { throw new Error('quota used up'); };
  const r = await findOnWeb(BRIEF, { search: fakeSearch([]), extract: fakeExtract([]), llm: broken, rounds: 1 });
  assert.equal(r.stats.modelErrors[0], 'quota used up');
  assert.equal(r.properties.length, 3);
  assert.ok(r.properties.every((p) => p.readBy === 'patterns'));
  assert.equal(r.properties.find((p) => p.id === 'web-casa.it-11111111').price, 450000);
  const failing = await findOnWeb(BRIEF, { search: async () => { throw new Error('offline'); } });
  assert.equal(failing.stats.failedSearches, 3, 'no second round once every search of the first failed');
  assert.equal(failing.picked.length, 0);
  const unopened = await findOnWeb(BRIEF, { search: fakeSearch([]), extract: async () => { throw new Error('limit'); }, rounds: 1 });
  assert.deepEqual(unopened.properties.map((p) => p.id), ['web-immobiliare.it-44444444'], 'single listings still count when pages cannot be opened');
});

// The search service, with Cloudflare's bindings and Tavily replaced by stubs.
const env = { ACCESS_KEY: 'secret', ALLOWED_ORIGINS: 'https://ryuzakxx.github.io', AI: { run: async () => ({ choices: [{ message: { content: '{"listings":[]}' } }] }) } };
const call = (path, { method = 'POST', key = 'secret', origin = 'https://ryuzakxx.github.io', body } = {}) => worker.fetch(new Request(`https://svc.example${path}`, {
  method,
  headers: { origin, ...(key ? { authorization: `Bearer ${key}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined,
}), env);

await test('search service: CORS for the site only, access key required, model replies normalised', async () => {
  const pre = await call('/llm', { method: 'OPTIONS', key: null });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), 'https://ryuzakxx.github.io');
  assert.equal((await call('/llm', { method: 'OPTIONS', key: null, origin: 'https://evil.example' })).headers.get('access-control-allow-origin'), null);
  assert.equal((await call('/status', { method: 'GET', key: 'wrong' })).status, 401);
  assert.deepEqual(await (await call('/status', { method: 'GET' })).json(), { search: 'tavily-keyless', model: '@cf/google/gemma-4-26b-a4b-it' });
  assert.deepEqual(await (await call('/llm', { body: { messages: [{ role: 'user', content: 'x' }] } })).json(), { text: '{"listings":[]}' });
  env.AI.run = async () => ({ response: 'plain' });
  assert.equal((await (await call('/llm', { body: { messages: [{ role: 'user', content: 'x' }] } })).json()).text, 'plain');
  assert.equal((await call('/llm', { body: { messages: [] } })).status, 502);
});

await test('search service: forwards only search fields to Tavily, with the key, at most 20 results', async () => {
  const realFetch = globalThis.fetch;
  let sent;
  globalThis.fetch = async (url, init) => { sent = { url, headers: init.headers, body: JSON.parse(init.body) }; return new Response('{"results":[]}', { status: 200 }); };
  try {
    env.TAVILY_API_KEY = 'tvly-test';
    const res = await call('/search', { body: { query: 'Villa in vendita Ostuni', max_results: 50, include_domains: ['casa.it'], api_key: 'x', topic: 'news' } });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { results: [] });
    assert.equal(sent.url, 'https://api.tavily.com/search');
    assert.equal(sent.headers.authorization, 'Bearer tvly-test');
    assert.deepEqual(sent.body, { query: 'Villa in vendita Ostuni', max_results: 20, include_domains: ['casa.it'] });
    assert.equal((await call('/search', { body: { query: ' ' } })).status, 400);
    const urls = ['http://insecure.example/', ...Array.from({ length: 7 }, (_, i) => `https://www.casa.it/vendita/x/${i}`)];
    assert.equal((await call('/extract', { body: { urls, extract_depth: 'advanced' } })).status, 200);
    assert.equal(sent.url, 'https://api.tavily.com/extract');
    assert.deepEqual(sent.body, { urls: urls.slice(1, 6), format: 'markdown' }, 'https only, five at most, basic depth');
    assert.equal((await call('/extract', { body: { urls: [] } })).status, 400);
  } finally {
    globalThis.fetch = realFetch;
    delete env.TAVILY_API_KEY;
  }
});

console.log(`\n${passed} tests passed`);
