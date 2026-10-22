// Consultant area: one buyer. The brief is edited as a draft and saved explicitly; matches follow the draft live.
import { getBuyer, updateBuyer, updateWishlist, addInteraction, addTranscript } from '../api/crm.js';
import { listProperties } from '../api/apimo.js';
import { listAgencies } from '../api/partners.js';
import { matchProperties, pickCandidates } from '../api/matching.js';
import { findOnWeb, serviceClient, loadService, saveService } from '../api/web-search.js';
import { generateWishlistFromTranscript, SAMPLE_TRANSCRIPT } from '../api/transcription.js';
import { CRITERIA, PRIORITIES, LIST_OF, MARK_CLASS, FEEDBACK_REASONS, allCriteria, describeCriterion, setCriterion, removeCriterion, applyFeedback, formatEuro } from '../core/wishlist.js';
import { describeLeadSource } from '../ui/lead-source.js';
import { h, $, formatDate, errorBox } from '../ui/dom.js';
import { STATUS_LABELS, SOURCE_LABELS, initResetButtons, consentFlags, loading } from './internal-common.js';
import { withBase } from '../core/base.js';

const SHORTLIST_STATUS = { proposed: 'Proposed', 'visit-planned': 'Visit planned', visited: 'Visited', offer: 'Offer made', rejected: 'Rejected' };
// Same threshold as the buyer-facing "homes that fit" message and the buyer list.
const MIN_SCORE = 60;
const DEFAULT_VALUES = { region: ['puglia'], price: 500000, type: ['villa'], bedrooms: 3, bathrooms: 2, condition: ['move-in', 'light-refresh'], pool: true, poolOrSpace: true, land: 1000, seaView: true, distanceSea: 10, distanceAirport: 60, distanceTown: 5 };

let app;
let buyer;
let properties = [];
let agencies = [];
let draft;
let dirty = false;
let showExcluded = false;
let proposal = null;
let openFeedback = null;
let lastChanges = [];
let web = { running: false, progress: '', error: '', settings: false };

export async function init() {
  app = $('#buyer-app');
  initResetButtons(() => location.reload());
  const id = new URLSearchParams(location.search).get('id');
  if (!id) {
    app.replaceChildren(h('div', { class: 'empty-state' }, h('h2', {}, 'No buyer selected'), h('p', {}, h('a', { href: withBase('/internal/') }, 'Choose a buyer from the list.'))));
    return;
  }
  app.replaceChildren(loading('Loading buyer…'));
  try {
    [buyer, properties, agencies] = await Promise.all([getBuyer(id), listProperties(), listAgencies()]);
  } catch (error) {
    app.replaceChildren(errorBox("This buyer couldn't be loaded", `${error.message}. Reload the page, or reset the demo data.`));
    return;
  }
  if (!buyer) {
    app.replaceChildren(h('div', { class: 'empty-state' }, h('h2', {}, 'Buyer not found'), h('p', {}, 'It may have been removed by a demo reset. ', h('a', { href: withBase('/internal/') }, 'Back to all buyers'), '.')));
    return;
  }
  draft = structuredClone(buyer.wishlist || { mustHave: [], niceToHave: [], dealBreakers: [], context: {} });
  render();
}

function render(focusId) {
  document.title = `${buyer.contact?.name || 'Buyer'} | Consultant area (demo)`;
  app.replaceChildren(
    head(),
    h('div', { class: 'buyer-grid' },
      h('div', {}, briefPanel(), transcriptPanel(), matchesPanel(), webPanel()),
      h('div', {}, shortlistPanel(), contactPanel(), sourcePanel(), consentsPanel(), historyPanel())));
  if (focusId) document.getElementById(focusId)?.focus();
}

async function save(update, focusId) {
  try {
    buyer = await update();
    render(focusId);
  } catch (error) {
    alert(`Not saved: ${error.message}`);
  }
}

function head() {
  const w = buyer.wishlist || {};
  const wishStatus = { draft: 'Brief in draft', submitted: 'Brief sent by the buyer, not yet confirmed', confirmed: `Brief confirmed ${formatDate(w.confirmedAt)}` }[w.status] || 'No brief yet';
  $('#buyer-title').textContent = buyer.contact?.name || 'Unnamed buyer';
  return h('header', { class: 'buyer-head' },
    h('p', { class: 'buyer-head__meta' },
      h('span', {}, STATUS_LABELS[buyer.status] || buyer.status),
      h('span', {}, wishStatus),
      h('span', {}, `Came through: ${SOURCE_LABELS[buyer.source] || buyer.source}`),
      h('span', {}, `Since ${formatDate(buyer.createdAt)}`)));
}

