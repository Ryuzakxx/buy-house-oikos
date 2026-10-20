// End-to-end click-through of every interactive feature, in Chrome. Dev tool, see README "Testing".
// TOOLS_DIR=<folder with node_modules/puppeteer-core> CHROME=<chrome binary> node tools/e2e.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(`${process.env.TOOLS_DIR}/`);
const puppeteer = require('puppeteer-core');
const BASE = process.env.BASE || 'http://127.0.0.1:8765';
const browser = await puppeteer.launch({ executablePath: process.env.CHROME, headless: true, args: ['--no-sandbox'] });
const results = [];
const errors = [];

async function fresh(width = 1280) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width, height: 900 });
  // Reduced motion: no smooth scrolling or entry animations moving targets under automated clicks.
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${page.url()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`));
  page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'Phone lead (test)' : undefined));
  return page;
}
const step = async (name, fn) => {
  try { await fn(); results.push(`PASS ${name}`); } catch (e) { results.push(`FAIL ${name}: ${e.message}`); }
};
const go = (page, path) => page.goto(BASE + path, { waitUntil: 'networkidle0' });
const ls = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem(`bhi.${k}`) || 'null'), key);
const visible = (page, sel) => page.$eval(sel, (el) => !!(el.offsetWidth || el.offsetHeight) && getComputedStyle(el).visibility !== 'hidden').catch(() => false);
const clickText = async (page, sel, text) => {
  const handles = await page.$$(sel);
  for (const h of handles) {
    if ((await h.evaluate((el) => el.textContent.trim())) === text) { await h.click(); return; }
  }
  throw new Error(`no ${sel} with text "${text}"`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const acceptConsent = async (page) => { if (await visible(page, '#consent')) await page.click('[data-consent="accept"]'); };

// Consent banner
await step('Consent: banner shows on first visit, Choose reveals options, Save stores granular choice', async () => {
  const page = await fresh();
  await go(page, '/en/');
  assert.ok(await visible(page, '#consent'), 'banner visible');
  assert.equal(await visible(page, '[data-consent="save"]'), false, 'save hidden before Choose');
  await page.click('[data-consent="choose"]');
  assert.ok(await visible(page, '#consent-choices'));
  await page.click('input[name="analytics"]');
  await page.click('[data-consent="save"]');
  assert.equal(await visible(page, '#consent'), false, 'banner closed');
  const c = await ls(page, 'consent.v1');
  assert.equal(c.analytics, true); assert.equal(c.marketing, false);
  await page.click('[data-open-consent]');
  assert.ok(await visible(page, '#consent'), 'reopened from footer');
  assert.equal(await page.$eval('input[name="analytics"]', (e) => e.checked), true, 'previous choice shown');
  await page.keyboard.press('Escape');
  assert.equal(await visible(page, '#consent'), false, 'Escape closes when reopened');
  assert.equal(await page.evaluate(() => document.activeElement.hasAttribute('data-open-consent')), true, 'focus returns to the opener');
  await page.browserContext().close();
});

await step('Lead source: stored only after consent, UTM + gclid + buyer country from the Germany page', async () => {
  const page = await fresh();
  await go(page, '/en/buying-property-in-italy-from-germany/?utm_source=google&utm_medium=cpc&utm_campaign=de-test&gclid=TESTGCLID');
  assert.equal(await ls(page, 'lead.v1'), null, 'nothing stored before consent');
  await page.click('[data-consent="accept"]');
  const lead = await ls(page, 'lead.v1');
  assert.equal(lead.firstTouch.utm.utm_source, 'google');
  assert.equal(lead.adClick.gclid, 'TESTGCLID');
  assert.equal(lead.buyerCountry, 'DE');
  assert.equal(lead.firstTouch.landingPage, '/en/buying-property-in-italy-from-germany/');
  await page.browserContext().close();
});

await step('Lead source: Reject all stores nothing; start links keep ?country=DE', async () => {
  const page = await fresh();
  await go(page, '/en/buying-property-in-italy-from-the-uk/?utm_source=newsletter&fbclid=X');
  await page.click('[data-consent="reject"]');
  assert.equal(await ls(page, 'lead.v1'), null);
  const href = await page.$eval('.cta-bar a', (a) => a.getAttribute('href'));
  assert.equal(href, '/en/start/?country=GB');
  await page.browserContext().close();
});

// Navigation
await step('Mobile menu: opens and closes, language switch inside, Escape closes', async () => {
  const page = await fresh(390);
  await go(page, '/en/');
  await page.click('[data-consent="reject"]');
  assert.equal(await visible(page, '#site-nav'), false);
  assert.equal(await visible(page, 'details.lang'), false, 'language hidden in the closed menu');
  await page.click('.menu-toggle');
  assert.equal(await page.$eval('.menu-toggle', (b) => b.getAttribute('aria-expanded')), 'true');
  assert.ok(await visible(page, '#site-nav'));
  assert.ok(await visible(page, 'details.lang'), 'language visible in the open menu');
  await page.keyboard.press('Escape');
  assert.equal(await visible(page, '#site-nav'), false);
  await page.browserContext().close();
});

await step('Language menu: opens, lists 6 languages, non-translated pages point to the home page', async () => {
  const page = await fresh();
  await go(page, '/en/services/notary/');
  await page.click('[data-consent="reject"]');
  await page.click('details.lang summary');
  const links = await page.$$eval('.lang__menu a', (as) => as.map((a) => [a.getAttribute('hreflang'), a.getAttribute('href')]));
  assert.equal(links.length, 6);
  assert.deepEqual(links.find(([l]) => l === 'de'), ['de', '/de/']);
  await page.mouse.click(5, 600);
  assert.equal(await page.$eval('details.lang', (d) => d.open), false, 'outside click closes');
  await page.browserContext().close();
});

await step('Theme switch: dark and light override the system and persist across pages and reloads', async () => {
  const page = await fresh();
  await go(page, '/en/');
  await page.click('[data-consent="reject"]');
  // Reduced motion still leaves a 0.01ms transition, so wait for the colour to settle instead of reading it at once.
  const bg = async (expected) => { if (expected) await page.waitForFunction((c) => getComputedStyle(document.body).backgroundColor === c, { timeout: 3000 }, expected).catch(() => {}); return page.evaluate(() => getComputedStyle(document.body).backgroundColor); };
  assert.equal(await bg(), 'rgb(255, 255, 255)', 'light by default on a light system');
  await page.click('.theme-toggle');
  assert.equal(await page.$eval('html', (h) => h.dataset.theme), 'dark');
  assert.equal(await page.$eval('.theme-toggle', (b) => b.getAttribute('aria-pressed')), 'true');
  assert.equal(await bg('rgb(21, 19, 15)'), 'rgb(21, 19, 15)');
  await go(page, '/it/come-funziona/');
  assert.equal(await bg('rgb(21, 19, 15)'), 'rgb(21, 19, 15)', 'choice kept on another page');
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.click('.theme-toggle');
  assert.equal(await page.$eval('html', (h) => h.dataset.theme), 'light');
  assert.equal(await bg('rgb(255, 255, 255)'), 'rgb(255, 255, 255)', 'light wins over a dark system');
  await page.reload({ waitUntil: 'networkidle0' });
  assert.equal(await bg('rgb(255, 255, 255)'), 'rgb(255, 255, 255)', 'still light after reload on a dark system');
  await page.browserContext().close();
});

await step('Theme switch on phones sits in the Menu panel', async () => {
  const page = await fresh(390);
  await go(page, '/en/');
  await page.click('[data-consent="reject"]');
  assert.equal(await visible(page, '.site-header .theme-toggle'), false);
  await page.click('.menu-toggle');
  assert.ok(await visible(page, '.site-header .theme-toggle'));
  await page.click('.site-header .theme-toggle');
  assert.equal(await page.$eval('html', (h) => h.dataset.theme), 'dark');
  await page.browserContext().close();
});

await step('Keyboard: skip link is the first Tab stop and moves to main; focus ring visible', async () => {
  const page = await fresh();
  await go(page, '/en/');
  await page.click('[data-consent="reject"]');
  await page.evaluate(() => { document.activeElement.blur(); window.scrollTo(0, 0); });
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.className), 'skip-link');
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  assert.equal(outline, 'solid');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => location.hash), '#main');
  await page.browserContext().close();
});

await step('FAQ accordion opens and closes', async () => {
  const page = await fresh();
  await go(page, '/en/buying-property-in-italy-from-the-uk/');
  await page.click('[data-consent="reject"]');
  await page.click('.faq details summary');
  assert.equal(await page.$eval('.faq details', (d) => d.open), true);
  await page.click('.faq details summary');
  assert.equal(await page.$eval('.faq details', (d) => d.open), false);
  await page.browserContext().close();
});

await step('Italian: header and footer links from /it/ stay in Italian, and pages they open are Italian', async () => {
  const page = await fresh();
  await go(page, '/it/');
  await page.click('[data-consent="reject"]');
  const hrefs = await page.$$eval('header a[href^="/"], footer a[href^="/"]', (as) => as.filter((a) => !a.closest('.lang')).map((a) => a.getAttribute('href')));
  const outside = hrefs.filter((h) => !h.startsWith('/it/'));
  assert.deepEqual(outside, [], `links leaving /it/: ${outside.join(', ')}`);
  for (const href of [...new Set(hrefs)]) {
    await go(page, href);
    assert.equal(await page.$eval('html', (h) => h.lang), 'it', `${href} is not Italian`);
  }
  await go(page, '/it/');
  await clickText(page, 'header nav a', 'Servizi');
  await page.waitForFunction(() => location.pathname === '/it/servizi/');
  await page.browserContext().close();
});

await step('Italian: chat asks in Italian, parses the answers and the brief shows Italian criteria', async () => {
  const page = await fresh();
  await go(page, '/it/inizia/chat/');
  await acceptConsent(page);
  const progress = () => page.$eval('#progress-text', (e) => e.textContent);
  assert.equal(await progress(), 'Domanda 1 di 18');
  assert.ok((await page.$eval('#reply', (r) => r.textContent)).includes('Toscana'));
  await clickText(page, '#reply .chip', 'Puglia');
  await clickText(page, '#reply .btn', 'Continua');
  await clickText(page, '#reply .prio .mark', 'Indispensabile');
  assert.equal(await progress(), 'Domanda 2 di 18');
  await clickText(page, '#reply .chip', 'Fino a 1 milione di €');
  await clickText(page, '#reply .prio .mark', 'Da escludere');
  await go(page, '/it/inizia/il-tuo-brief/');
  await page.waitForSelector('.brief-cols');
  const col = (id) => page.$eval(`#col-${id}`, (h) => h.closest('section').textContent);
  assert.ok((await col('must')).includes('In Puglia'), await col('must'));
  assert.ok((await col('dealbreaker')).includes('Fino a 1.000.000'), await col('dealbreaker'));
  await page.browserContext().close();
});

