// "Your brief": the wishlist built from the interview, editable, then sent to a consultant (the CRM).
import { STEPS, STEP_BY_ID, answerLabel, buildWishlist, loadState, saveState, clearState, firstUnanswered } from '../core/interview.js';
import { PRIORITIES, MARK_CLASS, describeCriterion } from '../core/wishlist.js';
import { listProperties } from '../api/apimo.js';
import { compatibleCount } from '../api/matching.js';
import { createBuyer, getBuyer, updateWishlist, addInteraction } from '../api/crm.js';
import { getLeadSource } from '../ui/lead-source.js';
import { validate, clearErrorsOnInput, consentsFrom, showStatus, setBusy } from '../ui/forms.js';
import { h, $, formatDate } from '../ui/dom.js';
import { t, link, LANG } from '../core/i18n.js';

// Criterion keys map back to the interview step that produced them.
const STEP_FOR_KEY = { region: 'region', price: 'budget', type: 'type', bedrooms: 'bedrooms', bathrooms: 'bathrooms', condition: 'condition', pool: 'pool', poolOrSpace: 'pool', land: 'land', seaView: 'seaView', distanceSea: 'distanceSea', distanceAirport: 'distanceAirport', distanceTown: 'distanceTown' };

let root;
let state;
let announcer;

export function init() {
  root = $('#wishlist-app');
  state = loadState();
  if (!state || !Object.keys(state.answers).length) {
    root.replaceChildren(h('div', { class: 'empty-state' },
      h('h2', {}, t('brief.emptyTitle')),
      h('p', {}, t('brief.emptyText')),
      h('p', { class: 'form-actions' },
        h('a', { class: 'btn btn--primary', href: link('start/chat') }, t('brief.startChat')),
        h('a', { class: 'btn', href: link('start/voice') }, t('brief.answerVoice')),
        h('a', { class: 'btn', href: link('start/webcall') }, t('brief.bookCall')))));
    return;
  }
  announcer = h('p', { class: 'visually-hidden', role: 'status' });
  render();
}

function wishlistNow() {
  return buildWishlist(state.answers);
}

function render() {
  const w = wishlistNow();
  const answered = firstUnanswered(state);
  const parts = [announcer];

  if (state.submittedBuyerId) {
    parts.push(h('div', { class: 'note', role: 'note' },
      h('span', { class: 'note__title' }, t('brief.sentOn', { date: formatDate(state.submittedAt) })),
      h('p', {}, t('brief.sentNote'))));
  }
  if (answered < STEPS.length) {
    parts.push(h('div', { class: 'note', role: 'note' },
      h('span', { class: 'note__title' }, t('brief.answered', { n: answered, total: STEPS.length })),
      h('p', {}, t('brief.sendAsIs'), h('a', { href: link('start/chat') }, t('brief.continueInterview')), t('brief.first'))));
  }

  parts.push(h('div', { class: 'brief-cols' }, ...PRIORITIES.map((p) => column(p, w[p.list]))));

  const contextRows = STEPS.filter((s) => s.kind === 'context' && state.answers[s.id] && state.answers[s.id].value !== '');
  if (contextRows.length) {
    parts.push(h('h2', {}, t('brief.contextTitle')));
    parts.push(h('dl', { class: 'context-list' }, ...contextRows.flatMap((s) => [
      h('dt', {}, s.question),
      h('dd', {}, answerLabel(s, state.answers[s.id].value), ' ', h('a', { href: `${link('start/chat')}?edit=${s.id}`, 'aria-label': t('brief.changeAria', { q: s.question }) }, t('brief.change'))),
    ])));
  }

  const matchNote = h('div', { class: 'match-note', role: 'status' }, h('p', {}, t('brief.checking')));
  parts.push(matchNote);
  parts.push(sendSection(w));
  root.replaceChildren(...parts);
  checkMatches(w, matchNote);
}

function column(p, criteria) {
  const list = criteria.length
    ? h('ul', { class: 'crit-list' }, ...criteria.map((c) => criterionRow(c, p.id)))
    : h('p', { class: 'crit-empty' }, t('brief.nothingHere'));
  return h('section', { class: `brief-col${p.id === 'dealbreaker' ? ' brief-col--never' : ''}`, 'aria-labelledby': `col-${p.id}` },
    h('h2', { id: `col-${p.id}` }, h('span', { class: `mark ${MARK_CLASS[p.id]}` }, p.label)),
    h('p', { class: 'brief-col__note' }, t(`brief.notes.${p.id}`)),
    list);
}