// Brief editor
function valueEditor(c, i) {
  const meta = CRITERIA[c.key];
  const id = `crit-${c.key}`;
  if (meta.options) {
    return h('fieldset', { class: 'edit-crit__value' }, h('legend', { class: 'visually-hidden' }, meta.label),
      h('div', { class: 'checks' }, ...Object.entries(meta.options).map(([value, label]) => h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: c.value.includes(value), onChange: (e) => {
          const values = e.target.checked ? [...c.value, value] : c.value.filter((v) => v !== value);
          if (!values.length) { e.target.checked = true; return; }
          updateDraft(c.key, { ...c, value: values });
        } }), h('span', {}, label)))));
  }
  if (meta.op === 'eq') return h('span', {}, 'Yes');
  return h('div', { class: 'edit-crit__value' },
    h('label', { class: 'visually-hidden', for: id }, `${meta.label} value`),
    h('input', { type: 'number', id, value: String(c.value), min: '0', inputmode: 'numeric', onChange: (e) => {
      const n = Number(e.target.value);
      if (Number.isFinite(n) && n > 0) updateDraft(c.key, { ...c, value: n }, id);
    } }),
    meta.unit ? h('span', { class: 'hint' }, meta.unit) : null);
}

function updateDraft(key, criterion, focusId) {
  const priority = allCriteria(draft).find((c) => c.key === key)?.priority || criterion.priority || 'must';
  draft = setCriterion(draft, criterion, priority);
  dirty = true;
  render(focusId);
}

function briefPanel() {
  const rows = allCriteria(draft).map((c, i) => h('div', { class: CRITERIA[c.key]?.options ? 'edit-crit edit-crit--options' : 'edit-crit' },
    h('span', { class: 'edit-crit__key' }, CRITERIA[c.key]?.label || c.key, h('span', { class: 'cell-sub' }, describeCriterion(c))),
    valueEditor(c, i),
    h('div', {},
      h('label', { class: 'visually-hidden', for: `prio-${c.key}` }, `Category for ${CRITERIA[c.key]?.label}`),
      h('select', { id: `prio-${c.key}`, onChange: (e) => { draft = setCriterion(draft, c, e.target.value); dirty = true; render(`prio-${c.key}`); } },
        ...PRIORITIES.map((p) => h('option', { value: p.id, selected: p.id === c.priority }, p.label)))),
    h('button', { class: 'btn btn--quiet btn--small', type: 'button', 'aria-label': `Remove ${CRITERIA[c.key]?.label}`, onClick: () => { draft = removeCriterion(draft, c.key); dirty = true; render('add-crit-key'); } }, 'Remove')));

  const used = new Set(allCriteria(draft).map((c) => c.key));
  const free = Object.entries(CRITERIA).filter(([k]) => !used.has(k));
  const keySelect = h('select', { id: 'add-crit-key' }, ...free.map(([k, m]) => h('option', { value: k }, m.label)));
  const prioSelect = h('select', { id: 'add-crit-prio' }, ...PRIORITIES.map((p) => h('option', { value: p.id }, p.label)));
  const add = free.length ? h('div', { class: 'add-crit' },
    h('div', { class: 'field' }, h('label', { for: 'add-crit-key' }, 'Add a criterion'), keySelect),
    h('div', { class: 'field' }, h('label', { for: 'add-crit-prio' }, 'As'), prioSelect),
    h('button', { class: 'btn', type: 'button', onClick: () => {
      const key = keySelect.value;
      draft = setCriterion(draft, { key, op: CRITERIA[key].op, value: DEFAULT_VALUES[key] }, prioSelect.value);
      dirty = true;
      render(`prio-${key}`);
    } }, 'Add')) : null;

  const notesId = 'brief-notes';
  const notes = h('textarea', { id: notesId, onInput: (e) => { draft.context = { ...draft.context, consultantNotes: e.target.value }; if (!dirty) { dirty = true; saveBar.hidden = false; } } });
  notes.value = draft.context?.consultantNotes || '';
  const context = Object.entries(draft.context || {}).filter(([k]) => !['consultantNotes', 'feedbackNotes'].includes(k));
  const saveBar = h('div', { class: 'panel__actions', id: 'brief-save-bar', hidden: !dirty },
    h('strong', {}, 'Unsaved changes'),
    h('button', { class: 'btn btn--primary', type: 'button', onClick: () => save(() => { dirty = false; return updateWishlist(buyer.id, { ...draft, status: draft.status === 'confirmed' ? 'confirmed' : 'submitted' }, { summary: 'Brief edited by the consultant' }); }, 'brief-title') }, 'Save the brief'),
    h('button', { class: 'btn', type: 'button', onClick: () => { draft = structuredClone(buyer.wishlist); dirty = false; render('brief-title'); } }, 'Discard changes'));

  return h('section', { class: 'panel', 'aria-labelledby': 'brief-title' },
    h('h2', { id: 'brief-title', tabindex: '-1' }, 'Brief'),
    h('p', { class: 'panel__intro' }, 'Edit before confirming it with the buyer. Matches below update as you edit; nothing is saved until you press Save.'),
    rows.length ? h('div', {}, ...rows) : h('p', { class: 'crit-empty' }, 'No criteria yet. Add them below, or generate them from a call transcript.'),
    add,
    context.length ? h('dl', { class: 'context-list' }, ...context.flatMap(([k, v]) => [h('dt', {}, k.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase())), h('dd', {}, String(v))])) : null,
    (draft.context?.feedbackNotes || []).length ? h('div', { class: 'note' }, h('span', { class: 'note__title' }, 'From feedback'), h('ul', {}, ...draft.context.feedbackNotes.map((n) => h('li', {}, n)))) : null,
    h('div', { class: 'field' }, h('label', { for: notesId }, 'Consultant notes'), notes),
    saveBar,
    h('div', { class: 'panel__actions' },
      h('button', { class: 'btn', type: 'button', disabled: dirty || buyer.wishlist?.status === 'confirmed' || !allCriteria(draft).length, onClick: () => save(async () => {
        await updateWishlist(buyer.id, { ...buyer.wishlist, status: 'confirmed', confirmedAt: new Date().toISOString() }, { summary: 'Brief confirmed with the buyer' });
        const updated = await updateBuyer(buyer.id, (b) => ({ ...b, status: b.status === 'new' ? 'brief-confirmed' : b.status }));
        draft = structuredClone(updated.wishlist);
        return updated;
      }, 'brief-title') }, buyer.wishlist?.status === 'confirmed' ? 'Brief confirmed' : 'Mark as confirmed with the buyer')));
}

