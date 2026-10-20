// Unit tests for the browser-independent modules. Run: node tools/test-core.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalize } from '../js/api/apimo.js';
import { matchProperties, scoreProperty, satisfaction } from '../js/api/matching.js';
import { generateWishlistFromTranscript, SAMPLE_TRANSCRIPT } from '../js/api/transcription.js';
import { STEPS, buildWishlist, interpretSpoken, interpretPriority, parseAmount, needsPriority, STEP_BY_ID } from '../js/core/interview.js';
import { applyFeedback, describeCriterion } from '../js/core/wishlist.js';
import { attribution } from '../js/api/partners.js';
import { zonedInstant, zoneOffsetMinutes } from '../js/core/time.js';

const raw = JSON.parse(await readFile(new URL('../data/properties.json', import.meta.url), 'utf8'));
const properties = raw.properties.map(normalize);
const byId = (id) => properties.find((p) => p.id === id);
let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`ok  ${name}`); };

test('feed has 12 sample properties for matching', () => {
  assert.equal(properties.length, 12);
});

test('interview has 18 steps, matching the copy on the site', () => {
  assert.equal(STEPS.length, 18);
});

test('deal breaker excludes, must weighs 3, nice weighs 1', () => {
  const w = {
    mustHave: [{ key: 'region', op: 'in', value: ['puglia'] }],
    niceToHave: [{ key: 'pool', op: 'eq', value: true }],
    dealBreakers: [{ key: 'condition', op: 'in', value: ['move-in'] }],
  };
  const masseria = scoreProperty(w, byId(1001));
  assert.equal(masseria.excluded, false);
  assert.equal(masseria.score, 100);
  const trulli = scoreProperty(w, byId(1002));
  assert.equal(trulli.excluded, true, 'light-refresh is ruled out by the deal breaker');
  const noPool = scoreProperty({ ...w, dealBreakers: [] }, byId(1002));
  assert.equal(noPool.score, 75, 'must met (3) + nice missed (0) of 4');
});

test('a must have missed outright pulls the score below the match threshold', () => {
  const w = { mustHave: [{ key: 'region', op: 'in', value: ['lake-como'] }, { key: 'price', op: 'lte', value: 500000 }, { key: 'bedrooms', op: 'gte', value: 3 }], niceToHave: [{ key: 'distanceTown', op: 'lte', value: 1 }], dealBreakers: [] };
  assert.equal(scoreProperty(w, byId(1006)).score, 49, 'Noto: right size and price, wrong region');
});

test('budget over the limit gets partial credit within 20%', () => {
  const c = { key: 'price', op: 'lte', value: 1000000 };
  assert.equal(satisfaction(c, { price: 900000 }).s, 1);
  assert.equal(satisfaction(c, { price: 1100000 }).status, 'partial');
  assert.equal(satisfaction(c, { price: 1300000 }).status, 'missed');
});

test('unknown property data is flagged, not excluded', () => {
  const r = scoreProperty({ mustHave: [], niceToHave: [], dealBreakers: [{ key: 'pool', op: 'eq', value: true }] }, { ...byId(1001), pool: null });
  assert.equal(r.excluded, false);
  assert.equal(r.unknown.length, 1);
});

test('sold properties are not matched', () => {
  const all = matchProperties({ mustHave: [], niceToHave: [], dealBreakers: [] }, properties);
  assert.ok(!all.some((m) => m.property.status === 'sold'));
});

test('Lake Como under 500k with move-in deal breaker finds nothing (no-match path)', () => {
  const w = { mustHave: [{ key: 'region', op: 'in', value: ['lake-como'] }, { key: 'price', op: 'lte', value: 500000 }], niceToHave: [], dealBreakers: [{ key: 'condition', op: 'in', value: ['move-in'] }] };
  assert.equal(matchProperties(w, properties, { minScore: 60 }).length, 0);
});

test('answers become a wishlist with priorities and context', () => {
  const w = buildWishlist({
    region: { value: ['puglia', 'tuscany'], priority: 'must' },
    budget: { value: 600000, priority: 'dealbreaker' },
    pool: { value: 'space', priority: 'nice' },
    seaView: { value: 'any', priority: null },
    timeline: { value: '6m' },
  });
  assert.deepEqual(w.mustHave, [{ key: 'region', op: 'in', value: ['puglia', 'tuscany'] }]);
  assert.deepEqual(w.dealBreakers, [{ key: 'price', op: 'lte', value: 600000 }]);
  assert.deepEqual(w.niceToHave, [{ key: 'poolOrSpace', op: 'eq', value: true }]);
  assert.equal(w.context.timeline, 'In 3 to 6 months');
  assert.equal(needsPriority(STEP_BY_ID.region, ['open']), false);
});

