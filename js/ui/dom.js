import { LOCALE } from '../core/i18n.js';

// Small element builder: h('p', { class: 'x', onClick }, 'text', child).
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'html') el.innerHTML = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in el && typeof value !== 'string') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function formatDate(iso, options = { dateStyle: 'medium' }) {
  if (!iso) return '';
  return new Intl.DateTimeFormat(LOCALE, options).format(new Date(iso));
}

export function errorBox(title, message, action) {
  return h('div', { class: 'error-state', role: 'alert' }, h('h2', { text: title }), h('p', { text: message }), action || null);
}
