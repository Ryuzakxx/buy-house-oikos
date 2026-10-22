// The web search agent from the terminal: same searches, reading and scoring as the consultant area.
//   node tools/web-search.mjs                      brief of the demo buyer b-demo-1
//   node tools/web-search.mjs --buyer b-demo-2     another demo buyer
//   node tools/web-search.mjs --brief brief.json   a wishlist { mustHave, niceToHave, dealBreakers }, or a buyer with one
//   node tools/web-search.mjs --json               results as JSON
// Providers, from the environment:
//   SEARCH_SERVICE_URL + SEARCH_SERVICE_KEY   the deployed search service (worker/), as the consultant area does
//   otherwise TAVILY_API_KEY (without it, Tavily's keyless tier) and, for the language model, LLM_BASE_URL,
//   LLM_API_KEY and LLM_MODEL of any OpenAI-compatible endpoint. Without a model, listings are read with
//   patterns only: price, size, rooms, bedrooms, bathrooms, land.
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { findOnWeb, serviceClient } from '../js/api/web-search.js';
import { describeCriterion, allCriteria, formatEuro } from '../js/core/wishlist.js';

const { values: args } = parseArgs({ options: { buyer: { type: 'string', default: 'b-demo-1' }, brief: { type: 'string' }, json: { type: 'boolean', default: false } } });
const env = process.env;

async function loadWishlist() {
  if (args.brief) {
    const data = JSON.parse(await readFile(args.brief, 'utf8'));
    return data.wishlist || data;
  }
  const demo = JSON.parse(await readFile(new URL('../data/demo-buyers.json', import.meta.url), 'utf8'));
  const buyer = demo.buyers.find((b) => b.id === args.buyer);
  if (!buyer) throw new Error(`No demo buyer ${args.buyer}: try ${demo.buyers.map((b) => b.id).join(', ')}`);
  return buyer.wishlist;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function tavily(apiKey, path) {
  return async function call(params, retried = false) {
    const auth = apiKey ? { authorization: `Bearer ${apiKey}` } : { 'x-tavily-access-mode': 'keyless' };
    const res = await fetch(`https://api.tavily.com/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify(params), signal: AbortSignal.timeout(90000) });
    const data = await res.json().catch(() => ({}));
    // The keyless tier says how long to wait when it is busy.
    if (res.status === 429 && !retried) {
      await wait(Math.min(Number(data.error?.retry_after_seconds) || 30, 65) * 1000);
      return call(params, true);
    }
    if (!res.ok) throw new Error(data.error?.message || data.detail?.error || `Tavily returned ${res.status}`);
    return data;
  };
}

function openAICompatible({ baseUrl, apiKey, model }) {
  return async (messages) => {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, temperature: 0, max_tokens: 3000 }),
      signal: AbortSignal.timeout(150000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message || `The language model returned ${res.status}`);
    return data.choices?.[0]?.message?.content ?? '';
  };
}

function providers() {
  if (env.SEARCH_SERVICE_URL) return { ...serviceClient({ endpoint: env.SEARCH_SERVICE_URL, key: env.SEARCH_SERVICE_KEY || '' }), parallel: 6, label: `search service ${env.SEARCH_SERVICE_URL}` };
  const llm = env.LLM_BASE_URL ? openAICompatible({ baseUrl: env.LLM_BASE_URL, apiKey: env.LLM_API_KEY, model: env.LLM_MODEL }) : null;
  const keyless = !env.TAVILY_API_KEY;
  const extract = tavily(env.TAVILY_API_KEY, 'extract');
  return {
    search: tavily(env.TAVILY_API_KEY, 'search'),
    extract: (urls) => extract({ urls, format: 'markdown' }),
    llm,
    // The keyless tier is rate-limited: one search at a time.
    parallel: keyless ? 1 : 6,
    label: `Tavily ${keyless ? 'keyless' : 'with key'}, ${llm ? `model ${env.LLM_MODEL}` : 'no language model (patterns only)'}`,
  };
}

const PROGRESS = { search: (p) => `${p.round ? 'Round 2: ' : ''}${p.total} searches`, open: (p) => `opening ${p.total} pages of listings`, read: (p) => `reading ${p.total} listings`, done: () => 'scoring' };

const wishlist = await loadWishlist();
const { label, ...tools } = providers();
console.error(`Brief: ${allCriteria(wishlist).map((c) => `${describeCriterion(c)} (${c.priority})`).join('; ')}`);
console.error(`Using ${label}`);
const result = await findOnWeb(wishlist, { ...tools, onProgress: (p) => console.error(`... ${PROGRESS[p.step](p)}`) });
const { picked, stats } = result;

if (args.json) {
  console.log(JSON.stringify({ queries: result.queries, stats, picked: picked.map((m) => ({ score: m.score, ...m.property, met: m.met, partial: m.partial, missed: m.missed, unknown: m.unknown })) }, null, 2));
} else {
  console.log(`\n${stats.searches} searches (${stats.failedSearches} failed), ${stats.pagesOpened} pages opened, ${stats.listings} listings found, ${stats.read} read (${stats.readByModel} by the model).`);
  for (const e of new Set([...stats.searchErrors, ...stats.modelErrors])) console.log(`  error: ${e}`);
  if (!picked.length) console.log('\nNothing found that fits this brief.');
  picked.forEach((m, i) => {
    const p = m.property;
    console.log(`\n${i + 1}. [${m.score}] ${p.title}`);
    console.log(`   ${[p.city, p.price != null ? formatEuro(p.price) : 'price not read', p.surface ? `${p.surface} m²` : null, p.portal].filter(Boolean).join(' · ')}`);
    console.log(`   ${p.url}`);
    if (p.summary) console.log(`   ${p.summary}`);
    for (const r of m.met) console.log(`   ✓ ${r.text}`);
    for (const r of m.partial) console.log(`   ~ ${r.text}`);
    for (const r of m.missed) console.log(`   ✗ ${r.text}`);
    for (const r of m.unknown) console.log(`   ? ${r.text}`);
  });
}