test('spoken answers are interpreted', () => {
  assert.equal(parseAmount('about 750,000 euros'), 750000);
  assert.equal(parseAmount('1.2 million'), 1200000);
  assert.equal(parseAmount('600k'), 600000);
  assert.deepEqual(interpretSpoken(STEP_BY_ID.region, 'Puglia and maybe Lake Como'), ['puglia', 'lake-como']);
  assert.equal(interpretSpoken(STEP_BY_ID.bedrooms, 'at least three'), 3);
  assert.equal(interpretSpoken(STEP_BY_ID.distanceSea, 'I want to walk to the beach'), 1);
  assert.equal(interpretSpoken(STEP_BY_ID.pool, "no, we don't need one"), 'any');
  assert.equal(interpretSpoken(STEP_BY_ID.pool, 'room to add one would be enough'), 'space');
  assert.equal(interpretPriority("it's a deal breaker"), 'dealbreaker');
  assert.equal(interpretPriority('nice to have'), 'nice');
  assert.equal(interpretPriority('must have'), 'must');
});

test('Italian spoken answers: thousands with dots, mila and milioni, Italian priorities and options', () => {
  assert.equal(parseAmount('circa 700.000 euro', 'it'), 700000);
  assert.equal(parseAmount('1,2 milioni', 'it'), 1200000);
  assert.equal(parseAmount('850 mila', 'it'), 850000);
  assert.equal(interpretPriority('per me è da escludere', 'it'), 'dealbreaker');
  assert.equal(interpretPriority('sarebbe bello', 'it'), 'nice');
  assert.equal(interpretPriority('è indispensabile', 'it'), 'must');
  assert.deepEqual(interpretSpoken(STEP_BY_ID.region, 'la Puglia o il lago di Como', 'it'), ['puglia', 'lake-como']);
  assert.equal(interpretSpoken(STEP_BY_ID.bedrooms, 'almeno tre', 'it'), 3);
  assert.equal(interpretSpoken(STEP_BY_ID.distanceSea, 'voglio andare al mare a piedi', 'it'), 1);
  assert.equal(interpretSpoken(STEP_BY_ID.pool, 'no, non serve', 'it'), 'any');
  assert.equal(interpretSpoken(STEP_BY_ID.pool, 'basta lo spazio per farla', 'it'), 'space');
  assert.deepEqual(interpretSpoken(STEP_BY_ID.type, 'una masseria o un trullo', 'it'), ['farmhouse']);
});

test('sample transcript produces the expected brief', () => {
  const r = generateWishlistFromTranscript(SAMPLE_TRANSCRIPT);
  const keys = (list) => list.map((c) => c.key).sort();
  assert.deepEqual(keys(r.mustHave), ['bedrooms', 'distanceSea', 'price', 'region']);
  assert.deepEqual(keys(r.niceToHave), ['distanceAirport', 'poolOrSpace', 'seaView']);
  assert.deepEqual(keys(r.dealBreakers), ['condition']);
  assert.equal(r.mustHave.find((c) => c.key === 'price').value, 900000);
  assert.equal(r.context.mortgage, 'No, buying with my own funds');
  assert.ok(r.evidence.length >= 8);
});

test('feedback "too far from the sea" promotes and tightens the criterion', () => {
  const w = { mustHave: [], niceToHave: [{ key: 'distanceSea', op: 'lte', value: 30 }], dealBreakers: [], context: {} };
  const { wishlist, changes } = applyFeedback(w, byId(1002), ['far-sea']);
  const c = wishlist.mustHave.find((x) => x.key === 'distanceSea');
  assert.ok(c, 'moved to must have');
  assert.equal(c.value, 13, '60% of the 22 km that was too far');
  assert.equal(wishlist.niceToHave.length, 0);
  assert.equal(changes.length, 1);
});

test('feedback "too much work" drops that condition and worse', () => {
  const { wishlist } = applyFeedback({ mustHave: [], niceToHave: [], dealBreakers: [], context: {} }, byId(1009), ['too-much-work']);
  assert.deepEqual(wishlist.mustHave[0].value, ['move-in', 'light-refresh']);
});

test('commission share only for partner listings sold to our buyers', () => {
  const sale = { value: 675000 };
  assert.deepEqual(attribution(sale, byId(1007), { id: 'b' }, { id: 'pa-03' }, 0.01).amount, 6750);
  assert.equal(attribution(sale, byId(1001), { id: 'b' }, null, 0.01).due, false);
  assert.equal(attribution(sale, byId(1007), null, { id: 'pa-03' }, 0.01).due, false);
});

test('Italian office hours convert across daylight saving', () => {
  assert.equal(zonedInstant('2026-07-15', 9, 0, 'Europe/Rome').toISOString(), '2026-07-15T07:00:00.000Z');
  assert.equal(zonedInstant('2026-12-15', 9, 0, 'Europe/Rome').toISOString(), '2026-12-15T08:00:00.000Z');
  assert.equal(zoneOffsetMinutes('America/New_York', new Date('2026-12-15T12:00:00Z')), -300);
});

test('criteria read naturally', () => {
  assert.equal(describeCriterion({ key: 'price', op: 'lte', value: 650000 }), 'Up to €650,000');
  assert.equal(describeCriterion({ key: 'land', op: 'gte', value: 10000 }), 'At least 1 ha of land');
});

console.log(`\n${passed} tests passed`);
