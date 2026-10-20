// Consent banner. No tracking runs until a choice is stored; the choice expires after six months.
import { read, write } from '../api/storage.js';

const KEY = 'consent.v1';
const VERSION = 1;
const MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

export function getConsent() {
  const c = read(KEY);
  if (!c || c.version !== VERSION || Date.now() - Date.parse(c.at) > MAX_AGE_MS) return null;
  return c;
}

export const hasConsent = (category) => Boolean(getConsent()?.[category]);

// Third-party tags ship inert as <script type="text/plain" data-consent="analytics|marketing" data-src="...">
// and become real scripts only after the matching consent. This version of the site has none.
function activateTags(consent) {
  for (const tag of document.querySelectorAll('script[type="text/plain"][data-consent]')) {
    if (!consent[tag.dataset.consent]) continue;
    const script = document.createElement('script');
    if (tag.dataset.src) script.src = tag.dataset.src;
    else script.textContent = tag.textContent;
    tag.replaceWith(script);
  }
}

function save({ analytics = false, marketing = false }) {
  const consent = { version: VERSION, necessary: true, analytics, marketing, at: new Date().toISOString() };
  write(KEY, consent);
  activateTags(consent);
  document.dispatchEvent(new CustomEvent('bhi:consent', { detail: consent }));
  return consent;
}

export function initConsent() {
  const stored = getConsent();
  if (stored) activateTags(stored);
  const banner = document.getElementById('consent');
  if (!banner) return;

  const form = banner.querySelector('#consent-form');
  const choices = banner.querySelector('#consent-choices');
  const chooseBtn = banner.querySelector('[data-consent="choose"]');
  const saveBtn = banner.querySelector('[data-consent="save"]');
  const status = document.getElementById('consent-status');
  let opener = null;

  const showChoices = (show) => {
    choices.hidden = !show;
    saveBtn.hidden = !show;
    chooseBtn.hidden = show;
    chooseBtn.setAttribute('aria-expanded', String(show));
  };
  const open = (withChoices, from) => {
    const current = getConsent();
    form.elements.analytics.checked = Boolean(current?.analytics);
    form.elements.marketing.checked = Boolean(current?.marketing);
    showChoices(withChoices);
    banner.hidden = false;
    opener = from || null;
    if (from) (withChoices ? form.elements.analytics : banner.querySelector('[data-consent="reject"]')).focus();
  };
  const close = () => {
    banner.hidden = true;
    if (status) status.textContent = banner.dataset.saved || '';
    if (opener) opener.focus();
    opener = null;
  };

  banner.addEventListener('click', (e) => {
    const action = e.target.closest('[data-consent]')?.dataset.consent;
    if (action === 'accept') { save({ analytics: true, marketing: true }); close(); }
    if (action === 'reject') { save({}); close(); }
    if (action === 'choose') { showChoices(true); form.elements.analytics.focus(); }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    save({ analytics: form.elements.analytics.checked, marketing: form.elements.marketing.checked });
    close();
  });
  // Escape only closes the banner when reopened from cookie settings: a first visit needs an explicit choice.
  banner.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && getConsent()) close();
  });
  for (const button of document.querySelectorAll('[data-open-consent]')) {
    button.addEventListener('click', () => open(true, button));
  }
  if (!stored) open(false);
}
