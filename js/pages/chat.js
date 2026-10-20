// Guided chat: one question at a time, a priority for every criterion, autosaved, editable.
import { STEPS, STEP_BY_ID, answerLabel, needsPriority, loadState, newState, saveState, firstUnanswered } from '../core/interview.js';
import { valueControls, priorityControls, priorityMark } from '../ui/answer-controls.js';
import { getLeadSource } from '../ui/lead-source.js';
import { h, $ } from '../ui/dom.js';
import { t, link } from '../core/i18n.js';

let state;
let cursor = 0;
let phase = 'value';
let pending = null;
let els = {};
let storageWarned = false;

export function init() {
  const root = $('#interview');
  state = loadState() || newState('chat');
  const params = new URLSearchParams(location.search);
  if (params.get('country')) state.buyerCountry = params.get('country');
  if (!state.leadSource) state.leadSource = getLeadSource();
  const edit = params.get('edit');
  cursor = edit && STEP_BY_ID[edit] ? STEPS.indexOf(STEP_BY_ID[edit]) : firstUnanswered(state);

  els.progress = h('span');
  els.progressText = h('p', { class: 'progress__text', id: 'progress-text' });
  els.bar = h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(STEPS.length), 'aria-labelledby': 'progress-text' }, els.progress);
  els.back = h('button', { class: 'btn btn--quiet btn--small', type: 'button', onClick: back }, t('chat.back'));
  els.log = h('ol', { class: 'chat-log', 'aria-label': t('chat.logLabel') });
  els.reply = h('div', { class: 'reply', id: 'reply', tabindex: '-1' });
  els.saveNote = h('p', { class: 'reply__error', role: 'status' });
  root.replaceChildren(
    h('div', { class: 'interview__bar' }, els.bar, els.progressText,
      h('div', { class: 'interview__links' }, els.back, h('a', { class: 'btn btn--quiet btn--small', href: link('start/wishlist') }, t('chat.briefSoFar')))),
    els.log, els.reply, els.saveNote);
  render(false);
}

function persist() {
  if (!saveState(state) && !storageWarned) {
    storageWarned = true;
    els.saveNote.textContent = t('chat.storageWarning');
  }
}

function render(focus = true) {
  const answered = STEPS.filter((s) => state.answers[s.id] && (!needsPriority(s, state.answers[s.id].value) || state.answers[s.id].priority)).length;
  els.progress.style.width = `${Math.round((answered / STEPS.length) * 100)}%`;
  els.bar.setAttribute('aria-valuenow', String(answered));
  els.progressText.textContent = cursor < STEPS.length ? t('chat.question', { n: cursor + 1, total: STEPS.length }) : t('chat.allAnswered', { total: STEPS.length });
  els.back.disabled = cursor === 0 && phase === 'value';
  renderLog();
  renderReply();
  if (focus) {
    const target = els.reply.querySelector('.chip, .prio, textarea, input, button');
    (target || els.reply).focus({ preventScroll: true });
    els.reply.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
}

function renderLog() {
  const items = [];
  for (const [i, step] of STEPS.entries()) {
    const a = state.answers[step.id];
    if (i === cursor || !a) continue;
    items.push(h('li', { class: 'msg msg--bot' }, h('p', {}, step.question)));
    items.push(h('li', { class: 'msg msg--user' },
      h('p', {}, answerLabel(step, a.value)),
      h('div', { class: 'msg__meta' },
        a.priority ? priorityMark(a.priority) : null,
        h('button', { class: 'msg__edit', type: 'button', 'aria-label': t('chat.changeAria', { q: step.question }), onClick: () => goTo(i) }, t('chat.change')))));
  }
  els.log.replaceChildren(...items);
}

function renderReply() {
  if (cursor >= STEPS.length) {
    els.reply.replaceChildren(h('div', { class: 'interview__done' },
      h('h2', {}, t('chat.doneTitle')),
      h('p', {}, t('chat.doneText')),
      h('p', {}, h('a', { class: 'btn btn--primary', href: link('start/wishlist') }, t('chat.reviewBrief')))));
    return;
  }
  const step = STEPS[cursor];
  const a = state.answers[step.id];
  const bubble = h('div', { class: 'msg msg--bot msg--new', 'aria-hidden': 'true' }, h('p', {}, step.question), step.help ? h('p', { class: 'msg__help' }, step.help) : null);
  if (phase === 'priority') {
    els.reply.replaceChildren(
      h('p', { class: 'reply__help' }, t('chat.yourAnswer', { a: answerLabel(step, pending) })),
      priorityControls(step, a?.priority, choosePriority, () => { phase = 'value'; render(); }));
  } else {
    els.reply.replaceChildren(bubble, valueControls(step, a?.value, chooseValue, { hidePrompt: true }));
  }
}

function chooseValue(value) {
  const step = STEPS[cursor];
  if (needsPriority(step, value)) {
    pending = value;
    phase = 'priority';
    render();
    return;
  }
  state.answers[step.id] = { value, priority: null };
  advance();
}

function choosePriority(priority) {
  const step = STEPS[cursor];
  state.answers[step.id] = { value: pending, priority };
  pending = null;
  advance();
}

function advance() {
  persist();
  phase = 'value';
  cursor = firstUnanswered(state);
  render();
}

function goTo(index) {
  cursor = index;
  phase = 'value';
  pending = null;
  render();
}

function back() {
  if (phase === 'priority') {
    phase = 'value';
  } else if (cursor > 0) {
    cursor -= 1;
  }
  render();
}
