/** React production builds with source maps: which component created an element. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Page } from 'playwright';
import { checkOnPage, decodeMappings, finishVerify, judgeChain, linkOf, locatorsToCheck, sourceAt } from '../src/index.ts';
import type { StaticScan } from '../src/index.ts';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const vlq = (n: number) => { let v = n < 0 ? (-n << 1) | 1 : n << 1; let out = ''; do { let d = v & 31; v >>>= 5; if (v) d |= 32; out += B64[d]; } while (v); return out; };

test('source maps: mappings decode to the original file of a generated position', () => {
  const map = { sources: ['src/a.tsx', 'src/b.tsx'], mappings: `${[0, 0, 0, 0].map(vlq).join('')};;${[4, 1, 10, 2].map(vlq).join('')},${[6, -1, -5, 0].map(vlq).join('')}` };
  assert.deepEqual(decodeMappings(map.mappings)[2], [[4, 1, 10, 2], [10, 0, 5, 2]]);
  assert.equal(sourceAt(map, 0, 7), 'src/a.tsx');
  assert.equal(sourceAt(map, 2, 5), 'src/b.tsx');
  assert.equal(sourceAt(map, 2, 12), 'src/a.tsx');
  assert.equal(sourceAt(map, 1, 0), undefined);
  assert.deepEqual(linkOf('../../src/features/auth/login-form.tsx', ['features/auth/login-form.tsx', 'login-form.tsx']), { file: 'features/auth/login-form.tsx' });
  assert.deepEqual(linkOf('webpack://app/./src/button.tsx', ['button.tsx']), { file: 'button.tsx' });
  assert.deepEqual(linkOf('../../node_modules/@mui/material/Button/Button.js', ['Button.js']), { external: 'node_modules/@mui/material/Button/Button.js' });
  assert.equal(linkOf(undefined, []), null);
});

test('creator chains: an HTML element needs its own file first; a component use needs its file right after the component', () => {
  const f = (file: string) => ({ file }); const x = (external: string) => ({ external });
  // <button> written in login-form.tsx
  assert.equal(judgeChain([f('login-form.tsx'), f('page.tsx')], 'login-form.tsx', true)?.ok, true);
  assert.equal(judgeChain([f('register-form.tsx'), f('page.tsx')], 'login-form.tsx', true)?.ok, false);
  // created while another component rendered a function of login-form.tsx: says nothing
  assert.equal(judgeChain([f('form.tsx'), f('login-form.tsx')], 'login-form.tsx', true), undefined);
  // the chain broke off: says nothing either
  assert.equal(judgeChain([f('register-form.tsx'), null], 'login-form.tsx', true), undefined);
  // <Button> used in login-form.tsx: a project component, or a library component (node_modules)
  assert.equal(judgeChain([f('button.tsx'), f('login-form.tsx')], 'login-form.tsx', false)?.ok, true);
  assert.equal(judgeChain([x('node_modules/@mui/ButtonBase.js'), x('node_modules/@mui/Button.js'), f('login-form.tsx')], 'login-form.tsx', false)?.ok, true);
  assert.equal(judgeChain([f('button.tsx'), f('register-form.tsx'), f('page.tsx')], 'login-form.tsx', false)?.ok, false);
  // login-form.tsx further up (it renders the layout that renders the button): another element, but not proven wrong
  assert.equal(judgeChain([f('button.tsx'), f('user-menu.tsx'), f('login-form.tsx')], 'login-form.tsx', false), undefined);
});

/**
 * A page shaped like a React 18 production build: minified components in a bundle with a source map, DOM nodes
 * carrying __reactFiber$/__reactProps$, and elements without owners. LoginForm and RegisterForm each use Button.
 */
