// Search service for the web search in the consultant area (js/api/web-search.js). It keeps the API keys and
// forwards searches and pages to open to Tavily, and listing texts to a language model on Workers AI.
// Free tiers only: with no payment method on the Cloudflare and Tavily accounts, a used-up quota returns an error
// instead of a bill. Setup: README, "Ricerca immobili sul web".

const DEFAULT_MODEL = '@cf/google/gemma-4-26b-a4b-it';
const SEARCH_FIELDS = ['query', 'max_results', 'include_domains', 'exclude_domains', 'include_raw_content', 'search_depth'];

function corsHeaders(request, env) {
  const origin = request.headers.get('origin');
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

async function tavily(path, params, env, cors) {
  const auth = env.TAVILY_API_KEY ? { authorization: `Bearer ${env.TAVILY_API_KEY}` } : { 'x-tavily-access-mode': 'keyless' };
  const res = await fetch(`https://api.tavily.com/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify(params) });
  // Passed through unparsed: the free plan allows 10 ms of CPU per request.
  return new Response(res.body, { status: res.status, headers: { 'content-type': 'application/json', ...cors } });
}

function search(body, env, cors) {
  const params = Object.fromEntries(SEARCH_FIELDS.filter((k) => body?.[k] !== undefined).map((k) => [k, body[k]]));
  if (typeof params.query !== 'string' || !params.query.trim()) return Response.json({ error: 'Missing query.' }, { status: 400, headers: cors });
  params.max_results = Math.min(Math.max(Number(params.max_results) || 10, 1), 20);
  return tavily('search', params, env, cors);
}

// Opens pages the search found: at most 5 at a time, the number Tavily bills as one credit.
function extract(body, env, cors) {
  const urls = Array.isArray(body?.urls) ? body.urls.filter((u) => typeof u === 'string' && /^https:\/\//.test(u)).slice(0, 5) : [];
  if (!urls.length) return Response.json({ error: 'Missing urls.' }, { status: 400, headers: cors });
  return tavily('extract', { urls, format: 'markdown' }, env, cors);
}

// Workers AI models answer either { response } or OpenAI-style { choices }.
function textOf(out) {
  if (typeof out?.response === 'string') return out.response;
  if (out?.response != null) return JSON.stringify(out.response);
  const choice = out?.choices?.[0];
  return choice?.message?.content ?? choice?.text ?? '';
}

async function complete(body, env) {
  if (!Array.isArray(body?.messages) || !body.messages.length) throw new Error('Missing messages.');
  const options = { messages: body.messages, max_tokens: Math.min(Number(body.max_tokens) || 3000, 4000), temperature: 0 };
  if (!env.LLM_BASE_URL) return textOf(await env.AI.run(env.LLM_MODEL || DEFAULT_MODEL, options));
  // Any OpenAI-compatible endpoint instead of Workers AI, for example Groq's free tier.
  const res = await fetch(`${env.LLM_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.LLM_API_KEY}` },
    body: JSON.stringify({ model: env.LLM_MODEL, ...options }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `The language model returned ${res.status}`);
  return textOf(data);
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    const reply = (data, status = 200) => Response.json(data, { status, headers: cors });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!env.ACCESS_KEY || request.headers.get('authorization') !== `Bearer ${env.ACCESS_KEY}`) return reply({ error: 'Missing or wrong access key.' }, 401);
    const { pathname } = new URL(request.url);
    try {
      if (request.method === 'GET' && pathname === '/status') {
        return reply({ search: env.TAVILY_API_KEY ? 'tavily' : 'tavily-keyless', model: env.LLM_MODEL || DEFAULT_MODEL });
      }
      if (request.method === 'POST' && pathname === '/search') return await search(await request.json(), env, cors);
      if (request.method === 'POST' && pathname === '/extract') return await extract(await request.json(), env, cors);
      if (request.method === 'POST' && pathname === '/llm') return reply({ text: await complete(await request.json(), env) });
      return reply({ error: 'Not found.' }, 404);
    } catch (error) {
      return reply({ error: error.message }, 502);
    }
  },
};
