/** The locator parser never runs code: only Playwright locator calls with literal arguments are accepted. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locatorsToCheck, parseLocator, parseSnapshot } from '../src/index.ts';

test('reads the locator forms testid-scan writes', () => {
  assert.deepEqual(parseLocator("page.getByRole('button', { name: 'Save', exact: true })"), [{ method: 'getByRole', args: ['button', { name: 'Save', exact: true }] }]);
  assert.deepEqual(parseLocator("page.getByPlaceholder('Search', { exact: true })"), [{ method: 'getByPlaceholder', args: ['Search', { exact: true }] }]);
  assert.deepEqual(parseLocator("page.getByTestId('orders-save-button')"), [{ method: 'getByTestId', args: ['orders-save-button'] }]);
  assert.deepEqual(
    parseLocator("page.locator('[data-order-id=\"7\"]').getByRole('link', { name: 'Open', exact: true })"),
    [{ method: 'locator', args: ['[data-order-id="7"]'] }, { method: 'getByRole', args: ['link', { name: 'Open', exact: true }] }],
  );
  assert.deepEqual(parseLocator("page.getByRole('button', { name: 'Don\\'t save', exact: true })")[0].args[1], { name: "Don't save", exact: true });
});

test('rejects anything that is not a locator call with literal arguments', () => {
  for (const text of [
    "page.evaluate('1')",
    "page.getByRole(process.exit(1))",
    "require('fs')",
    "page.getByRole('button'); process.exit(1)",
    "page.getByRole(`button`)",
    'page',
  ]) assert.throws(() => parseLocator(text), Error, text);
});

test('record-scoped locators with <...> are skipped, the rest are checked', () => {
  const { items, skipped } = locatorsToCheck({ elements: [
    { file: 'a.html', line: 1, recommendedLocator: "page.getByRole('button', { name: 'Save', exact: true })", locatorScope: 'page-candidate' },
    { file: 'a.html', line: 2, recommendedLocator: "page.locator('[data-order-id=\"<value>\"]').getByRole('button', { name: 'Edit', exact: true })", locatorScope: 'record-scoped' },
    { file: 'a.html', line: 3 },
  ] });
  assert.equal(items.length, 1);
  assert.equal(skipped, 1);
});

test('reads role and name from an ARIA snapshot line', () => {
  assert.deepEqual(parseSnapshot('- button "Save"'), { role: 'button', name: 'Save' });
  assert.deepEqual(parseSnapshot('- link "Home":\n  - /url: /'), { role: 'link', name: 'Home' });
  assert.deepEqual(parseSnapshot('- button'), { role: 'button', name: '' });
  assert.deepEqual(parseSnapshot('- textbox "Say \\"hi\\""'), { role: 'textbox', name: 'Say "hi"' });
  assert.deepEqual(parseSnapshot("- 'button \"It''s: here\"'"), { role: 'button', name: "It's: here" });
  assert.deepEqual(parseSnapshot('- generic: Hover me'), { role: '', name: '' });
  assert.deepEqual(parseSnapshot(''), { role: '', name: '' });
});