// Interview
const page = await fresh();
await go(page, '/en/start/chat/?country=US');
await acceptConsent(page);
const chip = (text) => clickText(page, '#reply .chip', text);
const prio = (label) => clickText(page, '#reply .prio .mark', label);
const cont = () => clickText(page, '#reply .btn', 'Continue');
const question = () => page.$eval('#progress-text', (e) => e.textContent);

await step('Chat: answers all 18 questions with priorities, multi-select, exclusive option, free text', async () => {
  await chip('Puglia'); await chip('Tuscany');
  await page.type('#reply input[type="text"]', 'Umbria'); await clickText(page, '#reply .btn', 'Add');
  await cont(); await prio('Must have');
  assert.equal(await question(), 'Question 2 of 18');
  await chip('Up to €1 million'); await prio('Deal breaker');
  await chip('Villa'); await chip('Any type');
  assert.equal(await page.$eval('#reply .chip[data-value="villa"]', (b) => b.getAttribute('aria-pressed')), 'false', 'exclusive option clears the others');
  await cont();
  await chip('3'); await prio('Nice to have');
  await chip("Doesn't matter");
  await chip('Ready to move in'); await chip('Needs a light refresh'); await cont(); await prio('Deal breaker');
  await chip('Only light work');
  await chip('Room to add one is enough'); await prio('Nice to have');
  await chip('Not important');
  await chip('Yes, a sea view'); await prio('Nice to have');
  await chip('Within 10 km'); await prio('Must have');
  await chip('Within 60 km'); await prio('Nice to have');
  await chip("Doesn't matter");
  await chip('Holiday home'); await cont();
  await chip('Within 3 months');
  await chip('No, buying with my own funds');
  await chip('Keeping my tax residence abroad'); await cont();
  await page.type('#reply textarea', 'No neighbours in sight.'); await cont();
  assert.equal(await question(), 'All 18 questions answered');
  assert.ok(await page.$eval('#reply', (r) => r.textContent.includes('Your brief is ready to review')));
});

