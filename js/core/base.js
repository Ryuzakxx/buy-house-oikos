// Folder the site is served from: "" on a domain root, "/buy-house-oikos" on a GitHub Pages project page.
// Worked out from where this module was loaded (<base>/js/core/base.js), so it needs no build setting.
export const BASE = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');

// Turns a root-absolute site path ("/data/x.json") into one that works under BASE.
export const withBase = (path) => BASE + path;
