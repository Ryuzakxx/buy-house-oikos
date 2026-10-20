// Answer controls for one interview step, shared by the chat and the voice interview.
import { h } from './dom.js';
import { PRIORITIES, MARK_CLASS, formatEuro } from '../core/wishlist.js';
import { t } from '../core/i18n.js';

let seq = 0;

// onSubmit(value) is called with a single value, an array (multi) or a string (text).
// With hidePrompt the question stays available to screen readers but is shown elsewhere (the chat bubble).
export function valueControls(step, current, onSubmit, { hidePrompt = false } = {}) {
  const id = `q-${step.id}-${++seq}`;
  const error = h('p', { class: 'reply__error', role: 'alert' });
  const wrap = h('div', { class: 'reply__body' });
  const prompt = h('p', { class: hidePrompt ? 'visually-hidden' : 'reply__prompt', id: `${id}-prompt` }, step.question);
  const help = step.help ? h('p', { class: hidePrompt ? 'visually-hidden' : 'reply__help', id: `${id}-help` }, step.help) : null;

  if (step.input === 'text') {
    const area = h('textarea', { id: `${id}-text`, placeholder: step.placeholder || '', 'aria-labelledby': `${id}-prompt`, 'aria-describedby': help ? `${id}-help` : null });
    area.value = typeof current === 'string' ? current : '';
    const actions = h('div', { class: 'reply__actions' },
      h('button', { class: 'btn btn--primary', type: 'button', onClick: () => onSubmit(area.value.trim()) }, t('controls.continue')),
      step.optional ? h('button', { class: 'btn btn--quiet', type: 'button', onClick: () => onSubmit('') }, t('controls.skip')) : null);
    wrap.append(prompt, help || '', area, actions);
    return wrap;
  }

  const selected = new Set((Array.isArray(current) ? current : current != null ? [current] : []).map(String));
  const group = h('div', { class: 'chips', role: 'group', 'aria-labelledby': `${id}-prompt`, 'aria-describedby': help ? `${id}-help` : null });

  const chip = (value, label) => {
    const button = h('button', { class: 'chip', type: 'button', 'aria-pressed': String(selected.has(String(value))), dataset: { value: String(value) } }, label);
    button.addEventListener('click', () => {
      error.textContent = '';
      if (step.input === 'single') {
        onSubmit(value);
        return;
      }
      const option = step.options.find((o) => String(o.value) === String(value));
      const on = button.getAttribute('aria-pressed') !== 'true';
      if (on && option?.exclusive) {
        selected.clear();
        for (const other of group.querySelectorAll('.chip')) other.setAttribute('aria-pressed', 'false');
      } else if (on) {
        for (const ex of step.options.filter((o) => o.exclusive)) {
          selected.delete(String(ex.value));
          group.querySelector(`[data-value="${CSS.escape(String(ex.value))}"]`)?.setAttribute('aria-pressed', 'false');
        }
      }
      if (on) selected.add(String(value));
      else selected.delete(String(value));
      button.setAttribute('aria-pressed', String(on));
    });
    return button;
  };

  for (const option of step.options) group.append(chip(option.value, option.label));
  for (const value of selected) {
    if (value.startsWith('other:')) group.append(chip(value, value.slice(6)));
  }
  wrap.append(prompt, help || '', group);

  if (step.other) {
    const input = h('input', { type: 'text', id: `${id}-other`, placeholder: step.other.placeholder, autocomplete: 'off' });
    const add = () => {
      const text = input.value.trim();
      if (!text) return;
      const value = `other:${text}`;
      selected.add(value);
      const button = chip(value, text);
      button.setAttribute('aria-pressed', 'true');
      group.append(button);
      input.value = '';
      input.focus();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    wrap.append(h('div', { class: 'reply__free' },
      h('label', { for: `${id}-other` }, step.other.label),
      h('div', { class: 'reply__free-row' }, input, h('button', { class: 'btn', type: 'button', onClick: add }, t('controls.add')))));
  }

  if (step.custom) {
    const input = h('input', { type: 'number', id: `${id}-custom`, min: step.custom.min, step: step.custom.step, inputmode: 'numeric' });
    if (current != null && !step.options.some((o) => String(o.value) === String(current))) input.value = current;
    const use = () => {
      const n = Number(input.value);
      if (!input.value || Number.isNaN(n) || n < step.custom.min) {
        error.textContent = t('controls.amountError', { min: formatEuro(step.custom.min) });
        input.focus();
        return;
      }
      onSubmit(Math.round(n));
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); use(); } });
    wrap.append(h('div', { class: 'reply__free' },
      h('label', { for: `${id}-custom` }, step.custom.label),
      h('div', { class: 'reply__free-row' }, input, h('button', { class: 'btn', type: 'button', onClick: use }, t('controls.useAmount')))));
  }

  if (step.input === 'multi') {
    wrap.append(h('div', { class: 'reply__actions' },
      h('button', {
        class: 'btn btn--primary', type: 'button',
        onClick: () => {
          if (!selected.size) {
            error.textContent = t('controls.pickOne');
            group.querySelector('.chip')?.focus();
            return;
          }
          const values = [...selected].map((v) => step.options.find((o) => String(o.value) === v)?.value ?? v);
          onSubmit(values);
        },
      }, t('controls.continue'))));
  }
  wrap.append(error);
  return wrap;
}

export function priorityControls(step, current, onChoose, onBack) {
  const legendId = `prio-${step.id}-${++seq}`;
  const fieldset = h('fieldset', { class: 'priority', 'aria-labelledby': legendId });
  fieldset.append(h('legend', { id: legendId, class: 'reply__prompt' }, t('controls.howImportant')));
  for (const p of PRIORITIES) {
    fieldset.append(h('button', {
      class: 'prio', type: 'button', 'aria-pressed': String(current === p.id), dataset: { priority: p.id },
      onClick: () => onChoose(p.id),
    }, h('span', { class: `mark ${MARK_CLASS[p.id]}` }, p.label), h('small', {}, p.note)));
  }
  const wrap = h('div', { class: 'reply__body' }, fieldset);
  if (onBack) wrap.append(h('button', { class: 'btn btn--quiet priority__skip', type: 'button', onClick: onBack }, t('controls.changeAnswer')));
  return wrap;
}

export function priorityMark(priority) {
  const p = PRIORITIES.find((x) => x.id === priority);
  return p ? h('span', { class: `mark ${MARK_CLASS[p.id]}` }, p.label) : null;
}