await step('Chat: empty multi-select shows an error instead of continuing', async () => {
  await clickText(page, '.chat-log .msg__edit', 'Change');
  await page.$$eval('#reply .chip[aria-pressed="true"]', (bs) => bs.forEach((b) => b.click()));
  await cont();
  assert.ok((await page.$eval('#reply .reply__error', (e) => e.textContent)).includes('Choose at least one'));
  await chip('Puglia'); await cont(); await prio('Must have');
  assert.equal(await question(), 'All 18 questions answered');
});

await step('Chat: Back and Change edit an earlier answer and return to the end', async () => {
  await page.click('.interview__links .btn');
  assert.equal(await question(), 'Question 18 of 18');
  const edits = await page.$$('.chat-log .msg__edit');
  await edits[3].click();
  assert.equal(await question(), 'Question 4 of 18');
  await chip('4'); await prio('Must have');
  assert.equal(await question(), 'All 18 questions answered');
  const state = await ls(page, 'interview.v1');
  assert.deepEqual(state.answers.bedrooms, { value: 4, priority: 'must' });
  assert.equal(state.buyerCountry, 'US');
});

await step('Chat: answers survive a reload (autosave)', async () => {
  await page.reload({ waitUntil: 'networkidle0' });
  assert.equal(await question(), 'All 18 questions answered');
});