// Transcript to brief
function transcriptPanel() {
  const area = h('textarea', { id: 'transcript-text', placeholder: 'Paste the call transcript here, or load a text file.' });
  area.value = proposal?.text || '';
  const file = h('input', { type: 'file', id: 'transcript-file', accept: '.txt,.vtt,.srt,text/plain', onChange: async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 500000) { alert('That file is too large for a transcript (over 500 KB).'); return; }
    area.value = await f.text();
  } });
  const recording = buyer.consents?.recording;
  const warning = recording?.granted
    ? null
    : h('p', { class: 'note', role: 'note' }, 'This buyer did not allow recording and transcription. Use only notes you took by hand during the call.');

  let proposalBox = null;
  if (proposal?.result) {
    const r = proposal.result;
    const list = (priority) => (r[LIST_OF[priority]] || []).map((c) => {
      const ev = r.evidence.find((e) => e.key === c.key);
      return h('li', {}, h('span', { class: `mark ${MARK_CLASS[priority]}` }, PRIORITIES.find((p) => p.id === priority).label), ' ', describeCriterion(c),
        ev ? h('div', { class: 'evidence' }, 'From: ', h('q', {}, ev.quote)) : null);
    });
    const items = PRIORITIES.flatMap((p) => list(p.id));
    proposalBox = h('div', { class: 'proposal', role: 'region', 'aria-labelledby': 'proposal-title' },
      h('h3', { id: 'proposal-title', tabindex: '-1' }, `Proposed brief: ${items.length} criteria`),
      items.length ? h('ul', { class: 'reasons' }, ...items) : h('p', {}, 'No criteria were recognised. Check the transcript or write the brief by hand.'),
      Object.keys(r.context).length ? h('p', { class: 'evidence' }, 'Context: ', Object.entries(r.context).map(([k, v]) => `${k}: ${v}`).join('; ')) : null,
      h('div', { class: 'panel__actions' },
        h('button', { class: 'btn btn--primary', type: 'button', disabled: !items.length, onClick: () => applyProposal(r, 'replace') }, 'Replace the brief with this'),
        h('button', { class: 'btn', type: 'button', disabled: !items.length, onClick: () => applyProposal(r, 'merge') }, 'Add what is missing'),
        h('button', { class: 'btn btn--quiet', type: 'button', onClick: () => { proposal = null; render('transcript-text'); } }, 'Discard')));
  }

  return h('section', { class: 'panel', 'aria-labelledby': 'transcript-title' },
    h('h2', { id: 'transcript-title' }, 'Call transcript'),
    h('p', { class: 'panel__intro' }, 'Generate a draft brief from what the buyer said. This demo uses keyword rules; production uses a transcription service and a language model, and you always review the result.'),
    warning,
    h('div', { class: 'transcript-tools' },
      h('div', { class: 'field' }, h('label', { for: 'transcript-text' }, 'Transcript'), area),
      h('div', { class: 'field' }, h('label', { for: 'transcript-file' }, 'Or load a text file (.txt, .vtt, .srt)'), file),
      h('div', { class: 'panel__actions' },
        h('button', { class: 'btn btn--primary', type: 'button', onClick: async () => {
          const text = area.value.trim();
          if (!text) { area.focus(); return; }
          proposal = { text, result: generateWishlistFromTranscript(text) };
          await save(() => addTranscript(buyer.id, { text, source: 'consultant' }), 'proposal-title');
        } }, 'Generate brief from transcript'),
        h('button', { class: 'btn btn--quiet', type: 'button', onClick: () => { area.value = SAMPLE_TRANSCRIPT; area.focus(); } }, 'Load a sample transcript'))),
    proposalBox);
}

