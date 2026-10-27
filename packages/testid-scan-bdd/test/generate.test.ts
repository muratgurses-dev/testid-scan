import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { generate, pathOf, readScan, recordOf, testIdWords } from '../src/index.ts';
import type { PageScan, ScannedElement } from '../src/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
// the compiled tests run from .test-build/test; the fixtures stay in test/fixtures
const fixtures = join(here, '..', '..', 'test', 'fixtures');
const shop = JSON.parse(readFileSync(join(fixtures, 'shop.page.json'), 'utf8')) as PageScan;

const scanOf = (pages: Array<{ url: string; elements: Array<Partial<ScannedElement>> }>): PageScan => ({
  schemaVersion: 1, scannedOn: '2026-10-27', testIdAttribute: 'data-testid',
  pages: pages.map((p) => ({ url: p.url, title: '', elements: p.elements.map((e) => ({ role: '', name: '', status: 'OK (name)', ...e }) as ScannedElement) })),
});

test('catalog: the steps a scenario can use on the fixture page, found the way the scan found them', () => {
  const { pages } = generate(shop);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].path, 'shop.html');
  assert.deepEqual(pages[0].steps.map((s) => `${s.text} | ${s.how}${s.examples ? ` | ${s.examples.join(', ')}` : ''}`), [
    'When I click the "Home" link | by role and name',
    'When I click the "Cart" link | by role and name',
    'When I click the "open menu" button | by test ID open-menu-button',
    'When I fill the "Search products" field with "<text>" | by role and name',
    'When I click the "Add to favorites" button | by role and name',
    'When I click the "Add to cart" button in the "<item>" item | by role and name, inside one list item | Lamp, Chair, Desk',
    'When I click the "Remove" button in the "<item>" item | by role and name, inside one list item | Lamp in cart, Desk in cart',
    'When I check the "Gift wrap" checkbox | by role and name',
    'When I select "<option>" in the "Shipping" dropdown | by role and name',
    'When I click the "delete selected" button | by test ID delete-selected-button',
    'When I click the "delete all" button | by test ID delete-all-button',
    'When I click the "Open" button in the "<row>" row | by role and name, inside one table row | 1042, 1043',
  ]);
  assert.deepEqual(pages[0].unavailable, [{ element: 'button "Compare"', reason: 'Needs test ID: name "Compare" matches 2 elements on the page' }], 'listed once, with the reason from the scan');
});

test('catalog: Markdown with the page, its steps and what is not available yet', () => {
  const { catalog } = generate(shop);
  assert.match(catalog, /^# Steps you can write\n/);
  assert.ok(catalog.includes('## shop.html (Fixture shop)\n\n- `Given I am on the "shop.html" page`'));
  assert.ok(catalog.includes('- `When I click the "Open" button in the "<row>" row` (by role and name, inside one table row, for example "1042", "1043")'));
  assert.ok(catalog.includes('**Not available yet.**'));
  assert.ok(catalog.includes('- button "Compare": Needs test ID: name "Compare" matches 2 elements on the page'));
});

test('steps: the same definitions for every scan; a scan only adds the elements found by test ID', () => {
  const { steps, testIds } = generate(shop);
  assert.deepEqual(testIds, { 'button:open menu': 'open-menu-button', 'button:delete selected': 'delete-selected-button', 'button:delete all': 'delete-all-button' });
  assert.ok(steps.includes('  "button:delete all": "delete-all-button",\n  "button:delete selected": "delete-selected-button",\n  "button:open menu": "open-menu-button",\n'), 'sorted, so a new scan gives a small diff');
  for (const step of ["Given('I am on the {string} page'", "When('I fill the {string} field with {string}'", "When('I select {string} in the {string} dropdown'",
    "Then('I see the text {string}'", 'I click the {string} ${noun} in the {string} ${recordNoun}', 'I do not see the {string} ${noun}']) {
    assert.ok(steps.includes(step), `defines ${step}`);
  }
  const empty = generate(scanOf([{ url: 'http://x/', elements: [] }])).steps;
  const strip = (s: string) => s.replace(/const BY_TEST_ID[\s\S]*?\n};\n/, '');
  assert.equal(strip(empty), strip(steps));
});

test('test ID names: the accessible name when it points at one element, else the test ID read as words', () => {
  const scan = scanOf([
    { url: 'http://x/a', elements: [{ role: 'button', name: 'Export', testId: 'export-button', status: 'OK (test ID)', locator: "page.getByTestId('export-button')" }] },
    { url: 'http://x/b', elements: [
      { role: 'button', name: 'Save', testId: 'orders-save-button', status: 'OK (test ID)', locator: "page.getByTestId('orders-save-button')" },
      { role: 'button', name: 'Save', testId: 'users-save-btn', status: 'OK (test ID)', locator: "page.getByTestId('users-save-btn')" },
    ] },
  ]);
  assert.deepEqual(generate(scan).testIds, { 'button:Export': 'export-button', 'button:orders save': 'orders-save-button', 'button:users save': 'users-save-btn' });
  assert.equal(testIdWords('orders-create-btn'), 'orders create');
  assert.equal(testIdWords('profile_menu_item'), 'profile menu');
});

test('records: a checkbox inside a record has no step yet and says so; other roles are left out', () => {
  const scan = scanOf([{ url: 'http://x/#/list', elements: [
    { role: 'checkbox', name: 'Done', locator: "page.getByRole('listitem').filter({ hasText: 'Milk' }).getByRole('checkbox', { name: 'Done', exact: true })" },
    { role: 'img', name: 'Logo', locator: "page.getByRole('img', { name: 'Logo', exact: true })" },
    { role: '', name: '', status: 'Manual review', reason: 'looks clickable (pointer cursor) but has no role' },
  ] }]);
  const [page] = generate(scan).pages;
  assert.equal(page.path, '#/list');
  assert.deepEqual(page.steps, []);
  assert.deepEqual(page.unavailable.map((u) => `${u.element}: ${u.reason}`), [
    'checkbox "Done": repeated: found inside one list item, and there is no step for a checkbox in a record yet',
    'element without a role: Manual review: looks clickable (pointer cursor) but has no role',
  ]);
});

test('helpers: page paths and record locators as testid-scan-page writes them', () => {
  assert.equal(pathOf('http://localhost:4200/'), '/');
  assert.equal(pathOf('http://localhost:4200/orders?tab=open#top'), 'orders?tab=open#top');
  assert.equal(pathOf('http://localhost:4200/#/cart'), '#/cart');
  assert.deepEqual(recordOf("page.getByRole('row').filter({ hasText: 'O\\'Brien \\\\ Co' }).getByRole('button', { name: 'Open', exact: true })"), { role: 'row', text: "O'Brien \\ Co" });
  assert.equal(recordOf("page.getByRole('button', { name: 'Open', exact: true })"), undefined);
});

test('reading: a testid-scan-page result is accepted; anything else says what to run', () => {
  assert.equal(readScan(shop), shop);
  assert.throws(() => readScan({ schemaVersion: 1, files: [], elements: [] }), /testid-scan result \(a scan of source files\).*testid-scan-page <url>/);
  assert.throws(() => readScan({ schemaVersion: 1 }), /has no "pages"/);
  assert.throws(() => readScan({ schemaVersion: 2, pages: [] }), /Unknown schemaVersion 2/);
  assert.throws(() => readScan(null), /not a JSON object/);
});