await step('Brief: three columns, move a criterion, remove one, match message shown', async () => {
  await go(page, '/en/start/wishlist/');
  await page.waitForSelector('.brief-cols');
  const col = (id) => page.$eval(`#col-${id}`, (h) => h.closest('section').textContent);
  assert.ok((await col('must')).includes('At least 4 bedrooms'));
  assert.ok((await col('dealbreaker')).includes('Up to €1,000,000'));
  await page.select('#move-price', 'nice');
  await page.waitForFunction(() => document.querySelector('#col-nice').closest('section').textContent.includes('Up to €1,000,000'));
  assert.equal(await page.evaluate(() => document.activeElement.id), 'move-price', 'focus stays on the moved criterion');
  await page.click('[aria-label="Remove: Sea view"]');
  await page.waitForFunction(() => !document.querySelector('.brief-cols').textContent.includes('Sea view'));
  await page.waitForFunction(() => !document.querySelector('.match-note').textContent.includes('Checking'));
  const note = await page.$eval('.match-note', (e) => e.textContent);
  assert.ok(/fit|Nothing in our database/.test(note), note);
});

await step('Brief: empty send shows field errors; valid send creates the buyer in the CRM', async () => {
  await page.click('#send-brief [type="submit"]');
  assert.ok((await page.$eval('#wl-name-error', (e) => e.textContent)).length > 0);
  assert.ok((await page.$eval('#wl-consent-error', (e) => e.textContent)).includes('tick this box'));
  assert.equal(await page.evaluate(() => document.activeElement.id), 'wl-name', 'focus on the first invalid field');
  await page.type('#wl-name', 'Test Buyer');
  await page.type('#wl-email', 'not-an-email');
  await page.type('#wl-country', 'United States');
  await page.click('input[name="consentProcessing"]');
  await page.click('#send-brief [type="submit"]');
  assert.ok((await page.$eval('#wl-email-error', (e) => e.textContent)).includes('email address'));
  await page.$eval('#wl-email', (e) => { e.value = ''; });
  await page.type('#wl-email', 'test.buyer@example.com');
  await page.click('#send-brief [type="submit"]');
  await page.waitForSelector('.form-status--ok');
  const crm = await ls(page, 'crm.v1');
  const buyer = crm.buyers.find((b) => b.contact.email === 'test.buyer@example.com');
  assert.ok(buyer, 'buyer stored');
  assert.equal(buyer.consents.processing.granted, true);
  assert.equal(buyer.consents.marketing.granted, false);
  assert.equal(buyer.leadSource.buyerCountry, 'US');
  assert.equal(buyer.wishlist.status, 'submitted');
  assert.ok(buyer.wishlist.mustHave.some((c) => c.key === 'region'));
});

