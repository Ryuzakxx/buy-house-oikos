// Strings for the interactive pages, picked by the page language (<html lang>); English fills any gap.
import en from '../i18n/en.js';
import it from '../i18n/it.js';
import { withBase } from './base.js';

const DICTIONARIES = { en, it };
const pageLang = globalThis.document?.documentElement?.lang;
export const LANG = DICTIONARIES[pageLang] ? pageLang : 'en';
export const LOCALE = { en: 'en-GB', it: 'it-IT' }[LANG];
export const SPEECH_LANG = { en: 'en-GB', it: 'it-IT' }[LANG];

const lookup = (dict, key) => key.split('.').reduce((node, part) => (node == null ? undefined : node[part]), dict);

export function maybe(key) {
  const text = lookup(DICTIONARIES[LANG], key);
  return text === undefined ? lookup(en, key) : text;
}

export function t(key, vars) {
  const text = maybe(key);
  if (text === undefined) return key;
  return vars ? String(text).replace(/\{(\w+)\}/g, (m, name) => (name in vars ? vars[name] : m)) : text;
}

// Paths the scripts link to, written into each page by the build for that page's language.
let links = null;
export function link(id) {
  if (!links) {
    try {
      links = JSON.parse(globalThis.document?.getElementById('site-links')?.textContent || '{}');
    } catch {
      links = {};
    }
  }
  return links[id] || withBase(`/en/${id}/`);
}