async function fakeReactPage(page: Page, withMap: boolean) {
  const map = { version: 3, sources: ['../src/login-form.tsx', '../src/register-form.tsx', '../src/button.tsx'], names: [], mappings: [[0, 0, 0, 0], [0, 1, 0, 0], [0, 1, 0, 0]].map((s) => s.map(vlq).join('')).join(';') };
  const bundle = [
    'function a(){}',
    'function b(){}',
    'function c(){}',
    `(() => {
      const E = Symbol.for('react.element');
      const fiber = (tag, type, props, parent) => { const f = { tag, type, memoizedProps: props, pendingProps: props, child: null, sibling: null, return: parent, alternate: null, stateNode: null }; if (parent) { if (!parent.child) parent.child = f; else { let s = parent.child; while (s.sibling) s = s.sibling; s.sibling = f; } } return f; };
      const root = fiber(3, null, null, null); root.stateNode = { current: root };
      const app = document.getElementById('app'); app['__reactContainer$t'] = root;
      const form = (Component, label, id) => {
        const comp = fiber(0, Component, {}, root);
        const buttonProps = { children: label };
        const hostForm = fiber(5, 'form', { children: { $$typeof: E, type: c, props: buttonProps } }, comp);
        const btn = fiber(0, c, buttonProps, hostForm);
        const hostProps = { className: 'btn', children: label };
        const hostButton = fiber(5, 'button', hostProps, btn);
        const formEl = document.createElement('form'); const el = document.createElement('button'); el.textContent = label; el.id = id;
        formEl['__reactFiber$t'] = hostForm; formEl['__reactProps$t'] = hostForm.memoizedProps;
        el['__reactFiber$t'] = hostButton; el['__reactProps$t'] = hostProps;
        formEl.append(el); app.append(formEl);
      };
      form(a, 'Log in', 'login'); form(b, 'Sign up', 'register');
    })();`,
    withMap ? `//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}` : '',
  ].join('\n');
  await page.route('http://app.test/**', (route) => (route.request().url().endsWith('.js')
    ? route.fulfill({ contentType: 'text/javascript', body: bundle })
    : route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><title>App</title></head><body><div id="app"></div><script src="/bundle.js"></script></body></html>' })));
  await page.goto('http://app.test/');
}

const scan: StaticScan = { elements: [
  // <Button>Log in</Button> in login-form.tsx: the right locator, but the button is shown only when the form decides
  { file: 'login-form.tsx', line: 5, tag: 'Button', recommendedLocator: "page.getByRole('button', { name: 'Log in', exact: true })", locatorScope: 'page-candidate', conditional: true },
  // register-form.tsx's locator that finds the login form's button
  { file: 'register-form.tsx', line: 7, tag: 'Button', recommendedLocator: "page.getByRole('button', { name: 'Log in', exact: true })", locatorScope: 'page-candidate', conditional: true },
], files: [{ file: 'login-form.tsx', framework: 'react' }, { file: 'register-form.tsx', framework: 'react' }, { file: 'button.tsx', framework: 'react' }] };

test('React production build with source maps: right and wrong targets are settled, and the page is left as it was', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await fakeReactPage(page, true);
    const { items, skipped, selectorsByFile } = locatorsToCheck(scan);
    await checkOnPage(page, items, selectorsByFile, { state: 'start' });
    finishVerify(items, skipped);
    const [login, register] = items;
    assert.equal(login.verdict, 'verified correct');
    assert.equal(login.evidence, 'component ownership');
    assert.match(login.why, /used in this file/);
    assert.equal(register.verdict, 'verified incorrect');
    assert.match(register.why, /login-form\.tsx/);
    assert.equal(await page.evaluate(() => '__testidScanReactFns' in window), false);
    // the same page checked as a plain production build: no verdict either way (both are conditional)
    const plain = locatorsToCheck(scan);
    await checkOnPage(page, plain.items, plain.selectorsByFile, { state: 'start', react: false });
    finishVerify(plain.items, plain.skipped);
    assert.deepEqual(plain.items.map((i) => i.verdict), ['unable to verify', 'unable to verify']);
  } finally {
    await browser.close();
  }
});

test('React production build without source maps: nothing is claimed', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await fakeReactPage(page, false);
    const { items, skipped, selectorsByFile } = locatorsToCheck(scan);
    await checkOnPage(page, items, selectorsByFile, { state: 'start' });
    finishVerify(items, skipped);
    assert.deepEqual(items.map((i) => i.verdict), ['unable to verify', 'unable to verify']);
  } finally {
    await browser.close();
  }
});
