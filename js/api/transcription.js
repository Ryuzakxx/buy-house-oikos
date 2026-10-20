// Call transcription and brief extraction. Mock: keyword rules. Production: speech-to-text plus an LLM on the backend,
// returning the same shape; the consultant always reviews the proposal before it replaces the brief.
import { latency } from './storage.js';
import { parseAmount } from '../core/interview.js';

export async function transcribeRecording() {
  await latency();
  throw new Error('Automatic transcription is not connected in this demo. Paste or upload the transcript text instead.');
}

const REGIONS = {
  puglia: /\b(puglia|apulia|salento|ostuni|valle d.?itria|monopoli|polignano|lecce|trull)/,
  tuscany: /\b(tuscany|toscana|chianti|val d.?orcia|lucca|siena|florence|pienza|maremma)/,
  sicily: /\b(sicily|sicilia|noto|taormina|ortigia|syracuse|palermo|catania|cefal)/,
  'lake-como': /\b(lake como|como|bellagio|menaggio|tremezz|varenna|cernobbio)/,
  liguria: /\b(liguria|riviera|camogli|portofino|sanremo|cinque terre|genoa|lerici)/,
  sardinia: /\b(sardinia|sardegna|costa smeralda|alghero|san teodoro|olbia|cagliari)/,
};
const TYPES = {
  villa: /\bvilla/,
  farmhouse: /\b(farmhouse|masseria|casale|trullo|trulli|podere)/,
  apartment: /\b(apartment|flat)\b/,
  townhouse: /\b(townhouse|town house|palazz)/,
  rustic: /\b(ruin|rustic|rustico|to restore)/,
};
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const toNumber = (s) => (/^\d+$/.test(s) ? Number(s) : WORDS[s]);

function priorityOf(sentence, fallback) {
  if (/deal.?breaker|absolutely not|won.?t consider|no way|non.?negotiable|out of the question|refuse/.test(sentence)) return 'dealbreaker';
  if (/would be nice|nice to have|ideally|bonus|if possible|not essential|prefer|would love/.test(sentence)) return 'nice';
  if (/\bmust\b|need|have to|essential|important|definitely|really want/.test(sentence)) return 'must';
  return fallback;
}

