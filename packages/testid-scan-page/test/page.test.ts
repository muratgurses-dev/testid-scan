/**
 * Scans a small fixture page in Chromium and checks the status of each element.
 * Needs Playwright's Chromium (npx playwright install chromium).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scanLoadedPage, scanPages } from '../src/index.ts';
import type { PageElement, ScanPageResult } from '../src/index.ts';

// compiled tests run from .test-build/test; the fixtures stay in test/fixtures
const here = dirname(fileURLToPath(import.meta.url));
const fixtures = here.includes('.test-build') ? join(here, '..', '..', 'test', 'fixtures') : join(here, 'fixtures');
const url = pathToFileURL(join(fixtures, 'orders.html')).href;

let result: ScanPageResult | undefined;
const scanOnce = async () => (result ??= await scanPages([url], {
  staticScan: { elements: [
    { file: 'orders.html', line: 1, recommendedLocator: "page.getByRole('button', { name: 'Add order', exact: true })", locatorScope: 'page-candidate' },
    { file: 'nav.html', line: 1, recommendedLocator: "page.getByRole('link', { name: 'Home', exact: true })", locatorScope: 'page-candidate' },
    { file: 'orders.html', line: 9, recommendedLocator: "page.getByRole('button', { name: 'Edit', exact: true })", locatorScope: 'unknown' },
    { file: 'other.html', line: 1, recommendedLocator: "page.getByRole('button', { name: 'Checkout', exact: true })", locatorScope: 'page-candidate' },
    { file: 'orders.html', line: 2, recommendedLocator: "page.getByRole('button', { name: 'Archive', exact: true })", locatorScope: 'page-candidate' },
  ] },
}));
const find = (elements: PageElement[], match: (e: PageElement) => boolean) => elements.filter(match);

test('unique role + name is OK (name), and the locator was run', async () => {
  const { elements } = (await scanOnce()).pages[0];
  const add = find(elements, (e) => e.name === 'Add order');
  assert.equal(add.length, 1);
  assert.equal(add[0].status, 'OK (name)');
  assert.equal(add[0].locator, "page.getByRole('button', { name: 'Add order', exact: true })");
  assert.equal(find(elements, (e) => e.name === 'Refresh')[0].status, 'OK (name)'); // aria-label
  assert.equal(find(elements, (e) => e.name === 'Search')[0].role, 'searchbox'); // <label> around the input
  assert.equal(find(elements, (e) => e.name === 'Filter')[0].status, 'OK (name)'); // placeholder as name
});

test('the same name twice on the page needs a test ID, unless it is unique inside its row', async () => {
  const { elements } = (await scanOnce()).pages[0];
  assert.deepEqual(find(elements, (e) => e.name === 'Home').map((e) => e.status), ['Needs test ID', 'Needs test ID']);
  const edits = find(elements, (e) => e.name === 'Edit');
  assert.deepEqual(edits.map((e) => e.status), ['OK (name)', 'OK (name)']);
  assert.match(edits[0].locator ?? '', /getByRole\('row'\)\.filter\(\{ hasText: 'Alpha' \}\)/);
});

test('a unique test ID makes an element OK when its name is shared; a shared test ID is Fix test ID', async () => {
  const { elements } = (await scanOnce()).pages[0];
  assert.deepEqual(find(elements, (e) => e.name === 'Save').map((e) => e.status), ['OK (test ID)', 'OK (test ID)']);
  assert.deepEqual(find(elements, (e) => e.name === 'Open').map((e) => e.status), ['Fix test ID', 'Fix test ID']);
});

test('nameless buttons, clickable divs and aria-hidden controls are reported; hidden ones are not', async () => {
  const { elements } = (await scanOnce()).pages[0];
  assert.equal(find(elements, (e) => e.role === 'button' && !e.name).length, 1);
  assert.equal(find(elements, (e) => e.role === 'button' && !e.name)[0].status, 'Missing name');
  assert.equal(find(elements, (e) => e.html.includes('onclick'))[0].status, 'Needs test ID');
  assert.equal(find(elements, (e) => e.html.startsWith('<div class="card">'))[0].status, 'Manual review');
  assert.equal(find(elements, (e) => e.tag === 'span')[0].status, 'Needs test ID');
  assert.equal(find(elements, (e) => e.html === '<button>' && !e.role && e.findings.some((f) => f.message.includes('aria-hidden'))).length, 1);
  assert.equal(find(elements, (e) => e.name === 'Hidden').length, 0);
});

test('verify: runs testid-scan locators and separates broken promises from expected repeats', async () => {
  const { verify } = await scanOnce();
  const by = (line: number, file: string) => verify!.checked.find((c) => c.line === line && c.file === file)!;
  assert.equal(by(1, 'orders.html').result, 'matched');
  assert.equal(by(1, 'nav.html').result, 'ambiguous');
  assert.equal(by(1, 'nav.html').scope, 'page-candidate');
  assert.equal(by(9, 'orders.html').result, 'ambiguous');
  assert.equal(by(1, 'other.html').result, 'not visited');
  assert.equal(by(2, 'orders.html').result, 'not found'); // its file is on the page (line 1 matched), it is not
});

test('the page is left as it was: no scan marks remain', async () => {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(url);
    const before = await page.content();
    await scanLoadedPage(page, { testIdAttribute: 'data-testid' });
    assert.equal(await page.locator('[data-testid-scan-page]').count(), 0);
    assert.equal(await page.content(), before);
  } finally {
    await browser.close();
  }
});
