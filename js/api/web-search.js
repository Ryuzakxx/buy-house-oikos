// Web search agent: turns a brief into searches on Italian property portals, reads the listings found with a
// language model and scores them with the matching engine, ending with 5 to 10 candidates for the consultant.
// search(), extract() and llm() are passed in. The consultant area uses serviceClient(), which calls the search service in
// worker/ so the API keys never reach the browser; tools/web-search.mjs can also call the providers directly.
import { read, write } from './storage.js';
import { matchProperties, pickCandidates } from './matching.js';
import { planSearches, pagesToOpen, listingsInResult, quickFacts, withinBudget, extractionMessages, parseExtraction, toProperty, mergeDuplicates } from '../core/web-listings.js';

// Listings read per round, and per call to the model.
const MAX_READ = 30;
const BATCH = 10;

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function readListings(cards, llm, stats, parallel) {
  const batches = [];
  for (let i = 0; i < cards.length; i += BATCH) batches.push(cards.slice(i, i + BATCH));
  const read = await mapLimit(batches, parallel, async (batch) => {
    try {
      const items = parseExtraction(await llm(extractionMessages(batch)), batch.length);
      stats.readByModel += items.filter(Boolean).length;
      return items;
    } catch (error) {
      stats.modelErrors.push(error.message);
      return batch.map(() => null);
    }
  });
  return read.flat();
}

// Runs up to `rounds` rounds of searches (the second one only when the first found fewer than `min` good matches).
// Each round: search the towns, open the pages of results that came back without their content (extract), read the
// listings (llm), score them. Returns every property read, the picked matches and what was searched.
export async function findOnWeb(wishlist, { search, extract = null, llm = null, onProgress = () => {}, rounds = 2, min = 5, max = 10, minScore = 60, parallel = 6 } = {}) {
  const seen = new Set();
  const opened = new Set();
  const found = [];
  const queries = [];
  const stats = { searches: 0, failedSearches: 0, pagesOpened: 0, listings: 0, read: 0, readByModel: 0, searchErrors: [], modelErrors: [] };
  let picked = [];
  for (let round = 0; round < rounds; round += 1) {
    const plan = planSearches(wishlist, { round });
    if (!plan.length) break;
    onProgress({ step: 'search', round, total: plan.length });
    const failedBefore = stats.failedSearches;
    const results = await mapLimit(plan, parallel, async (p) => {
      try {
        return ((await search(p.params)).results || []).map((r) => ({ ...r, plan: p }));
      } catch (error) {
        stats.failedSearches += 1;
        stats.searchErrors.push(error.message);
        return [];
      }
    });
    stats.searches += plan.length;
    queries.push(...plan.map((p) => p.params.query));
    // Every search failed: the provider is down or out of quota, and another round would fail the same way.
    if (stats.failedSearches - failedBefore === plan.length) break;

    const open = extract ? pagesToOpen(results.flat().filter((r) => !opened.has(r.url))) : [];
    for (const o of open) opened.add(o.url);
    if (open.length) {
      onProgress({ step: 'open', round, total: open.length });
      try {
        const pages = (await extract(open.map((o) => o.url))).results || [];
        for (const o of open) {
          const page = pages.find((r) => r.url?.replace(/\/$/, '') === o.url.replace(/\/$/, ''));
          if (page?.raw_content) results[plan.indexOf(o.plan)].push({ url: o.url, title: '', raw_content: page.raw_content, plan: o.plan });
        }
        stats.pagesOpened += pages.length;
      } catch (error) {
        stats.searchErrors.push(error.message);
      }
    }

    // One listing from each search in turn, so every town gets its share of the reading and of the shortlist.
    const perSearch = results.map((rs) => rs.flatMap((r) => listingsInResult(r).map((c) => ({ ...c, region: r.plan.region, place: r.plan.place, query: r.plan.params.query }))));
    const cards = [];
    for (let i = 0; perSearch.some((l) => i < l.length); i += 1) {
      for (const c of perSearch.map((l) => l[i]).filter(Boolean)) {
        const key = `${c.portal}:${c.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        cards.push({ ...c, facts: quickFacts(c.text, c.title) });
      }
    }
    stats.listings += cards.length;
    // Listings already over budget are not worth a call to the model; those with a price in range go first.
    const toRead = cards.filter((c) => withinBudget(wishlist, c.facts.price)).sort((a, b) => Number(b.facts.price != null) - Number(a.facts.price != null)).slice(0, MAX_READ);
    onProgress({ step: 'read', round, total: toRead.length });
    const extracted = llm ? await readListings(toRead, llm, stats, Math.min(parallel, 3)) : [];
    found.push(...toRead.map((c, i) => toProperty(c, extracted[i])));
    stats.read += toRead.length;

    picked = pickCandidates(matchProperties(wishlist, mergeDuplicates(found)), { min, max, minScore });
    if (picked.filter((m) => m.score >= minScore).length >= min) break;
  }
  onProgress({ step: 'done' });
  return { properties: mergeDuplicates(found), picked, queries, stats };
}

// The search service (worker/index.js): /search and /extract go to Tavily, /llm to the language model.
export function serviceClient({ endpoint, key }) {
  const base = endpoint.replace(/\/*$/, '/');
  const call = async (path, body, seconds = 60) => {
    let res;
    try {
      res = await fetch(new URL(path, base), {
        method: body ? 'POST' : 'GET',
        headers: { authorization: `Bearer ${key}`, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(seconds * 1000),
      });
    } catch (error) {
      throw new Error(error.name === 'TimeoutError' ? 'the search service did not answer in time' : error.message);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message || data.detail?.error || data.error || `The search service returned ${res.status}`);
    return data;
  };
  return {
    search: (params) => call('search', params),
    extract: (urls) => call('extract', { urls, format: 'markdown' }),
    // Reading ten listings can take the model a minute or more.
    llm: async (messages) => (await call('llm', { messages }, 150)).text,
    status: () => call('status'),
  };
}

// Address and access key of the search service, kept in this browser by the consultant area.
const KEY = 'webSearch.v1';
export const loadService = () => read(KEY);
export const saveService = (service) => write(KEY, service);
