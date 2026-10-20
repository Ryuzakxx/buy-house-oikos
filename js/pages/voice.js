// Voice interview: the chat's questions read aloud, answers by speech, transcript always editable.
// Uses the Web Speech API; browsers without SpeechRecognition are sent to the guided chat.
import { STEPS, answerLabel, needsPriority, loadState, newState, saveState, firstUnanswered, interpretSpoken, interpretPriority } from '../core/interview.js';
import { valueControls, priorityControls, priorityMark } from '../ui/answer-controls.js';
import { getLeadSource } from '../ui/lead-source.js';
import { h, $ } from '../ui/dom.js';
import { t, link, SPEECH_LANG } from '../core/i18n.js';

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

let state;
let cursor = 0;
let phase = 'value';
let pending = null;
let pendingRaw = null;
let recognizer = null;
let listening = false;
let els = {};

export function init() {
  const root = $('#interview');
  state = loadState() || newState('voice');
  const params = new URLSearchParams(location.search);
  if (params.get('country')) state.buyerCountry = params.get('country');
  if (!state.leadSource) state.leadSource = getLeadSource();
  cursor = firstUnanswered(state);

  if (!Recognition) {
    root.replaceChildren(h('div', { class: 'interview__done', role: 'status' },
      h('h2', {}, t('voice.unsupportedTitle')),
      h('p', {}, t('voice.unsupportedText')),
      h('p', {}, h('a', { class: 'btn btn--primary', href: `${link('start/chat')}${location.search}` }, t('voice.continueChat')))));
    return;
  }

  root.replaceChildren(h('div', { class: 'interview__done' },
    h('h2', {}, cursor > 0 ? t('voice.continueFrom', { n: cursor + 1 }) : t('voice.ready')),
    h('p', {}, t('voice.readyText')),
    h('p', {}, h('button', { class: 'btn btn--primary', type: 'button', onClick: () => start(root) }, t('voice.start')))));
}

function start(root) {
  $('#voice-intro')?.setAttribute('hidden', '');
  els.progress = h('span');
  els.progressText = h('p', { class: 'progress__text', id: 'progress-text' });
  els.bar = h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(STEPS.length), 'aria-labelledby': 'progress-text' }, els.progress);
  els.panel = h('div', { class: 'reply voice', tabindex: '-1' });
  els.log = h('ol', { class: 'voice-log', 'aria-label': t('voice.logLabel') });
  root.replaceChildren(
    h('div', { class: 'interview__bar' }, els.bar, els.progressText,
      h('div', { class: 'interview__links' },
        h('a', { class: 'btn btn--quiet btn--small', href: link('start/chat') }, t('voice.switchTyping')),
        h('a', { class: 'btn btn--quiet btn--small', href: link('start/wishlist') }, t('chat.briefSoFar')))),
    els.panel, els.log);
  render(true);
}

function setupRecognizer(onText, onFinal) {
  if (recognizer) recognizer.abort();
  recognizer = new Recognition();
  recognizer.lang = SPEECH_LANG;
  recognizer.interimResults = true;
  recognizer.continuous = false;
  let finalText = '';
  recognizer.onresult = (e) => {
    const text = [...e.results].map((r) => r[0].transcript).join(' ').trim();
    onText(text);
    if (e.results[e.results.length - 1].isFinal) finalText = text;
  };
  recognizer.onerror = (e) => {
    const known = ['not-allowed', 'no-speech', 'audio-capture', 'network'].includes(e.error);
    status(known ? t(`voice.errors.${e.error}`) : t('voice.errors.other', { error: e.error }));
  };
  recognizer.onend = () => {
    listening = false;
    updateMic();
    if (finalText) onFinal(finalText);
  };
}

function listen(onText, onFinal) {
  if (listening) {
    recognizer.stop();
    return;
  }
  window.speechSynthesis?.cancel();
  setupRecognizer(onText, onFinal);
  try {
    recognizer.start();
    listening = true;
    status(t('voice.listening'));
  } catch {
    status(t('voice.couldNotStart'));
  }
  updateMic();
}

function speak(text, then) {
  if (!('speechSynthesis' in window)) { then?.(); return; }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = SPEECH_LANG;
  utterance.onend = () => then?.();
  utterance.onerror = () => then?.();
  window.speechSynthesis.speak(utterance);
}

function status(text) {
  if (els.status) els.status.textContent = text;
}

function updateMic() {
  if (!els.mic) return;
  els.mic.setAttribute('aria-pressed', String(listening));
  els.micLabel.textContent = listening ? t('voice.stopListening') : phase === 'priority' ? t('voice.sayPriority') : t('voice.speakAnswer');
}

function persist() {
  if (!saveState(state)) status(t('voice.storageWarning'));
}

function progress() {
  const answered = STEPS.filter((s) => state.answers[s.id] && (!needsPriority(s, state.answers[s.id].value) || state.answers[s.id].priority)).length;
  els.progress.style.width = `${Math.round((answered / STEPS.length) * 100)}%`;
  els.bar.setAttribute('aria-valuenow', String(answered));
  els.progressText.textContent = cursor < STEPS.length ? t('chat.question', { n: cursor + 1, total: STEPS.length }) : t('chat.allAnswered', { total: STEPS.length });
}