export function generateWishlistFromTranscript(text) {
  const out = { mustHave: [], niceToHave: [], dealBreakers: [], context: {}, evidence: [] };
  const lists = { must: out.mustHave, nice: out.niceToHave, dealbreaker: out.dealBreakers };
  const seen = new Set();
  const sentences = String(text).replace(/\s+/g, ' ').split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);

  const add = (criterion, priority, quote) => {
    if (seen.has(criterion.key)) return;
    seen.add(criterion.key);
    lists[priority].push(criterion);
    out.evidence.push({ key: criterion.key, priority, quote });
  };

  for (const original of sentences) {
    const s = original.toLowerCase();
    const negated = /\b(no|not|don.?t|without|never)\b/.test(s);

    const regions = Object.keys(REGIONS).filter((k) => REGIONS[k].test(s));
    if (regions.length && !negated) add({ key: 'region', op: 'in', value: regions }, priorityOf(s, 'must'), original);

    if (/budget|spend|up to|maximum|max\b|afford|price|€|euro/.test(s)) {
      const amount = parseAmount(s);
      if (amount) add({ key: 'price', op: 'lte', value: amount }, priorityOf(s, 'must'), original);
    }

    const types = Object.keys(TYPES).filter((k) => TYPES[k].test(s));
    if (types.length && !/restor|renovat/.test(s)) add({ key: 'type', op: 'in', value: types }, priorityOf(s, 'nice'), original);

    const beds = s.match(/\b(\d+|one|two|three|four|five|six)\s+(?:bed(?:room)?s?)\b/);
    if (beds) add({ key: 'bedrooms', op: 'gte', value: toNumber(beds[1]) }, priorityOf(s, 'must'), original);
    const baths = s.match(/\b(\d+|one|two|three|four)\s+bath(?:room)?s?\b/);
    if (baths) add({ key: 'bathrooms', op: 'gte', value: toNumber(baths[1]) }, priorityOf(s, 'nice'), original);

    if (/\bpool\b/.test(s)) {
      if (/room for|space for|could add|add one|build one/.test(s)) add({ key: 'poolOrSpace', op: 'eq', value: true }, priorityOf(s, 'nice'), original);
      else if (!negated) add({ key: 'pool', op: 'eq', value: true }, priorityOf(s, 'nice'), original);
    }
    if (/sea view|view of the sea|see the sea|views? (?:over|of) the (?:sea|coast|bay)/.test(s) && !negated) {
      add({ key: 'seaView', op: 'eq', value: true }, priorityOf(s, 'nice'), original);
    }

    const seaKm = s.match(/(\d+)\s*(?:km|kilomet\w*)\s*(?:from|of|to)\s*the\s*(?:sea|beach|coast)/);
    if (seaKm) add({ key: 'distanceSea', op: 'lte', value: Number(seaKm[1]) }, priorityOf(s, 'must'), original);
    else if (/walk to the (?:sea|beach)|walking distance (?:to|from|of) the (?:sea|beach)|on the (?:sea|beach)/.test(s)) add({ key: 'distanceSea', op: 'lte', value: 1 }, priorityOf(s, 'must'), original);
    else if (/close to the (?:sea|beach|coast)|near the (?:sea|beach|coast)/.test(s)) add({ key: 'distanceSea', op: 'lte', value: 10 }, priorityOf(s, 'nice'), original);

    if (/airport/.test(s)) {
      const km = s.match(/(\d+)\s*(?:km|kilomet\w*)/);
      const hour = /an hour|one hour|1 hour/.test(s);
      if (km || hour || /near|close/.test(s)) add({ key: 'distanceAirport', op: 'lte', value: km ? Number(km[1]) : hour ? 90 : 60 }, priorityOf(s, 'nice'), original);
    }
    if (/walk(?:ing distance)? to (?:the )?(?:village|town|shops|restaurants|caf|bakery)|in town|in the (?:old town|centre|center)/.test(s)) {
      add({ key: 'distanceTown', op: 'lte', value: 1 }, priorityOf(s, 'must'), original);
    } else if (/isolated|middle of nowhere|too remote/.test(s)) {
      add({ key: 'distanceTown', op: 'lte', value: 5 }, priorityOf(s, 'dealbreaker'), original);
    }

    if (/move.?in ready|turnkey|no (?:renovation|work)|not (?:renovate|do any work)|ready to live/.test(s)) {
      add({ key: 'condition', op: 'in', value: ['move-in', 'light-refresh'] }, priorityOf(s, 'dealbreaker'), original);
    } else if (/happy to (?:renovate|restore)|(?:renovation|restoration) project|don.?t mind (?:work|renovating)/.test(s)) {
      add({ key: 'condition', op: 'in', value: ['move-in', 'light-refresh', 'renovation', 'restoration'] }, 'nice', original);
      out.context.renovate = 'Yes, open to renovation';
    }

    const ha = s.match(/(\d+(?:\.\d+)?)\s*hectares?/);
    const acres = s.match(/(\d+(?:\.\d+)?)\s*acres?/);
    if (ha) add({ key: 'land', op: 'gte', value: Math.round(Number(ha[1]) * 10000) }, priorityOf(s, 'nice'), original);
    else if (acres) add({ key: 'land', op: 'gte', value: Math.round(Number(acres[1]) * 4047) }, priorityOf(s, 'nice'), original);
    else if (/big garden|large garden|some land|olive (?:grove|trees)/.test(s)) add({ key: 'land', op: 'gte', value: 1000 }, priorityOf(s, 'nice'), original);

    if (/mortgage|loan/.test(s)) out.context.mortgage = /no mortgage|cash|without a mortgage|own funds/.test(s) ? 'No, buying with my own funds' : 'Yes';
    else if (/\bcash buyer|pay(?:ing)? cash/.test(s)) out.context.mortgage = 'No, buying with my own funds';
    if (/holiday home|summers?|vacation/.test(s)) out.context.use = 'Holiday home';
    if (/rent(?:ing)? it out|rental income|airbnb|let it/.test(s)) out.context.use = [out.context.use, 'Rental income'].filter(Boolean).join(', ');
    if (/retire|move (?:there|to italy) (?:permanently|full.?time)|live there/.test(s)) out.context.use = [out.context.use, 'Main home, moving to Italy'].filter(Boolean).join(', ');
    const when = s.match(/within (\d+|six|three|twelve) months|(?:next|this) (?:year|spring|summer|autumn|winter)/);
    if (when) out.context.timeline = when[0];
    if (/tax residen|flat tax|7 ?%|seven per ?cent|tax regime/.test(s)) out.context.tax = original;
  }
  return out;
}

export const SAMPLE_TRANSCRIPT = `Consultant: Thanks for taking the time. Where are you looking?
Buyer: We've been to Puglia twice, around Ostuni and the Valle d'Itria, and we love it. Puglia is a must for us.
Buyer: Our budget is up to 900,000 euros, that's our maximum.
Buyer: We need at least three bedrooms, because the kids visit with their partners.
Buyer: A pool would be nice to have, or at least space for one.
Buyer: A sea view would be a bonus, ideally.
Buyer: We don't want to be more than 15 km from the beach.
Buyer: The airport should be within an hour, we fly from Munich a lot.
Buyer: A big renovation is a deal breaker, we want something move-in ready.
Buyer: We'll pay cash, no mortgage, and we'd like to buy within six months.`;
