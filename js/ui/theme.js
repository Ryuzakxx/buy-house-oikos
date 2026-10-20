// Light/dark switch. The site opens light; dark only once chosen here, and the choice is stored on this device.
import { write } from '../api/storage.js';

export function initTheme() {
  const root = document.documentElement;
  const buttons = [...document.querySelectorAll('[data-theme-toggle]')];
  const active = () => root.dataset.theme || 'light';

  const sync = () => {
    const theme = active();
    for (const b of buttons) b.setAttribute('aria-pressed', String(theme === 'dark'));
    // Browser chrome colour follows the page.
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.content = meta.dataset[theme] || meta.content;
  };
  for (const b of buttons) {
    b.addEventListener('click', () => {
      const next = active() === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      write('theme', next);
      sync();
    });
  }
  sync();
}
