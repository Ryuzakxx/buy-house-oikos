// Entry point on every page: shared behaviour, then the page's own module named by <body data-page>.
import { initNav } from './ui/nav.js';
import { initConsent } from './ui/consent.js';
import { captureLeadSource } from './ui/lead-source.js';
import { initTheme } from './ui/theme.js';
import { t } from './core/i18n.js';

initTheme();
initNav();
initConsent();
captureLeadSource();

const PAGES = {
  start: () => import('./pages/start.js'),
  chat: () => import('./pages/chat.js'),
  voice: () => import('./pages/voice.js'),
  wishlist: () => import('./pages/wishlist.js'),
  webcall: () => import('./pages/webcall.js'),
  'webcall-confirmed': () => import('./pages/webcall-confirmed.js'),
  contact: () => import('./pages/contact.js'),
  partner: () => import('./pages/partner.js'),
  'italy-map': () => import('./pages/italy-map.js'),
  'internal-buyers': () => import('./pages/internal-buyers.js'),
  'internal-buyer': () => import('./pages/internal-buyer.js'),
  'internal-partners': () => import('./pages/internal-partners.js'),
};

const page = document.body.dataset.page;
if (PAGES[page]) {
  PAGES[page]()
    .then((module) => module.init())
    .catch((error) => {
      console.error(error);
      const target = document.querySelector('.interview__loading') || document.querySelector('main');
      const note = document.createElement('p');
      note.className = 'error-state';
      note.setAttribute('role', 'alert');
      note.textContent = t('pageError');
      if (target?.classList.contains('interview__loading')) target.replaceWith(note);
      else target?.prepend(note);
    });
}
