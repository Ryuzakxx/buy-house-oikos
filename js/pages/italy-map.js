// Where to buy: the map of Italy's regions. Pointing at a region shows its name; a click on the map or on a name in
// the index shows that region's panel and puts it in the address (#tuscany), so a region can be linked to.
// Every panel is already in the page (italy_map in tools/build.py): this module only chooses which one is visible.
import { h, $, $$ } from '../ui/dom.js';

export function init() {
  const root = $('[data-italy]');
  if (!root) return;
  const map = $('.italy__map', root);
  const svg = $('svg', map);
  const tip = $('.italy__tip', map);
  const shapes = new Map($$('.italy__region', svg).map((el) => [el.dataset.region, el]));
  const panels = new Map($$('.region-info', root).map((el) => [el.dataset.region, el]));
  const names = $$('.italy__index a', root);
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let tipFor = null;

  // x, y in pixels from the top left corner of the map box.
  function showTip(key, x, y) {
    if (tipFor !== key) {
      tip.replaceChildren($('h3', panels.get(key)).textContent);
      if (shapes.get(key).classList.contains('has-guide')) tip.append(h('small', { text: root.dataset.guideLabel }));
      tipFor = key;
    }
    tip.hidden = false;
    // Above the point and inside the map; below the point when there is no room above.
    const gap = 12;
    const left = Math.min(Math.max(x - tip.offsetWidth / 2, 0), map.clientWidth - tip.offsetWidth);
    const top = y - tip.offsetHeight - gap < 0 ? y + gap : y - tip.offsetHeight - gap;
    tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  function hideTip() {
    tip.hidden = true;
    tipFor = null;
  }

  // The point inside the region chosen by tools/map.py, in the same pixels as showTip.
  function labelPoint(key) {
    const shape = shapes.get(key);
    const point = new DOMPoint(Number(shape.dataset.x), Number(shape.dataset.y)).matrixTransform(svg.getScreenCTM());
    const box = map.getBoundingClientRect();
    return [point.x - box.left, point.y - box.top];
  }

  function light(key) {
    for (const [k, shape] of shapes) shape.classList.toggle('is-lit', k === key);
  }

  function unlight() {
    light(null);
    hideTip();
  }

  function select(key, { focus = false } = {}) {
    const panel = panels.get(key);
    if (!panel) return;
    for (const [k, shape] of shapes) shape.classList.toggle('is-current', k === key);
    // Drawn last, so the neighbours do not cover its outline.
    const shape = shapes.get(key);
    shape.parentNode.append(shape);
    for (const el of panels.values()) el.classList.toggle('is-current', el === panel);
    for (const a of names) {
      if (a.dataset.region === key) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    }
    history.replaceState(null, '', `#${panel.id}`);
    if (focus) $('h3', panel).focus({ preventScroll: true });
    // On a phone the panel can be below the screen, or above it when the name was picked further down the index.
    const { top } = panel.getBoundingClientRect();
    const header = document.querySelector('.site-header')?.getBoundingClientRect().bottom ?? 0;
    if (top < Math.max(header, 0) || top > innerHeight - 96) {
      panel.scrollIntoView({ block: 'start', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    }
  }

  // Mouse and pen only: on a touch screen the tap selects the region straight away.
  svg.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return;
    const shape = event.target.closest('.italy__region');
    if (!shape) return unlight();
    const box = map.getBoundingClientRect();
    light(shape.dataset.region);
    showTip(shape.dataset.region, event.clientX - box.left, event.clientY - box.top);
  });
  svg.addEventListener('pointerleave', unlight);

  for (const a of names) {
    const on = () => {
      light(a.dataset.region);
      showTip(a.dataset.region, ...labelPoint(a.dataset.region));
    };
    a.addEventListener('mouseenter', on);
    a.addEventListener('focus', on);
    a.addEventListener('mouseleave', unlight);
    a.addEventListener('blur', unlight);
  }

  root.addEventListener('click', (event) => {
    const link = event.target.closest('a[data-region]');
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    // A name in the index moves the focus to the panel it opens; a click on the map leaves it where it is.
    select(link.dataset.region, { focus: !svg.contains(link) });
  });

  const fromAddress = () => {
    const panel = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (panel && panels.get(panel.dataset.region) === panel) select(panel.dataset.region);
  };
  addEventListener('hashchange', fromAddress);
  fromAddress();
  root.classList.add('is-ready');
}