function applyProposal(result, mode) {
  let next = mode === 'replace' ? { ...draft, mustHave: [], niceToHave: [], dealBreakers: [] } : draft;
  const existing = new Set(allCriteria(next).map((c) => c.key));
  for (const p of PRIORITIES) {
    for (const c of result[p.list]) {
      if (mode === 'merge' && existing.has(c.key)) continue;
      next = setCriterion(next, c, p.id);
    }
  }
  next.context = { ...(next.context || {}), ...result.context };
  draft = next;
  dirty = true;
  proposal = null;
  render('brief-title');
}

// Matches
function propertySource(p) {
  if (p.source !== 'partner') return 'Oikos listing';
  return agencies.find((a) => a.id === p.partnerAgencyId)?.name || 'Partner agency';
}

function matchesPanel() {
  const all = matchProperties(draft, properties, { includeExcluded: true });
  const included = all.filter((m) => !m.excluded && m.score >= MIN_SCORE);
  const excluded = all.filter((m) => m.excluded || m.score < MIN_SCORE);
  const shortlisted = new Set((buyer.shortlist || []).map((s) => String(s.propertyId)));
  const visible = showExcluded ? all : included;

  const item = (m) => {
    const p = m.property;
    return h('li', { class: `match${m.excluded ? ' match--excluded' : ''}` },
      h('div', { class: 'match__head' },
        h('div', {},
          h('p', { class: 'match__title' }, p.title),
          h('p', { class: 'match__sub' }, [p.reference, `${p.city}, ${p.area}`, p.price != null ? formatEuro(p.price) : 'Price on request', propertySource(p)].join(' · '))),
        scoreBadge(m)),
      h('ul', { class: 'reasons' }, ...reasonItems(m)),
      m.excluded || m.score < MIN_SCORE ? null : h('div', { class: 'match__actions' }, shortlistButton(p, m.score, shortlisted)));
  };

  let body;
  if (!included.length) {
    body = h('div', { class: 'empty-state' },
      h('h3', {}, 'No property in the database fits this brief'),
      h('p', {}, 'Search through partner agencies, colleagues and other sources. Homes you find can be added to the feed and will be matched here.'),
      h('button', { class: 'btn', type: 'button', onClick: () => save(() => addInteraction(buyer.id, { type: 'search', summary: 'External search started: partner agencies, colleagues, other sources' }), 'matches-title') }, 'Log an external search'));
  }
  return h('section', { class: 'panel', 'aria-labelledby': 'matches-title' },
    h('h2', { id: 'matches-title', tabindex: '-1' }, `Matches (${included.length})`),
    h('p', { class: 'panel__intro' }, `All ${properties.length} properties in the feed are checked. Must haves weigh 3, nice to haves 1, deal breakers rule a property out; matches score ${MIN_SCORE} or more.${dirty ? ' Showing the unsaved draft.' : ''}`),
    excluded.length ? h('p', {}, h('button', { class: 'btn btn--quiet btn--small', type: 'button', id: 'toggle-excluded', 'aria-pressed': String(showExcluded), onClick: () => { showExcluded = !showExcluded; render('toggle-excluded'); } }, showExcluded ? 'Hide weak and ruled-out properties' : `Show weak and ruled-out properties (${excluded.length})`)) : null,
    body || null,
    visible.length ? h('ol', { class: 'match-list' }, ...visible.map(item)) : null);
}

function reasonItems(m) {
  return [
    ...m.excludedBy.map((r) => h('li', { class: 'r-missed' }, `Ruled out by deal breaker: ${r.text}`)),
    ...m.met.map((r) => h('li', { class: 'r-met' }, r.text)),
    ...m.partial.map((r) => h('li', { class: 'r-partial' }, `Partly: ${r.text}`)),
    ...m.missed.map((r) => h('li', { class: 'r-missed' }, `Missed: ${r.text}`)),
    ...m.unknown.map((r) => h('li', { class: 'r-unknown' }, `To check: ${r.text}`)),
  ];
}

