// Strings for the interactive pages, picked by the page language (<html lang>); English fills any gap.
import en from '../i18n/en.js';
import { withBase } from './base.js';

// Only the page's own dictionary is downloaded. If it cannot load, the page carries on in English.
const LOADERS = {
  it: () => import('../i18n/it.js'),
  de: () => import('../i18n/de.js'),
  fr: () => import('../i18n/fr.js'),
  nl: () => import('../i18n/nl.js'),
  es: () => import('../i18n/es.js'),
};
const DICTIONARIES = { en };
const pageLang = globalThis.document?.documentElement?.lang;
if (LOADERS[pageLang]) {
  try {
    DICTIONARIES[pageLang] = (await LOADERS[pageLang]()).default;
  } catch {
    // English strings stay in place.
  }
}
export const LANG = DICTIONARIES[pageLang] ? pageLang : 'en';
const REGIONAL = { en: 'en-GB', it: 'it-IT', de: 'de-DE', fr: 'fr-FR', nl: 'nl-NL', es: 'es-ES' };
export const LOCALE = REGIONAL[LANG];
export const SPEECH_LANG = REGIONAL[LANG];

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