function criterionRow(criterion, priority) {
  const stepId = STEP_FOR_KEY[criterion.key];
  const label = describeCriterion(criterion);
  const selectId = `move-${criterion.key}`;
  const select = h('select', { id: selectId, onChange: (e) => move(stepId, e.target.value, label, criterion.key) },
    ...PRIORITIES.map((p) => h('option', { value: p.id, selected: p.id === priority }, p.label)));
  return h('li', { class: 'crit' },
    h('span', { class: 'crit__label' }, label),
    h('div', { class: 'crit__controls' },
      h('label', { class: 'visually-hidden', for: selectId }, t('brief.categoryFor', { label })), select,
      h('a', { class: 'btn btn--quiet btn--small', href: `${link('start/chat')}?edit=${stepId}`, 'aria-label': t('brief.changeAnswerAria', { label }) }, t('brief.change')),
      h('button', { class: 'btn btn--quiet btn--small', type: 'button', 'aria-label': t('brief.removeAria', { label }), onClick: () => removeCriterion(stepId, label) }, t('brief.remove'))));
}

function move(stepId, priority, label, key) {
  state.answers[stepId] = { ...state.answers[stepId], priority };
  saveState(state);
  render();
  announcer.textContent = t('brief.moved', { label, priority: PRIORITIES.find((p) => p.id === priority).label });
  $(`#move-${key}`)?.focus();
}

// The answer that means "no preference" for a step: its any/exclusive option, or every option of a multi choice.
function neutralValue(step) {
  const neutral = step.options.find((o) => o.value === 'any' || o.exclusive);
  if (neutral) return step.input === 'multi' ? [neutral.value] : neutral.value;
  return step.options.map((o) => o.value);
}

function removeCriterion(stepId, label) {
  state.answers[stepId] = { value: neutralValue(STEP_BY_ID[stepId]), priority: null };
  saveState(state);
  render();
  announcer.textContent = t('brief.removed', { label });
  root.querySelector('.brief-cols select, .brief-cols a')?.focus();
}

async function checkMatches(w, box) {
  try {
    const properties = await listProperties();
    const n = compatibleCount(w, properties);
    box.replaceChildren(n
      ? h('p', {}, h('strong', {}, n === 1 ? t('brief.matchesOne') : t('brief.matchesMany', { n })), t('brief.matchesRest'))
      : h('p', {}, h('strong', {}, t('brief.noMatchStrong')), t('brief.noMatchRest')));
  } catch {
    box.replaceChildren(h('p', {}, t('brief.matchError')));
  }
}

