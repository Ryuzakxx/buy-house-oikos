// Shared pieces of the consultant area (demo).
import { resetDemo } from '../api/crm.js';
import { resetPartners } from '../api/partners.js';
import { describeCriterion } from '../core/wishlist.js';
import { h } from '../ui/dom.js';

export const STATUS_LABELS = {
  new: 'New', 'brief-confirmed': 'Brief confirmed', searching: 'Searching', 'shortlist-sent': 'Shortlist sent',
  visiting: 'Visiting', offer: 'Offer made', bought: 'Bought', paused: 'Paused',
};
export const SOURCE_LABELS = { chat: 'Guided chat', voice: 'Voice interview', webcall: 'Video call booking', contact: 'Contact form', consultant: 'Added by consultant' };

export function initResetButtons(after) {
  for (const button of document.querySelectorAll('[data-reset-demo]')) {
    button.addEventListener('click', async () => {
      if (!confirm('Reset the demo? Buyers, sales and partner requests stored in this browser go back to the sample data.')) return;
      button.disabled = true;
      try {
        await Promise.all([resetDemo(), resetPartners()]);
        await after();
      } finally {
        button.disabled = false;
      }
    });
  }
}

export function consentFlags(consents = {}) {
  const labels = { processing: 'Data', recording: 'Recording', marketing: 'Marketing' };
  return h('span', { class: 'consent-flags' }, ...Object.entries(labels).filter(([k]) => consents[k]).map(([k, label]) => {
    const yes = consents[k].granted;
    return h('span', { class: `flag ${yes ? 'flag--yes' : 'flag--no'}`, title: `${label}: ${yes ? 'granted' : 'not granted'}` }, label, h('span', { class: 'visually-hidden' }, yes ? ' granted' : ' not granted'));
  }));
}

export function briefSummary(w) {
  const must = (w?.mustHave || []).map(describeCriterion);
  if (!must.length) return (w?.niceToHave || []).length ? 'Only nice to haves so far' : 'No brief yet';
  return must.slice(0, 3).join('; ') + (must.length > 3 ? ` (+${must.length - 3})` : '');
}

export function loading(text) {
  return h('p', { class: 'interview__loading', role: 'status' }, text);
}
