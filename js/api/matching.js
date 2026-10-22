// Matching engine: pure functions, no I/O. Deal breakers exclude; must haves weigh 3, nice to haves 1,
// and every must have that is missed outright also multiplies the score by MISSED_MUST_FACTOR.
import { describeCriterion, propertyValueText } from '../core/wishlist.js';

export const WEIGHTS = { must: 3, nice: 1 };
export const MISSED_MUST_FACTOR = 0.7;

const ACCESSORS = {
  region: (p) => p.region,
  price: (p) => p.price,
  type: (p) => p.type,
  bedrooms: (p) => p.bedrooms,
  bathrooms: (p) => p.bathrooms,
  condition: (p) => p.condition,
  pool: (p) => p.pool,
  poolOrSpace: (p) => (p.pool == null && p.poolPossible == null ? null : Boolean(p.pool || p.poolPossible)),
  land: (p) => p.land,
  seaView: (p) => p.seaView,
  distanceSea: (p) => p.distances?.sea,
  distanceAirport: (p) => p.distances?.airport,
  distanceTown: (p) => p.distances?.town,
};

// How far past the limit a must or nice criterion still earns partial credit (0.2 = 20% over budget).
const TOLERANCE = { price: 0.2, distanceSea: 0.5, distanceAirport: 0.5, distanceTown: 1, bedrooms: 0.5, bathrooms: 0.5, land: 0.5 };

export function satisfaction(criterion, property) {
  const get = ACCESSORS[criterion.key];
  if (!get) return { s: 0.5, status: 'unknown' };
  const actual = get(property);
  if (actual == null) return { s: 0.5, status: 'unknown' };
  const want = criterion.value;
  let s = 0;
  switch (criterion.op) {
    case 'in':
      s = Array.isArray(want) && want.includes(actual) ? 1 : 0;
      break;
    case 'eq':
      s = actual === want ? 1 : 0;
      break;
    case 'lte': {
      if (actual <= want) s = 1;
      else s = Math.max(0, 1 - (actual - want) / (want || 1) / (TOLERANCE[criterion.key] ?? 0.2));
      break;
    }
    case 'gte': {
      if (actual >= want) s = 1;
      else s = Math.max(0, 1 - (want - actual) / (want || 1) / (TOLERANCE[criterion.key] ?? 0.2));
      break;
    }
    default:
      return { s: 0.5, status: 'unknown' };
  }
  s = Math.round(s * 100) / 100;
  return { s, status: s === 1 ? 'met' : s > 0 ? 'partial' : 'missed' };
}

export function scoreProperty(wishlist, property) {
  const reasons = { met: [], partial: [], missed: [], unknown: [] };
  const excludedBy = [];
  let weighted = 0;
  let total = 0;

  const explain = (criterion, priority, result) => ({
    key: criterion.key,
    priority,
    text: `${describeCriterion(criterion)}: ${propertyValueText(criterion.key, property)}`,
    s: result.s,
  });

  for (const c of wishlist.dealBreakers || []) {
    const r = satisfaction(c, property);
    if (r.status === 'unknown') reasons.unknown.push(explain(c, 'dealbreaker', r));
    else if (r.s < 1) excludedBy.push(explain(c, 'dealbreaker', r));
    else reasons.met.push(explain(c, 'dealbreaker', r));
  }
  for (const [list, priority] of [[wishlist.mustHave || [], 'must'], [wishlist.niceToHave || [], 'nice']]) {
    for (const c of list) {
      const r = satisfaction(c, property);
      weighted += WEIGHTS[priority] * r.s;
      total += WEIGHTS[priority];
      reasons[r.status].push(explain(c, priority, r));
    }
  }
  const missedMusts = reasons.missed.filter((r) => r.priority === 'must').length;
  const score = Math.round((total ? (100 * weighted) / total : 100) * MISSED_MUST_FACTOR ** missedMusts);
  return { property, score, excluded: excludedBy.length > 0, excludedBy, ...reasons };
}

export function matchProperties(wishlist, properties, { includeExcluded = false, minScore = 0 } = {}) {
  return properties
    .filter((p) => p.status !== 'sold')
    .map((p) => scoreProperty(wishlist, p))
    .filter((m) => (includeExcluded || !m.excluded) && (m.excluded || m.score >= minScore))
    .sort((a, b) => Number(a.excluded) - Number(b.excluded) || b.score - a.score);
}

// Compatible: not ruled out by a deal breaker and scoring at least minScore.
export function compatibleCount(wishlist, properties, minScore = 60) {
  return matchProperties(wishlist, properties, { minScore }).length;
}

// A shortlist from sorted matches: up to max compatible properties, topped up to min with the best weaker ones.
export function pickCandidates(matches, { min = 5, max = 10, minScore = 60 } = {}) {
  const open = matches.filter((m) => !m.excluded);
  const strong = open.filter((m) => m.score >= minScore).slice(0, max);
  return [...strong, ...open.filter((m) => m.score < minScore).slice(0, Math.max(0, min - strong.length))];
}