function sendSection(w) {
  const already = Boolean(state.submittedBuyerId);
  const statusEl = h('p', { class: 'form-status', role: 'status', tabindex: '-1' });
  const field = (id, label, input, errorId) => h('div', { class: 'field' }, h('label', { for: id }, label), input, errorId ? h('span', { class: 'field-error', id: errorId }) : null);
  const form = h('form', { class: 'form', id: 'send-brief', novalidate: true });

  if (!already) {
    form.append(
      statusEl,
      h('div', { class: 'form-row form-row--2' },
        field('wl-name', t('brief.form.name'), h('input', { type: 'text', id: 'wl-name', name: 'name', autocomplete: 'name', required: true, placeholder: t('brief.form.namePh'), 'aria-describedby': 'wl-name-error' }), 'wl-name-error'),
        field('wl-email', t('brief.form.email'), h('input', { type: 'email', id: 'wl-email', name: 'email', autocomplete: 'email', required: true, placeholder: t('brief.form.emailPh'), 'aria-describedby': 'wl-email-error' }), 'wl-email-error')),
      h('div', { class: 'form-row form-row--2' },
        field('wl-phone', h('span', {}, t('brief.form.phone'), h('span', { class: 'optional' }, t('brief.form.optional'))), h('input', { type: 'tel', id: 'wl-phone', name: 'phone', autocomplete: 'tel' })),
        field('wl-country', t('brief.form.country'), h('input', { type: 'text', id: 'wl-country', name: 'country', autocomplete: 'country-name', required: true, 'aria-describedby': 'wl-country-error' }), 'wl-country-error')),
      field('wl-language', t('brief.form.language'), h('select', { id: 'wl-language', name: 'language' },
        ...[['en', 'English'], ['it', 'Italiano'], ['de', 'Deutsch'], ['fr', 'Français'], ['nl', 'Nederlands'], ['es', 'Español']].map(([v, l]) => h('option', { value: v, selected: v === LANG }, l)))),
      h('fieldset', { class: 'consents' },
        h('legend', {}, t('brief.form.consents')),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'consentProcessing', required: true, 'aria-describedby': 'wl-consent-error' }),
          h('span', {}, h('strong', {}, t('brief.form.processing')), t('brief.form.processingBefore'), h('a', { href: link('privacy') }, t('brief.form.privacyPolicy')), t('brief.form.processingAfter'))),
        h('span', { class: 'field-error', id: 'wl-consent-error' }),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'consentMarketing' }),
          h('span', {}, h('strong', {}, t('brief.form.marketing')), t('brief.form.marketingText')))),
      h('div', { class: 'form-actions' }, h('button', { class: 'btn btn--primary', type: 'submit' }, t('brief.send'))));
  } else {
    form.append(statusEl, h('div', { class: 'form-actions' },
      h('button', { class: 'btn btn--primary', type: 'submit' }, t('brief.sendUpdated')),
      h('button', { class: 'btn btn--quiet', type: 'button', onClick: startOver }, t('brief.startOver'))));
  }
  clearErrorsOnInput(form);
  form.addEventListener('submit', (e) => submit(e, form, statusEl));

  return h('section', { class: 'send-brief', 'aria-labelledby': 'send-title' },
    h('h2', { id: 'send-title' }, already ? t('brief.updateTitle') : t('brief.sendTitle')),
    already ? null : h('p', {}, t('brief.sendIntro')),
    form);
}

async function submit(e, form, statusEl) {
  e.preventDefault();
  if (!state.submittedBuyerId && !validate(form)) return;
  const button = form.querySelector('[type="submit"]');
  setBusy(button, true);
  const wishlist = { ...wishlistNow(), status: 'submitted' };
  try {
    if (state.submittedBuyerId && (await getBuyer(state.submittedBuyerId))) {
      await updateWishlist(state.submittedBuyerId, wishlist, { by: 'buyer', summary: 'Buyer sent an updated brief' });
      showStatus(statusEl, 'ok', t('brief.updatedOkTitle'), t('brief.updatedOk'));
    } else {
      const data = new FormData(form);
      const leadSource = { ...getLeadSource(), interviewStartedFrom: state.leadSource?.submittedFrom || null };
      if (state.buyerCountry && !leadSource.buyerCountry) leadSource.buyerCountry = state.buyerCountry;
      const buyer = await createBuyer({
        source: state.mode === 'voice' ? 'voice' : 'chat',
        contact: { name: data.get('name').trim(), email: data.get('email').trim(), phone: data.get('phone').trim(), country: data.get('country').trim(), language: data.get('language') },
        wishlist,
        leadSource,
        consents: consentsFrom(form),
        interaction: { type: 'interview', summary: `${state.mode === 'voice' ? 'Voice interview' : 'Guided chat'} completed and brief sent` },
      });
      state.submittedBuyerId = buyer.id;
      state.submittedAt = new Date().toISOString();
      saveState(state);
      render();
      const fresh = $('#send-brief .form-status');
      showStatus(fresh, 'ok', t('brief.sentOkTitle'), t('brief.sentOk'), t('brief.sentDemo'));
    }
  } catch (error) {
    showStatus(statusEl, 'error', t('brief.notSentTitle'), `${error.message} ${t('brief.notSentRetry')}`);
  } finally {
    if (button.isConnected) setBusy(button, false);
  }
}

function startOver() {
  if (!confirm(t('brief.startOverConfirm'))) return;
  if (state.submittedBuyerId) addInteraction(state.submittedBuyerId, { type: 'note', summary: 'Buyer started a new brief in the same browser', by: 'system' }).catch(() => {});
  clearState();
  location.href = link('start');
}

