// The interview: one list of questions shared by the guided chat and the voice interview.
// Criterion steps produce a matching criterion and ask for a priority; context steps only inform the consultant.
// Texts come from js/i18n/<lang>.js; this file holds only structure and values.
import { read, write, remove } from '../api/storage.js';
import { REGION_LABELS, TYPE_LABELS, CONDITION_LABELS, LIST_OF, emptyWishlist, formatEuro } from './wishlist.js';
import { t, maybe, LANG } from './i18n.js';

const ANY = 'any';

function optionLabel(stepId, value) {
  return maybe(`steps.${stepId}.o.${value}`) ?? maybe(`labels.${stepId}.${value}`) ?? String(value);
}

const option = (stepId, value, extra = {}) => ({ value, ...extra, get label() { return optionLabel(stepId, value); } });
const options = (stepId, values) => values.map((v) => option(stepId, v));

function step(def) {
  const { id } = def;
  return Object.defineProperties(def, {
    question: { enumerable: true, get: () => t(`steps.${id}.q`) },
    help: { enumerable: true, get: () => maybe(`steps.${id}.help`) },
    placeholder: { enumerable: true, get: () => maybe(`steps.${id}.ph`) },
  });
}

export const STEPS = [
  step({
    id: 'region', kind: 'criterion', input: 'multi',
    options: [...options('region', Object.keys(REGION_LABELS)), option('region', 'open', { exclusive: true })],
    other: { get label() { return t('steps.region.other'); }, get placeholder() { return t('steps.region.otherPh'); } },
    toCriterion: (v) => (v.includes('open') ? null : { key: 'region', op: 'in', value: v }),
  }),
  step({
    id: 'budget', kind: 'criterion', input: 'single',
    options: options('budget', [300000, 600000, 1000000, 2000000, ANY]),
    custom: { type: 'number', min: 20000, step: 1000, get label() { return t('steps.budget.custom'); } },
    toCriterion: (v) => ({ key: 'price', op: 'lte', value: Number(v) }),
  }),
  step({
    id: 'type', kind: 'criterion', input: 'multi',
    options: [...options('type', Object.keys(TYPE_LABELS)), option('type', ANY, { exclusive: true })],
    toCriterion: (v) => ({ key: 'type', op: 'in', value: v }),
  }),
  step({
    id: 'bedrooms', kind: 'criterion', input: 'single',
    options: options('bedrooms', [1, 2, 3, 4, 5, ANY]),
    toCriterion: (v) => ({ key: 'bedrooms', op: 'gte', value: Number(v) }),
  }),
  step({
    id: 'bathrooms', kind: 'criterion', input: 'single',
    options: options('bathrooms', [1, 2, 3, ANY]),
    toCriterion: (v) => ({ key: 'bathrooms', op: 'gte', value: Number(v) }),
  }),
  step({
    id: 'condition', kind: 'criterion', input: 'multi',
    options: options('condition', Object.keys(CONDITION_LABELS)),
    toCriterion: (v) => (v.length === Object.keys(CONDITION_LABELS).length ? null : { key: 'condition', op: 'in', value: v }),
  }),
  step({ id: 'renovate', kind: 'context', input: 'single', options: options('renovate', ['yes', 'light', 'no']) }),
  step({
    id: 'pool', kind: 'criterion', input: 'single',
    options: options('pool', ['yes', 'space', ANY]),
    toCriterion: (v) => (v === 'yes' ? { key: 'pool', op: 'eq', value: true } : { key: 'poolOrSpace', op: 'eq', value: true }),
  }),
  step({
    id: 'land', kind: 'criterion', input: 'single',
    options: options('land', [1000, 10000, 50000, ANY]),
    toCriterion: (v) => ({ key: 'land', op: 'gte', value: Number(v) }),
  }),
  step({
    id: 'seaView', kind: 'criterion', input: 'single',
    options: options('seaView', ['yes', ANY]),
    toCriterion: () => ({ key: 'seaView', op: 'eq', value: true }),
  }),
  step({
    id: 'distanceSea', kind: 'criterion', input: 'single',
    options: options('distanceSea', [1, 10, 30, ANY]),
    toCriterion: (v) => ({ key: 'distanceSea', op: 'lte', value: Number(v) }),
  }),
  step({
    id: 'distanceAirport', kind: 'criterion', input: 'single',
    options: options('distanceAirport', [30, 60, 100, ANY]),
    toCriterion: (v) => ({ key: 'distanceAirport', op: 'lte', value: Number(v) }),
  }),
  step({
    id: 'distanceTown', kind: 'criterion', input: 'single',
    options: options('distanceTown', [1, 5, 15, ANY]),
    toCriterion: (v) => ({ key: 'distanceTown', op: 'lte', value: Number(v) }),
  }),
  step({ id: 'use', kind: 'context', input: 'multi', options: options('use', ['holiday', 'residence', 'rental', 'investment']) }),
  step({ id: 'timeline', kind: 'context', input: 'single', options: options('timeline', ['3m', '6m', '12m', 'exploring']) }),
  step({ id: 'mortgage', kind: 'context', input: 'single', options: options('mortgage', ['yes', 'no', 'unsure']) }),
  step({ id: 'tax', kind: 'context', input: 'multi', options: options('tax', ['moving', 'regime', 'abroad', 'advice']) }),
  step({ id: 'notes', kind: 'context', input: 'text', optional: true }),
];

