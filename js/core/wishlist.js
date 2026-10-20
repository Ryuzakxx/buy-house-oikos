// The buyer wishlist: { mustHave, niceToHave, dealBreakers, context }.
// Each criterion is { key, op, value } and is read by the matching engine.
import { t, LOCALE } from './i18n.js';

const LISTS = { must: 'mustHave', nice: 'niceToHave', dealbreaker: 'dealBreakers' };
export const PRIORITIES = Object.entries(LISTS).map(([id, list]) => ({
  id,
  list,
  get label() { return t(`priorities.${id}.label`); },
  get note() { return t(`priorities.${id}.note`); },
}));
export const LIST_OF = LISTS;
export const MARK_CLASS = { must: 'mark--must', nice: 'mark--nice', dealbreaker: 'mark--never' };

export const REGION_LABELS = t('labels.region');
export const TYPE_LABELS = t('labels.type');
export const CONDITION_LABELS = t('labels.condition');

// Everything the consultant area needs to edit a criterion of each key.
export const CRITERIA = {
  region: { label: 'Area', op: 'in', options: REGION_LABELS },
  price: { label: 'Budget', op: 'lte', unit: '€' },
  type: { label: 'Type of property', op: 'in', options: TYPE_LABELS },
  bedrooms: { label: 'Bedrooms', op: 'gte' },
  bathrooms: { label: 'Bathrooms', op: 'gte' },
  condition: { label: 'Condition', op: 'in', options: CONDITION_LABELS },
  pool: { label: 'Pool', op: 'eq' },
  poolOrSpace: { label: 'Pool or room for one', op: 'eq' },
  land: { label: 'Land', op: 'gte', unit: 'm²' },
  seaView: { label: 'Sea view', op: 'eq' },
  distanceSea: { label: 'Distance to the sea', op: 'lte', unit: 'km' },
  distanceAirport: { label: 'Distance to an airport', op: 'lte', unit: 'km' },
  distanceTown: { label: 'Distance to shops', op: 'lte', unit: 'km' },
};

const euro = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat(LOCALE);
export const formatEuro = (n) => euro.format(n);

const listText = (values, labels) => values.map((v) => labels[v] || String(v).replace(/^other:/, '')).join(', ');
const landText = (m2) => (m2 >= 10000 ? `${num.format(m2 / 10000)} ha` : `${num.format(m2)} m²`);

export function describeCriterion(c) {
  switch (c.key) {
    case 'region': return t('criteria.region', { list: listText(c.value, REGION_LABELS) });
    case 'price': return t('criteria.price', { amount: formatEuro(c.value) });
    case 'type': return listText(c.value, TYPE_LABELS);
    case 'bedrooms': return c.value > 1 ? t('criteria.bedrooms', { n: c.value }) : t('criteria.bedroomsOne');
    case 'bathrooms': return c.value > 1 ? t('criteria.bathrooms', { n: c.value }) : t('criteria.bathroomsOne');
    case 'condition': return t('criteria.condition', { list: listText(c.value, CONDITION_LABELS).toLowerCase() });
    case 'pool': return t('criteria.pool');
    case 'poolOrSpace': return t('criteria.poolOrSpace');
    case 'land': return t('criteria.land', { area: landText(c.value) });
    case 'seaView': return t('criteria.seaView');
    case 'distanceSea': return c.value <= 1 ? t('criteria.distanceSeaWalk') : t('criteria.distanceSea', { n: c.value });
    case 'distanceAirport': return t('criteria.distanceAirport', { n: c.value });
    case 'distanceTown': return c.value <= 1 ? t('criteria.distanceTownWalk') : t('criteria.distanceTown', { n: c.value });
    default: return c.label || c.key;
  }
}

// Property values are shown only in the consultant area, which is in English.
export function propertyValueText(key, p) {
  const yesNo = (v) => (v == null ? 'unknown' : v ? 'yes' : 'no');
  switch (key) {
    case 'region': return REGION_LABELS[p.region] || p.region || 'unknown';
    case 'price': return p.price == null ? 'price on request' : formatEuro(p.price);
    case 'type': return TYPE_LABELS[p.type] || p.type || 'unknown';
    case 'bedrooms': return p.bedrooms == null ? 'unknown' : `${p.bedrooms}`;
    case 'bathrooms': return p.bathrooms == null ? 'unknown' : `${p.bathrooms}`;
    case 'condition': return CONDITION_LABELS[p.condition] || 'unknown';
    case 'pool': return yesNo(p.pool);
    case 'poolOrSpace': return p.pool ? 'has a pool' : p.poolPossible ? 'room for one' : p.poolPossible == null ? 'unknown' : 'no';
    case 'land': return p.land == null ? 'unknown' : p.land ? landText(p.land) : 'none';
    case 'seaView': return yesNo(p.seaView);
    case 'distanceSea': return p.distances?.sea == null ? 'unknown' : `${num.format(p.distances.sea)} km`;
    case 'distanceAirport': return p.distances?.airport == null ? 'unknown' : `${num.format(p.distances.airport)} km${p.airportName ? ` (${p.airportName})` : ''}`;
    case 'distanceTown': return p.distances?.town == null ? 'unknown' : `${num.format(p.distances.town)} km`;
    default: return 'unknown';
  }
}