function scoreBadge(m) {
  if (m.excluded) return h('span', { class: 'status' }, 'Ruled out');
  if (m.score < MIN_SCORE) return h('span', { class: 'status' }, `Weak match, ${m.score}`);
  return h('div', { class: 'score', 'aria-label': `Compatibility ${m.score} out of 100` },
    h('span', { class: 'score__bar', 'aria-hidden': 'true' }, h('span', { style: `width:${m.score}%` })),
    h('span', { class: 'score__num', 'aria-hidden': 'true' }, String(m.score)));
}

function shortlistButton(p, score, shortlisted) {
  const on = shortlisted.has(String(p.id));
  return h('button', { class: on ? 'btn btn--small' : 'btn btn--primary btn--small', type: 'button', id: `sl-${p.id}`, 'aria-pressed': String(on), onClick: () => toggleShortlist(p, score) }, on ? 'On the shortlist' : 'Add to shortlist');
}

function toggleShortlist(p, score) {
  const on = (buyer.shortlist || []).some((s) => String(s.propertyId) === String(p.id));
  // A listing found on the web is not in the feed, so the shortlist keeps a copy of it.
  const entry = { propertyId: p.id, addedAt: new Date().toISOString(), score, status: 'proposed', ...(p.source === 'web' ? { property: p } : {}) };
  save(() => updateBuyer(buyer.id, (b) => ({
    ...b,
    shortlist: on ? b.shortlist.filter((s) => String(s.propertyId) !== String(p.id)) : [...(b.shortlist || []), entry],
  })), `sl-${p.id}`);
}

const listingLink = (p, text) => h('a', { href: p.url, target: '_blank', rel: 'noopener noreferrer' }, text, h('span', { class: 'visually-hidden' }, ' (opens in a new tab)'));

// Web search: an AI agent looks for the draft brief on Italian property portals and brings back 5 to 10 listings,
// scored like the matches above. Setup of the free search service: README, "Ricerca immobili sul web".
const WEB_PROGRESS = {
  search: (p) => `${p.round ? 'Not enough yet: searching more towns' : 'Searching the portals'} (${p.total} searches)…`,
  open: (p) => `Opening ${p.total} pages of listings…`,
  read: (p) => `Reading ${p.total} listings…`,
  done: () => 'Scoring…',
};

function webPanel() {
  const service = loadService();
  const saved = buyer.webSearch;
  const shortlisted = new Set((buyer.shortlist || []).map((s) => String(s.propertyId)));
  const picked = saved ? pickCandidates(matchProperties(draft, saved.properties), { minScore: MIN_SCORE }) : [];
  const strong = picked.filter((m) => m.score >= MIN_SCORE).length;

  const item = (m) => {
    const p = m.property;
    return h('li', { class: 'match' },
      h('div', { class: 'match__head' },
        h('div', {},
          h('p', { class: 'match__title' }, listingLink(p, p.title)),
          h('p', { class: 'match__sub' }, [p.city, p.price != null ? formatEuro(p.price) : 'Price not read', p.surface ? `${p.surface} m²` : null, p.portal].filter(Boolean).join(' · '))),
        scoreBadge(m)),
      p.summary ? h('p', {}, p.summary) : null,
      h('ul', { class: 'reasons' }, ...reasonItems(m)),
      h('div', { class: 'match__actions' }, shortlistButton(p, m.score, shortlisted)));
  };

  let results = null;
  if (saved) {
    const partly = saved.stats.readByModel < saved.stats.read ? ' Some were read without the language model, so fewer details are known.' : '';
    results = [
      h('p', { class: 'hint' }, `Searched ${formatDate(saved.at, { dateStyle: 'medium', timeStyle: 'short' })}: ${saved.stats.searches} searches, ${saved.properties.length} listings read.${partly}${dirty ? ' Scored against the unsaved draft.' : ''}`),
      saved.stats.errors?.length ? h('p', { class: 'note', role: 'note' }, `Part of the search failed, so this list may be incomplete: ${saved.stats.errors[0]}`) : null,
      picked.length && strong < 5 ? h('p', { class: 'note', role: 'note' }, strong
        ? `Only ${strong} of these fit the brief well; the others are the closest found. Widen the area or the budget for more.`
        : 'None fits the brief well; these are the closest found. Widen the area or the budget for more.') : null,
      picked.length
        ? h('ol', { class: 'match-list' }, ...picked.map(item))
        : h('p', { class: 'crit-empty' }, 'None of the listings found fits this brief. Widen the area or the budget and search again.'),
      h('details', {}, h('summary', {}, 'What was searched'), h('ul', {}, ...saved.queries.map((q) => h('li', {}, q)))),
    ];
  }

  const actions = h('div', { class: 'panel__actions' },
    h('button', { class: 'btn btn--primary', type: 'button', id: 'web-run', disabled: web.running || !allCriteria(draft).length, onClick: runWebSearch }, web.running ? 'Searching…' : saved ? 'Search again' : 'Find 5 to 10 properties'),
    h('button', { class: 'btn btn--quiet btn--small', type: 'button', disabled: web.running, onClick: () => { web.settings = true; render('web-endpoint'); } }, 'Change the search service'));

  return h('section', { class: 'panel', 'aria-labelledby': 'web-title' },
    h('h2', { id: 'web-title', tabindex: '-1' }, 'Found on the web'),
    h('p', { class: 'panel__intro' }, "An AI agent turns the brief into searches on Italian property portals, reads the listings it finds and scores them with the same rules as the matches above, then keeps the best 5 to 10. They are other agencies' listings, and some details are only in the full ad: check each one before proposing it."),
    !service || web.settings ? serviceForm(service) : actions,
    h('p', { class: 'hint', id: 'web-progress', role: 'status' }, web.running ? web.progress : ''),
    web.error ? h('p', { class: 'note', role: 'alert' }, web.error) : null,
    results);
}

