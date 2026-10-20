// Lead source: campaign parameters, ad click ids, referrer and landing page of the first visit.
// Read on every page view, kept in memory, and written to storage only for the categories consented to.
import { read, write } from '../api/storage.js';
import { hasConsent } from './consent.js';

const KEY = 'lead.v1';
const UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
const AD_IDS = ['gclid', 'fbclid'];
let landing = null;

function readLanding() {
  const params = new URLSearchParams(location.search);
  let referrer = '';
  try {
    if (document.referrer && new URL(document.referrer).host !== location.host) referrer = document.referrer;
  } catch { /* malformed referrer */ }
  const pick = (keys) => Object.fromEntries(keys.filter((k) => params.get(k)).map((k) => [k, params.get(k).slice(0, 200)]));
  return {
    utm: pick(UTM),
    ads: pick(AD_IDS),
    referrer,
    landingPage: location.pathname,
    at: new Date().toISOString(),
    buyerCountry: document.body.dataset.buyerCountry || params.get('country') || null,
  };
}

function persist() {
  const analytics = hasConsent('analytics');
  const marketing = hasConsent('marketing');
  const stored = read(KEY) || {};
  const next = { ...stored };
  if (analytics) {
    if (!next.firstTouch) next.firstTouch = { utm: landing.utm, referrer: landing.referrer, landingPage: landing.landingPage, at: landing.at };
    if (!next.buyerCountry && landing.buyerCountry) next.buyerCountry = landing.buyerCountry;
  } else {
    delete next.firstTouch;
    delete next.buyerCountry;
  }
  if (marketing) {
    if (!next.adClick && Object.keys(landing.ads).length) next.adClick = { ...landing.ads, at: landing.at };
  } else {
    delete next.adClick;
  }
  if (Object.keys(next).length || Object.keys(stored).length) write(KEY, next);
}

export function captureLeadSource() {
  landing = readLanding();
  persist();
  document.addEventListener('bhi:consent', persist);
}

// Attached to every form submission and to the interview when it starts.
export function getLeadSource() {
  const stored = read(KEY) || {};
  const params = new URLSearchParams(location.search);
  return {
    consent: { analytics: hasConsent('analytics'), marketing: hasConsent('marketing') },
    firstTouch: stored.firstTouch || null,
    adClick: stored.adClick || null,
    // A country passed in the link the visitor clicked is part of their request, not tracking.
    buyerCountry: stored.buyerCountry || params.get('country') || document.body.dataset.buyerCountry || null,
    submittedFrom: location.pathname,
  };
}

export function describeLeadSource(ls) {
  if (!ls) return 'Unknown';
  const utm = ls.firstTouch?.utm || {};
  if (utm.utm_source) return [utm.utm_source, utm.utm_medium, utm.utm_campaign].filter(Boolean).join(' / ');
  if (ls.adClick?.gclid) return 'Google Ads click';
  if (ls.adClick?.fbclid) return 'Meta ad click';
  if (ls.firstTouch?.referrer) {
    try { return `Referral: ${new URL(ls.firstTouch.referrer).host}`; } catch { return 'Referral'; }
  }
  if (ls.firstTouch) return 'Direct visit';
  return ls.consent?.analytics === false ? 'Not recorded (no consent)' : 'Unknown';
}
