/** --verify checks that a locator matching one element found the element of its source line. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scanPages } from '../src/index.ts';
import type { StaticScan } from '../src/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = here.includes('.test-build') ? join(here, '..', '..', 'test', 'fixtures') : join(here, 'fixtures');
const url = pathToFileURL(join(fixtures, 'target.html')).href;

const elements: StaticScan['elements'] = [
  { file: 'home.html', line: 1, recommendedLocator: "page.getByPlaceholder('Search', { exact: true })", locatorScope: 'page-candidate', conditional: false },
  { file: 'home.html', line: 2, recommendedLocator: "page.getByRole('button', { name: 'Save', exact: true })", locatorScope: 'page-candidate', conditional: false },
  { file: 'home.html', line: 3, recommendedLocator: "page.getByRole('button', { name: 'Subscribe', exact: true })", locatorScope: 'page-candidate', conditional: false },
  // written in home.html inside a closed panel; the only "Close" on the page is the toast's
  { file: 'home.html', line: 4, recommendedLocator: "page.getByRole('button', { name: 'Close', exact: true })", locatorScope: 'page-candidate' },
  { file: 'toast.html', line: 1, recommendedLocator: "page.getByRole('button', { name: 'Close', exact: true })", locatorScope: 'page-candidate', conditional: false },
];

test('region guess: an element outside the area of the rest of its file is a likely wrong target', async () => {
  const { verify } = await scanPages([url], { staticScan: { elements } });
  const at = (file: string, line: number) => verify!.checked.find((c) => c.file === file && c.line === line)!;
  assert.equal(at('home.html', 4).result, 'wrong target');
  assert.equal(at('home.html', 4).target?.check, 'region');
  assert.equal(at('home.html', 2).result, 'matched');
  assert.equal(at('home.html', 2).target?.check, 'region');
  assert.equal(at('toast.html', 1).result, 'matched'); // nothing else from toast.html to compare with
  assert.equal(at('toast.html', 1).target?.check, 'unchecked');
});

test('Angular hosts: the component host around the element names its template for certain', async () => {
  const files = [{ file: 'home.html', selectors: ['app-home'] }, { file: 'toast.html', selectors: ['app-toast'] }];
  const { verify } = await scanPages([url], { staticScan: { elements, files } });
  const at = (file: string, line: number) => verify!.checked.find((c) => c.file === file && c.line === line)!;
  assert.equal(at('home.html', 4).result, 'wrong target');
  assert.equal(at('home.html', 4).target?.check, 'exact');
  assert.equal(at('home.html', 4).target?.owner, 'app-toast');
  assert.equal(at('toast.html', 1).result, 'matched');
  assert.equal(at('toast.html', 1).target?.check, 'exact');
});

test('verdicts: only evidence verifies', async () => {
  const items: StaticScan['elements'] = [
    ...elements.slice(0, 3),
    { ...elements[3], conditional: true }, // the panel's Close is shown only when the panel is open
    elements[4],
    { file: 'home.html', line: 5, recommendedLocator: "page.getByRole('button', { name: 'Help', exact: true })", locatorScope: 'page-candidate', conditional: false },
    { file: 'home.html', line: 6, recommendedLocator: "page.getByRole('button', { name: 'Print', exact: true })", locatorScope: 'page-candidate', conditional: false },
    { file: 'home.html', line: 7, recommendedLocator: "page.getByRole('button', { name: 'home.archive', exact: true })", locatorScope: 'page-candidate', conditional: false },
    { file: 'home.html', line: 8, recommendedLocator: "page.getByRole('button', { name: 'Apply coupon', exact: true })", locatorScope: 'page-candidate', conditional: true },
    { file: 'admin.html', line: 1, recommendedLocator: "page.getByRole('button', { name: 'Delete all', exact: true })", locatorScope: 'page-candidate', conditional: false },
    // from an older testid-scan that does not say whether an element is conditional: never proved, never condemned
    { file: 'home.html', line: 9, recommendedLocator: "page.getByRole('button', { name: 'home.legacy', exact: true })", locatorScope: 'page-candidate' },
  ];
  const run = async (files?: StaticScan['files']) => {
    const { verify } = await scanPages([url], { staticScan: { elements: items, files } });
    return (file: string, line: number) => verify!.checked.find((c) => c.file === file && c.line === line)!;
  };

  let at = await run();
  assert.equal(at('home.html', 2).verdict, 'verified correct'); // unconditional, its component is there, no twin
  assert.match(at('home.html', 4).why, /^likely the wrong element/); // a guess never verifies
  assert.equal(at('home.html', 4).verdict, 'unable to verify');
  assert.equal(at('toast.html', 1).verdict, 'unable to verify'); // nothing else of toast.html to show it is there
  assert.equal(at('home.html', 5).verdict, 'unable to verify'); // a hidden "Help" with the same name
  assert.match(at('home.html', 5).why, /hidden element/);
  assert.equal(at('home.html', 6).verdict, 'unable to verify'); // "Print" is there, but hidden
  assert.match(at('home.html', 6).why, /hidden/);
  assert.equal(at('home.html', 7).verdict, 'verified incorrect'); // unconditional, component there, nothing found
  assert.equal(at('home.html', 8).verdict, 'unable to verify'); // conditional: may simply not be shown
  assert.equal(at('admin.html', 1).verdict, 'unable to verify'); // its screen was not scanned
  assert.match(at('admin.html', 1).why, /add the URL/);
  assert.equal(at('home.html', 9).verdict, 'unable to verify');
  assert.match(at('home.html', 9).why, /rerun a current testid-scan/);

  at = await run([{ file: 'home.html', selectors: ['app-home'] }, { file: 'toast.html', selectors: ['app-toast'] }]);
  assert.equal(at('home.html', 4).verdict, 'verified incorrect'); // Angular host: certainly another component
  assert.equal(at('toast.html', 1).verdict, 'verified correct');
});

test('shared fields: a locator only counts on screens that show its component (found on real apps)', async () => {
  // a login and a register form both have an "Email" field; only the login form is on this page
  const login = pathToFileURL(join(fixtures, 'login.html')).href;
  const { verify } = await scanPages([login], { staticScan: { elements: [
    { file: 'Login.vue', line: 3, tag: 'input', recommendedLocator: "page.getByLabel('Email', { exact: true })", locatorScope: 'page-candidate', conditional: false },
    { file: 'Login.vue', line: 6, tag: 'input', recommendedLocator: "page.getByLabel('Password', { exact: true })", locatorScope: 'page-candidate', conditional: false },
    { file: 'Login.vue', line: 9, tag: 'button', recommendedLocator: "page.getByRole('button', { name: 'Sign in', exact: true })", locatorScope: 'page-candidate', conditional: false },
    { file: 'Register.vue', line: 3, tag: 'input', recommendedLocator: "page.getByLabel('Email', { exact: true })", locatorScope: 'page-candidate', conditional: false },
    { file: 'Register.vue', line: 5, tag: 'input', recommendedLocator: "page.getByLabel('Password', { exact: true })", locatorScope: 'page-candidate', conditional: false },
    { file: 'Register.vue', line: 9, tag: 'button', recommendedLocator: "page.getByRole('button', { name: 'Sign up', exact: true })", locatorScope: 'page-candidate', conditional: false },
  ] } });
  const at = (file: string, line: number) => verify!.checked.find((c) => c.file === file && c.line === line)!;
  // "Sign in" is only in Login.vue: it shows the login form is here, so its "Email" is proved by elimination
  assert.equal(at('Login.vue', 3).verdict, 'verified correct');
  // "Email" and "Password" are shared: matching them proves nothing about the register form
  assert.equal(at('Register.vue', 3).verdict, 'unable to verify');
  assert.match(at('Register.vue', 3).why, /could not be shown to be/);
  assert.equal(at('Register.vue', 5).verdict, 'unable to verify');
});