function render(speakQuestion) {
  progress();
  renderLog();
  if (cursor >= STEPS.length) {
    els.mic = null;
    els.panel.replaceChildren(h('div', { class: 'interview__done' },
      h('h2', {}, t('chat.doneTitle')),
      h('p', {}, t('voice.doneText')),
      h('p', {}, h('a', { class: 'btn btn--primary', href: link('start/wishlist') }, t('chat.reviewBrief')))));
    speak(t('voice.doneSpoken'));
    return;
  }
  const step = STEPS[cursor];
  const prompt = phase === 'priority' ? t('voice.priorityPrompt') : step.question;
  els.status = h('p', { class: 'voice__status', role: 'status' });
  els.micLabel = h('span');
  els.mic = h('button', { class: 'btn mic', type: 'button', 'aria-pressed': 'false' }, h('span', { class: 'mic__dot', 'aria-hidden': 'true' }), els.micLabel);
  const repeat = h('button', { class: 'btn btn--quiet', type: 'button', onClick: () => speak(prompt) }, t('voice.readAgain'));

  if (phase === 'priority') {
    els.mic.addEventListener('click', () => listen(() => {}, (text) => {
      const p = interpretPriority(text);
      if (p) choosePriority(p);
      else status(t('voice.heardPriority', { text }));
    }));
    els.panel.replaceChildren(
      h('p', { class: 'voice__understood' }, t('voice.yourAnswer'), h('strong', {}, answerLabel(step, pending))),
      h('div', { class: 'voice__controls' }, els.mic, repeat), els.status,
      priorityControls(step, state.answers[step.id]?.priority, choosePriority, () => { phase = 'value'; render(false); }));
  } else {
    const textId = `voice-text-${step.id}`;
    const area = h('textarea', { id: textId, rows: '2', placeholder: t('voice.placeholder') });
    const options = h('div', { hidden: true }, valueControls(step, state.answers[step.id]?.value, chooseValue));
    const useText = () => {
      const value = interpretSpoken(step, area.value);
      if (value == null || (Array.isArray(value) && !value.length)) {
        status(t('voice.couldNotMatch', { text: area.value.trim() || t('voice.that') }));
        return;
      }
      chooseValue(value, area.value.trim());
    };
    els.mic.addEventListener('click', () => listen((text) => { area.value = text; }, () => useText()));
    els.panel.replaceChildren(
      h('p', { class: 'voice__question', id: `vq-${step.id}` }, step.question),
      step.help ? h('p', { class: 'reply__help' }, step.help) : '',
      h('div', { class: 'voice__controls' }, els.mic, repeat), els.status,
      h('div', { class: 'field' }, h('label', { for: textId }, t('voice.whatWeHeard')), area),
      h('div', { class: 'reply__actions' },
        h('button', { class: 'btn btn--primary', type: 'button', onClick: useText }, t('voice.useAnswer')),
        h('button', { class: 'btn btn--quiet', type: 'button', 'aria-expanded': 'false', onClick: (e) => {
          options.hidden = !options.hidden;
          e.currentTarget.setAttribute('aria-expanded', String(!options.hidden));
          if (!options.hidden) options.querySelector('.chip, textarea')?.focus();
        } }, t('voice.chooseOptions'))),
      options);
  }
  updateMic();
  els.panel.focus({ preventScroll: true });
  if (speakQuestion) speak(prompt, () => { if (!listening && els.mic) els.mic.click(); });
}

function renderLog() {
  const items = [];
  for (const [i, step] of STEPS.entries()) {
    const a = state.answers[step.id];
    if (!a || i === cursor) continue;
    const id = `log-${step.id}`;
    const area = h('textarea', { id, rows: '2' });
    area.value = a.raw || answerLabel(step, a.value);
    const note = h('p', { class: 'reply__error', role: 'status' });
    items.push(h('li', {},
      h('p', { class: 'voice-log__q' }, step.question),
      h('label', { for: id, class: 'visually-hidden' }, t('voice.transcriptFor', { q: step.question })), area,
      h('div', { class: 'msg__meta' },
        h('span', {}, t('voice.answer', { a: answerLabel(step, a.value) })),
        a.priority ? priorityMark(a.priority) : null,
        h('button', { class: 'msg__edit', type: 'button', onClick: () => {
          const value = interpretSpoken(step, area.value);
          if (value == null) { note.textContent = t('voice.noMatchCorrected'); return; }
          state.answers[step.id] = { ...a, value, raw: area.value.trim() };
          persist();
          render(false);
        } }, t('voice.updateFromText')),
        h('button', { class: 'msg__edit', type: 'button', onClick: () => { cursor = i; phase = 'value'; render(true); } }, t('voice.answerAgain'))),
      note));
  }
  els.log.replaceChildren(...items);
}

function chooseValue(value, raw) {
  const step = STEPS[cursor];
  if (needsPriority(step, value)) {
    pending = value;
    pendingRaw = raw || null;
    phase = 'priority';
    render(true);
    return;
  }
  state.answers[step.id] = { value, priority: null, raw };
  next();
}

function choosePriority(priority) {
  const step = STEPS[cursor];
  state.answers[step.id] = { value: pending, priority, raw: pendingRaw || state.answers[step.id]?.raw };
  pending = null;
  pendingRaw = null;
  next();
}

function next() {
  persist();
  phase = 'value';
  cursor = firstUnanswered(state);
  render(true);
}