await step('Start page offers to resume the interview', async () => {
  await go(page, '/en/start/');
  assert.ok(await visible(page, '#resume'));
});

// Voice
await step('Voice: typed transcript is interpreted, priority chosen, next question shown (or chat fallback)', async () => {
  const p = await fresh();
  await go(p, '/en/start/voice/');
  await acceptConsent(p);
  const supported = await p.evaluate(() => Boolean(window.SpeechRecognition || window.webkitSpeechRecognition));
  if (!supported) {
    assert.ok(await p.$eval('#interview', (e) => e.textContent.includes('Continue with the guided chat')));
  } else {
    await clickText(p, '#interview .btn', 'Start the voice interview');
    await p.waitForSelector('textarea[id^="voice-text-"]');
    await p.type('#voice-text-region', 'Sicily and Liguria');
    await clickText(p, '.voice .btn', 'Use this answer');
    await p.waitForSelector('.prio');
    assert.ok((await p.$eval('.voice__understood', (e) => e.textContent)).includes('Sicily, Liguria'));
    await clickText(p, '.prio .mark', 'Must have');
    await p.waitForSelector('#voice-text-budget');
    await p.type('#voice-text-budget', 'about eight hundred thousand');
    await clickText(p, '.voice .btn', 'Use this answer');
    assert.ok((await p.$eval('.voice__status', (e) => e.textContent)).includes("couldn't match"), 'unparseable answer is reported');
    await p.$eval('#voice-text-budget', (e) => { e.value = ''; });
    await p.type('#voice-text-budget', '800,000 euros');
    await clickText(p, '.voice .btn', 'Use this answer');
    await p.waitForSelector('.prio');
    await clickText(p, '.prio .mark', 'Deal breaker');
    const s = await ls(p, 'interview.v1');
    assert.deepEqual(s.answers.region.value, ['sicily', 'liguria']);
    assert.equal(s.answers.budget.value, 800000);
    assert.equal(s.answers.region.raw, 'Sicily and Liguria');
  }
  await p.browserContext().close();
});

// Booking
await step('Video call: weekend rejected, slots in the chosen time zone, booking confirmed with calendar file', async () => {
  const p = await fresh();
  await go(p, '/en/start/webcall/');
  await acceptConsent(p);
  const day = (offset) => { const d = new Date(Date.now() + offset * 864e5); return d.toISOString().slice(0, 10); };
  let saturday = 1; while (new Date(day(saturday)).getUTCDay() !== 6) saturday += 1;
  await p.$eval('#wc-date', (e, v) => { e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }, day(saturday));
  assert.ok((await p.$eval('#wc-date-error', (e) => e.textContent)).includes('weekday'));
  assert.equal(await p.$eval('#wc-time', (s) => s.disabled), true);
  await p.$eval('#wc-date', (e, v) => { e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }, day(saturday + 2));
  await p.select('#wc-tz', 'America/New_York');
  const labels = await p.$$eval('#wc-time option', (os) => os.map((o) => o.textContent));
  assert.equal(labels.length, 19, '18 half-hour slots from 09:00 to 17:30, plus the placeholder');
  assert.ok(labels[1].includes('(09:00 in Italy)'), labels[1]);
  const value = await p.$eval('#wc-time option:nth-child(4)', (o) => o.value);
  await p.select('#wc-time', value);
  await p.type('#wc-name', 'Call Tester');
  await p.type('#wc-email', 'call.tester@example.com');
  await p.type('#wc-country', 'United States');
  await p.click('input[name="consentProcessing"]');
  await p.click('input[name="consentRecording"]');
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle0' }), p.click('#webcall-form [type="submit"]')]);
  assert.ok(p.url().includes('/en/start/webcall/confirmed/'));
  await p.waitForSelector('#booking-summary dl');
  const text = await p.$eval('#booking-summary', (e) => e.textContent);
  assert.ok(text.includes('America/New York') && text.includes('Allowed'), text);
  const href = await p.$eval('a[download]', (a) => a.href);
  const ics = await p.evaluate((u) => fetch(u).then((r) => r.text()), href);
  assert.ok(ics.includes('BEGIN:VEVENT') && ics.includes(`DTSTART:${value.replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`));
  await p.browserContext().close();
});