function serviceForm(service) {
  const endpoint = h('input', { type: 'url', id: 'web-endpoint', name: 'endpoint', required: true, placeholder: 'https://oikos-web-search.example.workers.dev' });
  const key = h('input', { type: 'password', id: 'web-key', name: 'key', required: true, autocomplete: 'off' });
  endpoint.value = service?.endpoint || '';
  key.value = service?.key || '';
  const problem = h('p', { class: 'field-error', role: 'alert' });
  const form = h('form', { class: 'form', id: 'web-service' },
    h('div', { class: 'form-row form-row--2' },
      h('div', { class: 'field' }, h('label', { for: 'web-endpoint' }, 'Search service address'), endpoint),
      h('div', { class: 'field' }, h('label', { for: 'web-key' }, 'Access key'), key)),
    h('p', { class: 'hint' }, 'The free service in the worker folder of the project; the README explains how to set it up. Address and key are kept in this browser only.'),
    problem,
    h('div', { class: 'form-actions' },
      h('button', { class: 'btn', type: 'submit' }, 'Connect'),
      service ? h('button', { class: 'btn btn--quiet', type: 'button', onClick: () => { web.settings = false; render('web-run'); } }, 'Cancel') : null));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const next = { endpoint: endpoint.value.trim(), key: key.value.trim() };
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    problem.textContent = '';
    try {
      await serviceClient(next).status();
    } catch (error) {
      problem.textContent = `The service did not answer (${error.message}). Check the address and the key, and that this site is listed in ALLOWED_ORIGINS.`;
      button.disabled = false;
      return;
    }
    saveService(next);
    web = { ...web, settings: false, error: '' };
    render('web-run');
  });
  return form;
}

async function runWebSearch() {
  const service = loadService();
  if (!service || web.running) return;
  web = { ...web, running: true, error: '', progress: 'Starting…' };
  render('web-run');
  const onProgress = (p) => {
    web.progress = WEB_PROGRESS[p.step](p);
    const el = document.getElementById('web-progress');
    if (el) el.textContent = web.progress;
  };
  try {
    const { properties: found, queries, stats } = await findOnWeb(draft, { ...serviceClient(service), minScore: MIN_SCORE, onProgress });
    if (stats.failedSearches === stats.searches) throw new Error(stats.searchErrors[0] || 'no search answered');
    const fit = pickCandidates(matchProperties(draft, found), { minScore: MIN_SCORE }).filter((m) => m.score >= MIN_SCORE).length;
    web.running = false;
    const errors = [...new Set([...stats.searchErrors, ...stats.modelErrors])].slice(0, 2);
    const kept = { searches: stats.searches, listings: stats.listings, read: stats.read, readByModel: stats.readByModel, errors };
    await save(async () => {
      await updateBuyer(buyer.id, (b) => ({ ...b, webSearch: { at: new Date().toISOString(), queries, stats: kept, properties: found } }));
      return addInteraction(buyer.id, { type: 'search', summary: `Web search: ${found.length} listings read on property portals, ${fit} fit the brief` });
    }, 'web-title');
  } catch (error) {
    web = { ...web, running: false, error: `The search did not finish: ${error.message}.` };
    render('web-run');
  }
}

