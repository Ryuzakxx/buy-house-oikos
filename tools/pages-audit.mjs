// Visits every built page in Chrome at phone and desktop widths and reports console errors,
// failed requests and horizontal overflow; saves screenshots of the pages listed on the command line.
// Dev tool. Needs puppeteer-core installed elsewhere: TOOLS_DIR=<folder with node_modules> CHROME=<binary>.
import { createRequire } from 'node:module';
import { readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const require = createRequire(`${process.env.TOOLS_DIR}/`);
const puppeteer = require('puppeteer-core');
const ROOT = new URL('..', import.meta.url).pathname;
const BASE = process.env.BASE || 'http://127.0.0.1:8765';
const SHOTS = process.env.SHOTS || '/tmp/shots';
const shoot = new Set(process.argv.slice(2));
mkdirSync(SHOTS, { recursive: true });

function pages(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return pages(p);
    return name === 'index.html' ? [`/${relative(ROOT, dir)}/`] : [];
  });
}
const urls = ['en', 'it', 'de', 'fr', 'nl', 'es', 'internal'].flatMap((d) => { try { return pages(join(ROOT, d)); } catch { return []; } });
urls.push('/404.html', '/');

const browser = await puppeteer.launch({ executablePath: process.env.CHROME, headless: true, args: ['--no-sandbox'] });
let problems = 0;
for (const width of (process.env.WIDTHS || '390,1280').split(',').map(Number)) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: 900 });
  for (const url of urls) {
    const issues = [];
    const onConsole = (m) => { if (['error', 'warn'].includes(m.type())) issues.push(`console ${m.type()}: ${m.text()}`); };
    const onFail = (r) => issues.push(`request failed: ${r.url()}`);
    const onResponse = (r) => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) issues.push(`HTTP ${r.status()}: ${r.url()}`); };
    page.on('console', onConsole); page.on('requestfailed', onFail); page.on('response', onResponse);
    await page.goto(BASE + url, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 300));
    const overflow = await page.evaluate(() => {
      const w = document.documentElement.clientWidth;
      const wide = [...document.querySelectorAll('body *')].filter((el) => {
        const r = el.getBoundingClientRect();
        if (!r.width || getComputedStyle(el).position === 'fixed') return false;
        let p = el.parentElement;
        while (p) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return false; p = p.parentElement; }
        return r.right > w + 1;
      }).slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${el.className}`);
      return { scroll: document.documentElement.scrollWidth > w + 1, wide };
    });
    if (overflow.scroll) issues.push(`horizontal overflow: ${overflow.wide.join(', ')}`);
    page.off('console', onConsole); page.off('requestfailed', onFail); page.off('response', onResponse);
    if (issues.length) { problems += issues.length; console.log(`${width} ${url}\n  ${issues.join('\n  ')}`); }
    if (shoot.has(url)) await page.screenshot({ path: `${SHOTS}/${width}${url.replace(/\//g, '_')}.png`, fullPage: true });
  }
  await page.close();
}
await browser.close();
console.log(`${urls.length} pages x ${(process.env.WIDTHS || "390,1280").split(",").length} widths checked, ${problems} problems`);