export function emptyWishlist() {
  return { mustHave: [], niceToHave: [], dealBreakers: [], context: {}, status: 'draft', updatedAt: new Date().toISOString() };
}

export function allCriteria(w) {
  return PRIORITIES.flatMap((p) => (w[p.list] || []).map((c) => ({ ...c, priority: p.id })));
}

export function setCriterion(w, criterion, priority) {
  const next = removeCriterion(w, criterion.key);
  next[LIST_OF[priority]] = [...next[LIST_OF[priority]], { key: criterion.key, op: criterion.op, value: criterion.value }];
  return next;
}

export function removeCriterion(w, key) {
  const next = { ...w, updatedAt: new Date().toISOString() };
  for (const p of PRIORITIES) next[p.list] = (w[p.list] || []).filter((c) => c.key !== key);
  return next;
}

export function findCriterion(w, key) {
  return allCriteria(w).find((c) => c.key === key) || null;
}

// Feedback after a proposal or visit nudges the brief: each reason tightens or promotes one criterion.
export const FEEDBACK_REASONS = {
  'far-sea': 'Too far from the sea',
  'far-town': 'Too isolated from shops and services',
  'far-airport': 'Too far from the airport',
  'too-much-work': 'Too much renovation needed',
  'too-small': 'Too small',
  'no-view': 'Wanted a sea view',
  'no-pool': 'Wanted a pool',
  price: 'Too expensive for what it is',
  area: "Didn't like the area",
};

const CONDITION_ORDER = ['move-in', 'light-refresh', 'renovation', 'restoration'];

export function applyFeedback(w, property, reasons) {
  let next = { ...w };
  const changes = [];
  const promote = (key, op, value, text) => {
    const existing = findCriterion(next, key);
    const priority = existing?.priority === 'dealbreaker' ? 'dealbreaker' : 'must';
    next = setCriterion(next, { key, op, value }, priority);
    changes.push(existing ? `${text}: now ${PRIORITIES.find((p) => p.id === priority).label.toLowerCase()}, ${describeCriterion({ key, op, value }).toLowerCase()}` : `${text}: added as must have, ${describeCriterion({ key, op, value }).toLowerCase()}`);
  };
  const tighter = (key, actual, fallback) => {
    const existing = findCriterion(next, key);
    const limit = actual == null ? fallback : Math.max(1, Math.floor(actual * 0.6));
    return existing ? Math.min(existing.value, limit) : limit;
  };
  for (const reason of reasons) {
    if (reason === 'far-sea') promote('distanceSea', 'lte', tighter('distanceSea', property.distances?.sea, 10), 'Distance to the sea');
    if (reason === 'far-town') promote('distanceTown', 'lte', tighter('distanceTown', property.distances?.town, 5), 'Distance to shops');
    if (reason === 'far-airport') promote('distanceAirport', 'lte', tighter('distanceAirport', property.distances?.airport, 60), 'Distance to an airport');
    if (reason === 'no-view') promote('seaView', 'eq', true, 'Sea view');
    if (reason === 'no-pool') promote('pool', 'eq', true, 'Pool');
    if (reason === 'too-small' && property.bedrooms != null) {
      const existing = findCriterion(next, 'bedrooms');
      promote('bedrooms', 'gte', Math.max(existing?.value || 0, property.bedrooms + 1), 'Bedrooms');
    }
    if (reason === 'too-much-work' && property.condition) {
      const limit = CONDITION_ORDER.indexOf(property.condition);
      const existing = findCriterion(next, 'condition');
      const accepted = (existing?.value || CONDITION_ORDER).filter((c) => CONDITION_ORDER.indexOf(c) < limit);
      if (accepted.length) promote('condition', 'in', accepted, 'Condition');
    }
    if (reason === 'price' || reason === 'area') {
      const note = `${FEEDBACK_REASONS[reason]} (${property.title || property.reference})`;
      next = { ...next, context: { ...next.context, feedbackNotes: [...(next.context?.feedbackNotes || []), note] } };
      changes.push(`Noted for the consultant: ${note.toLowerCase()}`);
    }
  }
  return { wishlist: { ...next, updatedAt: new Date().toISOString() }, changes };
}