// Shortlist and feedback
function shortlistPanel() {
  const list = buyer.shortlist || [];
  const items = list.map((s) => {
    const p = properties.find((x) => String(x.id) === String(s.propertyId)) || s.property;
    const title = p ? p.title : `Property ${s.propertyId}`;
    const statusId = `sls-${s.propertyId}`;
    const feedback = (buyer.feedback || []).filter((f) => String(f.propertyId) === String(s.propertyId));
    return h('li', { class: 'match' },
      h('p', { class: 'match__title' }, title),
      h('p', { class: 'match__sub' }, `Added ${formatDate(s.addedAt)}, score ${s.score}`, p?.url ? [' · ', listingLink(p, `See it on ${p.portal}`)] : null),
      h('div', { class: 'match__actions' },
        h('label', { class: 'visually-hidden', for: statusId }, `Status of ${title}`),
        h('select', { id: statusId, onChange: (e) => save(() => updateBuyer(buyer.id, (b) => ({ ...b, shortlist: b.shortlist.map((x) => (String(x.propertyId) === String(s.propertyId) ? { ...x, status: e.target.value } : x)) })), statusId) },
          ...Object.entries(SHORTLIST_STATUS).map(([v, l]) => h('option', { value: v, selected: v === s.status }, l))),
        h('button', { class: 'btn btn--small', type: 'button', id: `fb-open-${s.propertyId}`, 'aria-expanded': String(openFeedback === String(s.propertyId)), onClick: () => { openFeedback = openFeedback === String(s.propertyId) ? null : String(s.propertyId); render(`fb-open-${s.propertyId}`); } }, 'Record feedback')),
      ...feedback.map((f) => h('p', { class: 'evidence' }, `${formatDate(f.at)}: ${f.verdict}${f.reasons.length ? ` (${f.reasons.map((r) => FEEDBACK_REASONS[r] || r).join(', ').toLowerCase()})` : ''}${f.note ? `. "${f.note}"` : ''}`)),
      openFeedback === String(s.propertyId) && p ? feedbackForm(p) : null);
  });
  return h('section', { class: 'panel', 'aria-labelledby': 'shortlist-title' },
    h('h2', { id: 'shortlist-title' }, `Shortlist (${list.length})`),
    lastChanges.length ? h('div', { class: 'change-note', role: 'status' }, h('strong', {}, 'Brief updated from feedback: '), lastChanges.join('; '), '.') : null,
    list.length
      ? h('ul', { class: 'match-list' }, ...items)
      : h('p', { class: 'crit-empty' }, 'Nothing on the shortlist yet. Add properties from the matches.'),
    list.length ? h('div', { class: 'panel__actions' }, h('button', { class: 'btn', type: 'button', onClick: () => save(async () => {
      await addInteraction(buyer.id, { type: 'shortlist', summary: `Shortlist sent: ${list.length} ${list.length === 1 ? 'property' : 'properties'}` });
      return updateBuyer(buyer.id, (b) => ({ ...b, status: ['new', 'brief-confirmed', 'searching'].includes(b.status) ? 'shortlist-sent' : b.status }));
    }, 'shortlist-title') }, 'Record shortlist as sent')) : null);
}

function feedbackForm(property) {
  const form = h('form', { class: 'feedback-form', 'aria-label': `Feedback on ${property.title}` });
  const verdicts = h('fieldset', {}, h('legend', {}, 'Verdict'), h('div', { class: 'checks' },
    ...[['liked', 'Liked it'], ['maybe', 'Maybe'], ['rejected', 'Rejected']].map(([v, l], i) => h('label', { class: 'check' }, h('input', { type: 'radio', name: 'verdict', value: v, checked: i === 2 }), h('span', {}, l)))));
  const reasons = h('fieldset', {}, h('legend', {}, 'Reasons given'), h('div', { class: 'checks' },
    ...Object.entries(FEEDBACK_REASONS).map(([v, l]) => h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'reason', value: v }), h('span', {}, l)))));
  const noteId = `fb-note-${property.id}`;
  form.append(verdicts, reasons, h('div', { class: 'field' }, h('label', { for: noteId }, 'Note'), h('textarea', { id: noteId, name: 'note' })),
    h('p', { class: 'hint' }, 'Reasons update the brief: for example "too far from the sea" makes distance to the sea a must have with a tighter limit.'),
    h('div', { class: 'form-actions' }, h('button', { class: 'btn btn--primary', type: 'submit' }, 'Save feedback')));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const chosen = data.getAll('reason');
    const { wishlist, changes } = applyFeedback(buyer.wishlist || draft, property, chosen);
    const entry = { id: `f-${Date.now().toString(36)}`, propertyId: property.id, at: new Date().toISOString(), verdict: data.get('verdict'), reasons: chosen, note: data.get('note').trim(), changes };
    openFeedback = null;
    lastChanges = changes;
    save(async () => {
      const updated = await updateBuyer(buyer.id, (b) => ({
        ...b,
        wishlist: changes.length ? wishlist : b.wishlist,
        feedback: [...(b.feedback || []), entry],
        shortlist: b.shortlist.map((s) => (String(s.propertyId) === String(property.id) && entry.verdict === 'rejected' ? { ...s, status: 'rejected' } : s)),
      }));
      await addInteraction(buyer.id, { type: 'feedback', summary: `Feedback on ${property.title}: ${entry.verdict}${chosen.length ? ` (${chosen.map((r) => FEEDBACK_REASONS[r].toLowerCase()).join(', ')})` : ''}` });
      if (!dirty) draft = structuredClone(updated.wishlist);
      return getBuyer(buyer.id);
    }, 'shortlist-title');
  });
  return form;
}