// Forms
await step('Contact: property reference prefilled from the listing link, message stored', async () => {
  const p = await fresh();
  await go(p, '/en/contact/?property=OIK-PU-1001');
  await acceptConsent(p);
  assert.equal(await p.$eval('#ct-property', (e) => e.value), 'OIK-PU-1001');
  assert.equal(await p.$eval('#ct-subject', (e) => e.value), 'property');
  await p.click('#contact-form [type="submit"]');
  assert.ok((await p.$eval('#ct-message-error', (e) => e.textContent)).length > 0);
  await p.type('#ct-name', 'Contact Tester'); await p.type('#ct-email', 'contact@example.com'); await p.type('#ct-country', 'France');
  await p.type('#ct-message', 'Is the annexe habitable?');
  await p.click('#contact-form input[name="consentProcessing"]');
  await p.click('#contact-form [type="submit"]');
  await p.waitForSelector('#contact-status.form-status--ok');
  const crm = await ls(p, 'crm.v1');
  assert.ok(crm.buyers.some((b) => b.contact.email === 'contact@example.com' && b.interactions[0].summary.includes('OIK-PU-1001')));
  await p.browserContext().close();
});

await step('Partner agencies: form validates and stores the request', async () => {
  const p = await fresh();
  await go(p, '/en/partner-agencies/');
  await acceptConsent(p);
  await p.click('#partner-form [type="submit"]');
  assert.ok((await p.$eval('#pa-agency-error', (e) => e.textContent)).length > 0);
  await p.type('#pa-agency', 'Test Agency'); await p.type('#pa-name', 'Agent'); await p.type('#pa-email', 'agent@example.com'); await p.type('#pa-area', 'Lecce (LE)');
  await p.click('#partner-form input[name="consentProcessing"]');
  await p.click('#partner-form [type="submit"]');
  await p.waitForSelector('#partner-status.form-status--ok');
  const store = await ls(p, 'partners.v1');
  assert.equal(store.leads.length, 1);
  await p.browserContext().close();
});

// Consultant area (uses the browser context of the chat test, which holds the test buyer)
await step('Internal list: shows sample buyers plus the new one, filters by status and text', async () => {
  await go(page, '/internal/');
  await page.waitForSelector('.data-table tbody tr');
  assert.equal(await page.$$eval('.data-table tbody tr', (r) => r.length), 4);
  await page.select('#buyer-status', 'bought');
  assert.equal(await page.$$eval('.data-table tbody tr', (r) => r.length), 1);
  await page.select('#buyer-status', '');
  await page.type('#buyer-search', 'test.buyer');
  assert.equal(await page.$$eval('.data-table tbody tr', (r) => r.length), 1);
});