export const STEP_BY_ID = Object.fromEntries(STEPS.map((s) => [s.id, s]));
export const isAny = (value) => value === ANY || (Array.isArray(value) && value.includes(ANY));

export function answerLabel(step, value) {
  if (step.input === 'text') return value || t('steps.notes.empty');
  const values = Array.isArray(value) ? value : [value];
  return values
    .map((v) => {
      const known = step.options.find((o) => String(o.value) === String(v));
      if (known) return known.label;
      if (String(v).startsWith('other:')) return String(v).slice(6);
      return step.custom ? t('steps.budget.customAnswer', { amount: formatEuro(Number(v)) }) : String(v);
    })
    .join(', ');
}

export function needsPriority(step, value) {
  return step.kind === 'criterion' && !isAny(value) && step.toCriterion(value) !== null;
}

export function buildWishlist(answers) {
  const w = emptyWishlist();
  for (const s of STEPS) {
    const a = answers[s.id];
    if (!a) continue;
    if (s.kind === 'criterion') {
      if (!needsPriority(s, a.value) || !a.priority) continue;
      w[LIST_OF[a.priority]].push(s.toCriterion(a.value));
    } else if (a.value !== undefined && a.value !== '') {
      w.context[s.id] = s.input === 'text' ? a.value : answerLabel(s, a.value);
    }
  }
  return w;
}

// Saved progress: answers, position and how the visitor arrived.
const KEY = 'interview.v1';

export function loadState() {
  const s = read(KEY);
  return s && s.version === 1 ? s : null;
}

export function newState(mode) {
  const params = new URLSearchParams(location.search);
  return { version: 1, mode, lang: LANG, startedAt: new Date().toISOString(), updatedAt: null, answers: {}, buyerCountry: params.get('country') || null, submittedBuyerId: null };
}

export function saveState(state) {
  return write(KEY, { ...state, updatedAt: new Date().toISOString() });
}

export function clearState() {
  remove(KEY);
}

export function firstUnanswered(state) {
  const i = STEPS.findIndex((s) => {
    const a = state.answers[s.id];
    return !a || (needsPriority(s, a.value) && !a.priority);
  });
  return i === -1 ? STEPS.length : i;
}

// Voice: turn a spoken answer into a value for the step. Rules and keywords only; returns null when unsure.
const SPOKEN = {
  en: {
    numbers: { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 },
    any: /doesn.?t matter|not important|not needed|no preference|don.?t mind|anything/,
    walk: /walk/, hectare: /hectare/, space: /room|space|could add|add one/, yes: /yes|pool|view|please|definitely/,
    negative: /\b(no|not|don't|doesn't|dont|without|never|whatever|any)\b/,
    synonyms: { 'lake-como': ['como', 'lake'], farmhouse: ['farmhouse', 'masseria', 'trullo', 'farm'], townhouse: ['townhouse', 'town house'], 'move-in': ['move in', 'ready'], 'light-refresh': ['refresh', 'light'], restoration: ['restore', 'restoration', 'ruin'], renovation: ['renovat'] },
    priority: [['dealbreaker', /deal.?breaker|non.?negotiable|essential|no way|never/], ['nice', /nice|bonus|would be good|prefer|ideally/], ['must', /must|important|need|really/]],
  },
  it: {
    numbers: { uno: 1, una: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10 },
    any: /non importa|indifferente|non è importante|non serve|non mi interessa|qualsiasi|va bene tutto/,
    walk: /a piedi/, hectare: /ettar/, space: /spazio|posto per|si potrebbe|farla|costruir/, yes: /(^|\s)s[iì](\s|$|[,.!])|piscina|vista|certo|volentieri/,
    negative: /(^|\s)(no|non|senza|mai|nessun[ao]?)(\s|$|[,.!])/,
    synonyms: { 'lake-como': ['como', 'lago'], farmhouse: ['masseria', 'trull', 'casale', 'campagna'], apartment: ['appartament'], townhouse: ['centro storico', 'casa in centro'], rustic: ['rudere', 'rustico'], 'move-in': ['pronta', 'abitabile', 'subito'], 'light-refresh': ['rinfresc', 'piccoli lavori', 'ritocc'], renovation: ['ristruttur'], restoration: ['restaur'], holiday: ['vacanz'], residence: ['trasferi', 'principale'], rental: ['affitt'], investment: ['investiment'] },
    priority: [['dealbreaker', /da escludere|escluder|non negoziabil|tassativ|irrinunciabil/], ['nice', /gradit|sarebbe bello|bonus|preferibil|se possibile|magari/], ['must', /indispensabil|important|fondamental|necessari|deve/]],
  },
};
const rules = (lang) => SPOKEN[lang] || SPOKEN.en;