// Contact, source, consents, history
function contactPanel() {
  const c = buyer.contact || {};
  const field = (name, label, type = 'text') => h('div', { class: 'field' }, h('label', { for: `ct-${name}` }, label), h('input', { type, id: `ct-${name}`, name, value: c[name] || '' }));
  const form = h('form', { class: 'form' },
    field('name', 'Name'), field('email', 'Email', 'email'), field('phone', 'Phone', 'tel'), field('country', 'Country'),
    h('div', { class: 'field' }, h('label', { for: 'ct-status' }, 'Status'), h('select', { id: 'ct-status', name: 'status' },
      ...Object.entries(STATUS_LABELS).map(([v, l]) => h('option', { value: v, selected: v === buyer.status }, l)))),
    h('div', { class: 'form-actions' }, h('button', { class: 'btn', type: 'submit' }, 'Save contact and status')));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    save(() => updateBuyer(buyer.id, (b) => ({ ...b, status: data.status, contact: { ...b.contact, name: data.name.trim(), email: data.email.trim(), phone: data.phone.trim(), country: data.country.trim() } })), 'contact-title');
  });
  return h('section', { class: 'panel', 'aria-labelledby': 'contact-title' }, h('h2', { id: 'contact-title', tabindex: '-1' }, 'Contact and status'), form);
}

function sourcePanel() {
  const ls = buyer.leadSource;
  const rows = [];
  if (ls?.firstTouch) {
    const utm = Object.entries(ls.firstTouch.utm || {}).map(([k, v]) => `${k}=${v}`).join(', ');
    rows.push(['First visit', formatDate(ls.firstTouch.at, { dateStyle: 'medium', timeStyle: 'short' })], ['Campaign', utm || 'none'], ['Referrer', ls.firstTouch.referrer || 'none (direct)'], ['Landing page', ls.firstTouch.landingPage]);
  }
  if (ls?.adClick) rows.push(['Ad click', Object.entries(ls.adClick).filter(([k]) => k !== 'at').map(([k, v]) => `${k}: ${v}`).join(', ')]);
  if (buyer.buyerCountry) rows.push(['Buyer country', buyer.buyerCountry]);
  if (ls?.submittedFrom) rows.push(['Sent from', ls.submittedFrom]);
  return h('section', { class: 'panel', 'aria-labelledby': 'source-title' },
    h('h2', { id: 'source-title' }, 'Lead source'),
    h('p', {}, h('strong', {}, describeLeadSource(ls))),
    ls?.consent && !ls.consent.analytics ? h('p', { class: 'hint' }, 'The buyer did not allow visit-source tracking, so campaign and referrer were not recorded.') : null,
    rows.length ? h('dl', { class: 'context-list' }, ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])) : null);
}

function consentsPanel() {
  const labels = { processing: 'Data processing', recording: 'Call recording and transcription', marketing: 'Marketing emails' };
  const items = Object.entries(labels).map(([k, label]) => {
    const c = buyer.consents?.[k];
    return [h('dt', {}, label), h('dd', {}, c ? `${c.granted ? 'Granted' : 'Not granted'}, ${formatDate(c.at, { dateStyle: 'medium', timeStyle: 'short' })}` : 'Not asked')];
  });
  return h('section', { class: 'panel', 'aria-labelledby': 'consents-title' },
    h('h2', { id: 'consents-title' }, 'Consents'),
    consentFlags(buyer.consents),
    h('dl', { class: 'context-list' }, ...items.flat()));
}

function historyPanel() {
  const items = [...(buyer.interactions || [])].sort((a, b) => b.at.localeCompare(a.at));
  return h('section', { class: 'panel', 'aria-labelledby': 'history-title' },
    h('h2', { id: 'history-title' }, 'History'),
    items.length
      ? h('ol', { class: 'timeline' }, ...items.map((i) => h('li', {}, h('time', { datetime: i.at }, formatDate(i.at, { dateStyle: 'medium', timeStyle: 'short' })), `${i.summary} `, h('span', { class: 'cell-sub' }, i.by))))
      : h('p', { class: 'crit-empty' }, 'No interactions recorded yet.'));
}