await step('Internal buyer: transcript generates a brief, replace, save; matches update; shortlist; feedback updates the brief; confirm', async () => {
  await page.goto(`${BASE}/internal/buyer/?id=b-demo-1`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#brief-title');
  await clickText(page, '.btn', 'Load a sample transcript');
  await clickText(page, '.btn', 'Generate brief from transcript');
  await page.waitForSelector('.proposal');
  assert.ok((await page.$eval('#proposal-title', (e) => e.textContent)).includes('8 criteria'));
  await clickText(page, '.btn', 'Replace the brief with this');
  assert.equal(await page.$eval('#brief-save-bar', (b) => b.hidden), false, 'unsaved changes shown');
  await clickText(page, '.btn', 'Save the brief');
  await page.waitForFunction(() => document.querySelector('#brief-save-bar')?.hidden === true);
  let buyer = (await ls(page, 'crm.v1')).buyers.find((b) => b.id === 'b-demo-1');
  assert.equal(buyer.wishlist.mustHave.find((c) => c.key === 'price').value, 900000);
  assert.equal(buyer.transcripts.length, 1);
  const before = await page.$eval('#matches-title', (e) => e.textContent);
  if (await page.$('#toggle-excluded')) {
    await page.click('#toggle-excluded');
    await page.waitForSelector('.match--excluded');
    assert.ok((await page.$$eval('.match--excluded', (ms) => ms.map((m) => m.textContent).join(' '))).includes('Ruled out by deal breaker'));
    await page.click('#toggle-excluded');
  }
  const add = await page.$('.match-list .btn--primary.btn--small');
  if (add) {
    await add.click();
    await page.waitForFunction(() => /Shortlist \(2\)/.test(document.querySelector('#shortlist-title').textContent));
  }
  assert.ok(before.startsWith('Matches'));
  await clickText(page, '.btn', 'Record feedback');
  await page.click('.feedback-form input[value="far-sea"]');
  await clickText(page, '.feedback-form .btn', 'Save feedback');
  await page.waitForSelector('.change-note');
  assert.ok((await page.$eval('.change-note', (e) => e.textContent)).includes('Distance to the sea'));
  buyer = (await ls(page, 'crm.v1')).buyers.find((b) => b.id === 'b-demo-1');
  assert.ok(buyer.feedback.length === 1 && buyer.wishlist.mustHave.some((c) => c.key === 'distanceSea'));
  await page.select('#ct-status', 'visiting');
  await clickText(page, '.btn', 'Save contact and status');
  await page.waitForFunction(() => document.querySelector('.buyer-head').textContent.includes('Visiting'));
});

await step('Internal buyer: brief editor adds, edits and removes a criterion; no-match buyer offers external search', async () => {
  await page.goto(`${BASE}/internal/buyer/?id=b-demo-3`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#matches-title');
  assert.ok(await page.$eval('.buyer-grid', (g) => g.textContent.includes('No property in the database fits this brief')));
  await clickText(page, '.btn', 'Log an external search');
  await page.waitForFunction(() => document.querySelector('.timeline').textContent.includes('External search started'));
  await page.select('#add-crit-key', 'pool');
  await page.select('#add-crit-prio', 'nice');
  await clickText(page, '.add-crit .btn', 'Add');
  assert.ok(await page.$('#prio-pool'));
  await page.$eval('#crit-price', (e) => { e.value = '900000'; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.click('[aria-label="Remove Pool"]');
  assert.equal(await page.$('#prio-pool'), null);
  await clickText(page, '.btn', 'Save the brief');
  await page.waitForFunction(() => document.querySelector('#brief-save-bar')?.hidden === true);
  const b = (await ls(page, 'crm.v1')).buyers.find((x) => x.id === 'b-demo-3');
  assert.equal(b.wishlist.mustHave.find((c) => c.key === 'price').value, 900000);
  await clickText(page, '.btn', 'Mark as confirmed with the buyer');
  await page.waitForFunction(() => document.body.textContent.includes('Brief confirmed'));
});

await step('Internal partners: KPIs, rate change recalculates the share, recording a sale adds a row', async () => {
  await go(page, '/internal/partners/');
  await page.waitForSelector('.kpis');
  assert.ok((await page.$eval('tfoot', (t) => t.textContent)).includes('€6,750'));
  await page.$eval('#share-rate', (e) => { e.value = '1.5'; });
  await clickText(page, '.toolbar .btn', 'Update');
  await page.waitForFunction(() => document.querySelector('tfoot')?.textContent.includes('€10,125'));
  await page.select('#sale-property', '1002');
  await page.select('#sale-buyer', 'b-demo-1');
  await page.type('#sale-value', '370000');
  await clickText(page, '#sale-form .btn', 'Record the sale');
  await page.waitForFunction(() => document.querySelector('.data-table caption')?.textContent === 'Completed sales' && document.querySelector('.data-table').querySelectorAll('tbody tr').length === 2);
  assert.ok((await page.$eval('tfoot', (t) => t.textContent)).includes('€15,675'), 'partner sale at 1.5% added');
});

await step('Internal: Reset demo data restores the sample buyers', async () => {
  await go(page, '/internal/');
  await page.waitForSelector('.data-table');
  await page.click('[data-reset-demo]');
  await page.waitForFunction(() => document.querySelectorAll('.data-table tbody tr').length === 3);
});

await step('Internal: unknown buyer id shows a not-found state', async () => {
  await go(page, '/internal/buyer/?id=nope');
  await page.waitForFunction(() => document.body.textContent.includes('Buyer not found'));
});

await browser.close();
console.log(results.join('\n'));
console.log(errors.length ? `\nConsole/page errors:\n${errors.join('\n')}` : '\nNo console or page errors.');
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
