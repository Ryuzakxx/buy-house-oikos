// Mobile menu, language menu and the ?country= hand-off between start pages.
export function initNav() {
  const header = document.querySelector('.site-header');
  const toggle = header?.querySelector('.menu-toggle');
  const nav = document.getElementById('site-nav');
  if (toggle && nav) {
    const setOpen = (open) => {
      toggle.setAttribute('aria-expanded', String(open));
      nav.classList.toggle('is-open', open);
      header.classList.toggle('is-menu-open', open);
    };
    toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
        setOpen(false);
        toggle.focus();
      }
    });
    matchMedia('(min-width: 72em)').addEventListener('change', (e) => e.matches && setOpen(false));
  }

  for (const menu of document.querySelectorAll('details.lang')) {
    document.addEventListener('click', (e) => {
      if (menu.open && !menu.contains(e.target)) menu.open = false;
    });
    menu.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menu.open) {
        menu.open = false;
        menu.querySelector('summary').focus();
      }
    });
  }

  const country = new URLSearchParams(location.search).get('country');
  if (country && /^[A-Z]{2}$/.test(country)) {
    for (const link of document.querySelectorAll('a[data-keep-query]')) {
      const url = new URL(link.href);
      url.searchParams.set('country', country);
      link.href = url.pathname + url.search;
    }
  }
}
