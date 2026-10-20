/** Reliability: evidence stays with the state it was seen in, and the page is always left clean. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { checkOnPage, finishVerify, locatorsToCheck } from '../src/index.ts';
import type { StaticScan } from '../src/index.ts';

const form = (body: string) => `<!doctype html><html><head><title>Forms</title></head><body>${body}</body></html>`;

test('two states on one URL are not mixed: a component shown in one is not taken as shown in the other', async () => {
  const scan: StaticScan = { elements: [
    { file: 'Register.vue', line: 3, tag: 'input', recommendedLocator: "page.getByLabel('Email', { exact: true })", locatorScope: 'page-candidate', conditional: false },
    { file: 'Register.vue', line: 9, tag: 'button', recommendedLocator: "page.getByRole('button', { name: 'Sign up', exact: true })", locatorScope: 'page-candidate', conditional: false },
    { file: 'Login.vue', line: 3, tag: 'input', recommendedLocator: "page.getByLabel('Email', { exact: true })", locatorScope: 'page-candidate', conditional: false },
    { file: 'Newsletter.vue', line: 2, tag: 'input', recommendedLocator: "page.getByLabel('Email', { exact: true })", locatorScope: 'page-candidate', conditional: false },
  ] };
  const { items, skipped } = locatorsToCheck(scan);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // state 1: the register form
    await page.setContent(form('<form><input aria-label="Email"><button>Sign up</button></form>'));
    await checkOnPage(page, items, {}, { state: 'register open' });
    // state 2, same URL: the register form is gone; two other forms each have an "Email" field
    await page.setContent(form('<form><input aria-label="Email"><button>Sign in</button></form><form><input aria-label="Email"></form>'));
    await checkOnPage(page, items, {}, { state: 'register closed' });
    finishVerify(items, skipped);
  } finally {
    await browser.close();
  }
  const register = items.find((i) => i.file === 'Register.vue' && i.line === 3)!;
  assert.deepEqual(register.pages.map((p) => [p.label, p.count, p.fileShown]), [['register open', 1, true], ['register closed', 2, false]]);
  // the two matches of state 2 belong to other forms: they must not make the register form's locator incorrect
  assert.equal(register.verdict, 'verified correct');
});

test('temporary marks are removed even when the check fails half way', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // a page script that breaks querySelectorAll for the verifier's mark, so the in-page check throws after marking
    await page.setContent(form(`<button>Save</button><script>
      const original = Document.prototype.querySelectorAll;
      Document.prototype.querySelectorAll = function (s) { if (String(s).includes('data-testid-scan-verify')) throw new Error('boom'); return original.call(this, s); };
    </script>`));
    const { items } = locatorsToCheck({ elements: [{ file: 'a.html', line: 1, tag: 'button', recommendedLocator: "page.getByRole('button', { name: 'Save', exact: true })", locatorScope: 'page-candidate', conditional: false }] });
    await checkOnPage(page, items);
    const left = await page.evaluate(() => {
      let n = 0;
      const all = document.getElementsByTagName('*');
      for (let k = 0; k < all.length; k += 1) if (all[k].getAttributeNames().some((a) => a.startsWith('data-testid-scan'))) n += 1;
      return n;
    });
    assert.equal(left, 0);
    assert.equal(items[0].pages[0].count, 1);
  } finally {
    await browser.close();
  }
});