export function parseAmount(text, lang = LANG) {
  let s = text.toLowerCase();
  s = lang === 'it'
    ? s.replace(/(\d)\.(?=\d{3}\b)/g, '$1').replace(/(\d),(\d)/g, '$1.$2')
    : s.replace(/(\d),(?=\d{3}\b)/g, '$1');
  const m = s.match(/(\d+(?:\.\d+)?)\s*(milioni|milione|million|mila|mille|mln|mil|thousand|m\b|k\b)?/);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (['milioni', 'milione', 'million', 'mln', 'mil', 'm'].includes(m[2])) n *= 1e6;
  else if (['mila', 'mille', 'thousand', 'k'].includes(m[2])) n *= 1e3;
  return n >= 1000 ? Math.round(n) : null;
}

function firstNumber(text, lang) {
  const digit = text.match(/\d+/);
  if (digit) return Number(digit[0]);
  const words = rules(lang).numbers;
  const word = Object.keys(words).find((w) => new RegExp(`(^|\\s)${w}(\\s|$|[,.!])`).test(text));
  return word ? words[word] : null;
}

export function interpretSpoken(step, text, lang = LANG) {
  const r = rules(lang);
  const s = ` ${text.toLowerCase()} `;
  if (!s.trim()) return null;
  if (step.input === 'text') return text.trim();
  if (r.any.test(s)) {
    const any = step.options.find((o) => o.value === ANY);
    if (any) return step.input === 'multi' ? [ANY] : ANY;
  }
  if (step.id === 'budget') return parseAmount(s, lang);
  if (step.id === 'bedrooms' || step.id === 'bathrooms') {
    const n = firstNumber(s, lang);
    if (n == null) return null;
    return Math.min(n, step.id === 'bedrooms' ? 5 : 3);
  }
  if (['distanceSea', 'distanceAirport', 'distanceTown'].includes(step.id)) {
    if (r.walk.test(s)) return 1;
    const n = firstNumber(s, lang);
    if (n == null) return null;
    const numeric = step.options.filter((o) => typeof o.value === 'number').map((o) => o.value);
    return numeric.find((v) => n <= v) ?? numeric[numeric.length - 1];
  }
  if (step.id === 'land') {
    const n = firstNumber(s, lang);
    if (r.hectare.test(s) && n != null) return n >= 5 ? 50000 : 10000;
    if (n != null) return n >= 10000 ? 10000 : 1000;
    return null;
  }
  const matches = step.options.filter((o) => {
    if (o.value === ANY) return false;
    const words = o.label.toLowerCase().split(/[\s,]+/).filter((w) => w.length > 3);
    return [String(o.value), ...words, ...(r.synonyms[o.value] || [])].some((w) => s.includes(w.toLowerCase()));
  });
  if (step.input === 'multi') return matches.length ? matches.map((o) => o.value) : null;
  if (step.id === 'pool' || step.id === 'seaView') {
    if (r.space.test(s)) return step.options.some((o) => o.value === 'space') ? 'space' : 'yes';
    if (r.negative.test(s)) return ANY;
    if (r.yes.test(s)) return 'yes';
  }
  return matches[0]?.value ?? null;
}

export function interpretPriority(text, lang = LANG) {
  const s = text.toLowerCase();
  const hit = rules(lang).priority.find(([, re]) => re.test(s));
  return hit ? hit[0] : null;
}
