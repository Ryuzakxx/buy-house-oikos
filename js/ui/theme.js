// Light/dark switch. The choice is stored on this device; without one, the theme follows the operating system.
import { write } from '../api/storage.js';

export function initTheme() {
  const root = document.documentElement;
  const buttons = [...document.querySelectorAll('[data-theme-toggle]')];
  const system = matchMedia('(prefers-color-scheme: dark)');
  const active = () => root.dataset.theme || (system.matches ? 'dark' : 'light');

  const sync = () => {
    const theme = active();
    for (const b of buttons) b.setAttribute('aria-pressed', String(theme === 'dark'));
    // Browser chrome colour follows the page, not only the system setting.
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
  system.addEventListener('change', sync);
  sync();
}
