/** testid-scan-page/vite marks HTML elements with their source line; --verify uses it as the most certain evidence. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as ts from 'typescript';
import { markJsx, markVue, scanPages } from '../src/index.ts';
import type { StaticScan } from '../src/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = here.includes('.test-build') ? join(here, '..', '..', 'test', 'fixtures') : join(here, 'fixtures');

test('JSX: elements and component uses get their line; fragments and existing marks do not', () => {
  const code = [
    'export const A = () => (',
    '  <div>',
    '    <Button>Save</Button>',
    '    <button onClick={() => {}}>Go</button>',
    '    <input data-tsrc="kept" />',
    '    <motion.div />',
    '    <React.Fragment><Ctx.Provider value={1} /></React.Fragment>',
    '  </div>',
    ');',
  ].join('\n');
  const out = markJsx(code, '/app/src/views/A.tsx', 'views/A.tsx', 'data-tsrc', ts);
  assert.match(out, /<div data-tsrc="views\/A.tsx:2">/);
  assert.match(out, /<button data-tsrc="views\/A.tsx:4" onClick/);
  assert.match(out, /<Button data-tsrc-use="views\/A.tsx:3">Save/);
  assert.match(out, /<input data-tsrc="kept" \/>/);
  assert.match(out, /<motion.div data-tsrc-use="views\/A.tsx:6" \/>/);
  assert.match(out, /<React.Fragment><Ctx.Provider value=\{1\} \/><\/React.Fragment>/);
  assert.equal(out.split('\n').length, code.split('\n').length); // lines do not move
  assert.match(markJsx(code, '/app/src/views/A.tsx', 'views/A.tsx', 'data-tsrc', ts, false), /<Button>Save/);
});

test('Vue: elements and component uses in the template get their line in the .vue file', () => {
  const compiler = createRequire(import.meta.url)('vue/compiler-sfc');
  const code = [
    '<template>',
    '  <section>',
    '    <MyButton>Save</MyButton>',
    '    <button v-if="x" @click="go">Go</button>',
    '    <template v-for="i in items"><a :href="i">Open</a></template>',
    '  </section>',
    '</template>',
    '<script setup>const x = 1</script>',
  ].join('\n');
  const out = markVue(code, '/app/src/Home.vue', 'Home.vue', 'data-tsrc', compiler);
  assert.match(out, /<section data-tsrc="Home.vue:2">/);
  assert.match(out, /<button data-tsrc="Home.vue:4" v-if/);
  assert.match(out, /<a data-tsrc="Home.vue:5" :href/);
  assert.match(out, /<MyButton data-tsrc-use="Home.vue:3">Save/);
  assert.match(out, /<template v-for/);
});

test('verify: data-tsrc settles wrong targets and missing elements, whatever the condition', async () => {
  const url = pathToFileURL(join(fixtures, 'tsrc.html')).href;
  const elements: StaticScan['elements'] = [
    { file: 'Home.vue', line: 3, tag: 'button', recommendedLocator: "page.getByRole('button', { name: 'Save', exact: true })", locatorScope: 'page-candidate', conditional: true },
    // the panel's Close is not rendered; the one Close on the page is Toast.vue's
    { file: 'Home.vue', line: 5, tag: 'button', recommendedLocator: "page.getByRole('button', { name: 'Close', exact: true })", locatorScope: 'page-candidate', conditional: true },
    // a translation key: Home.vue:4 is visible, the locator finds nothing
    { file: 'Home.vue', line: 4, tag: 'button', recommendedLocator: "page.getByRole('button', { name: 'home.subscribe', exact: true })", locatorScope: 'page-candidate', conditional: true },
    // not rendered at all, though written unconditionally: data-tsrc shows it is absent, so this is no proof of a wrong name
    { file: 'Home.vue', line: 6, tag: 'button', recommendedLocator: "page.getByRole('button', { name: 'Coupon', exact: true })", locatorScope: 'page-candidate', conditional: false },
    { file: 'Home.vue', line: 7, tag: 'button', recommendedLocator: "page.getByRole('button', { name: 'Print', exact: true })", locatorScope: 'page-candidate', conditional: false },
  ];
  const { verify } = await scanPages([url], { staticScan: { elements } });
  const at = (line: number) => verify!.checked.find((c) => c.line === line)!;
  assert.equal(at(3).verdict, 'verified correct');
  assert.equal(at(3).target?.by, 'source line');
  assert.equal(at(5).verdict, 'verified incorrect');
  assert.match(at(5).why, /Toast.vue:2/);
  assert.equal(at(4).verdict, 'verified incorrect');
  assert.match(at(4).why, /visible on the page/);
  assert.equal(at(6).verdict, 'unable to verify');
  assert.match(at(6).why, /not rendered/);
  assert.equal(at(7).verdict, 'unable to verify');
  assert.match(at(7).why, /hidden/);
});

test('verify: the other arm of an if/else is the right element', async () => {
  const url = pathToFileURL(join(fixtures, 'tsrc.html')).href;
  const save = "page.getByRole('button', { name: 'Save', exact: true })";
  const { verify } = await scanPages([url], { staticScan: { elements: [
    { file: 'Home.vue', line: 2, tag: 'button', recommendedLocator: save, locatorScope: 'page-candidate', conditional: true, alternatives: [3] },
    { file: 'Home.vue', line: 3, tag: 'button', recommendedLocator: save, locatorScope: 'page-candidate', conditional: true, alternatives: [2] },
  ] } });
  assert.deepEqual(verify!.checked.map((c) => c.verdict), ['verified correct', 'verified correct']);
  assert.match(verify!.checked[0].why, /other arm/);
});

test('verify: a passed-on component use never hides the line an element was written at (found by the reviewer)', async () => {
  // <table> written at table.tsx:14 inside a component used at table.tsx:153, which passes its props on
  const url = pathToFileURL(join(fixtures, 'tsrc-use.html')).href;
  const { verify } = await scanPages([url], { staticScan: { elements: [
    { file: 'table.tsx', line: 14, tag: 'table', recommendedLocator: "page.getByRole('table')", locatorScope: 'page-candidate', conditional: false },
    { file: 'list.tsx', line: 8, tag: 'Button', recommendedLocator: "page.getByRole('button', { name: 'Open', exact: true })", locatorScope: 'page-candidate', conditional: false },
  ] } });
  const at = (file: string) => verify!.checked.find((c) => c.file === file)!;
  assert.equal(at('table.tsx').verdict, 'verified correct');
  assert.equal(at('list.tsx').verdict, 'verified correct');
  assert.match(at('list.tsx').why, /used at list.tsx:8/);
});

test('verify: a single match must be proved on every page that shows its component (found by the reviewer)', async () => {
  // the comment form's Submit: right on the comment drawer, but on the edit drawer it finds the edit form's Submit
  const right = pathToFileURL(join(fixtures, 'drawer-comment.html')).href;
  const wrong = pathToFileURL(join(fixtures, 'drawer-edit.html')).href;
  const elements: StaticScan['elements'] = [
    { file: 'create-comment.tsx', line: 40, tag: 'Button', recommendedLocator: "page.getByRole('button', { name: 'Submit', exact: true })", locatorScope: 'page-candidate', conditional: true },
  ];
  const { verify } = await scanPages([right, wrong], { staticScan: { elements } });
  assert.equal(verify!.checked[0].verdict, 'unable to verify');
  const one = await scanPages([right], { staticScan: { elements } });
  assert.equal(one.verify!.checked[0].verdict, 'verified correct');
});

test('report fields: every verdict names its evidence; incorrect and unverified ones say what to do', async () => {
  const url = pathToFileURL(join(fixtures, 'tsrc.html')).href;
  const { verify } = await scanPages([url], { staticScan: { elements: [
    { file: 'Home.vue', line: 3, tag: 'button', recommendedLocator: "page.getByRole('button', { name: 'Save', exact: true })", locatorScope: 'page-candidate', conditional: false },
    { file: 'Home.vue', line: 4, tag: 'button', recommendedLocator: "page.getByRole('button', { name: 'home.subscribe', exact: true })", locatorScope: 'page-candidate', conditional: false },
    { file: 'Home.vue', line: 6, tag: 'button', recommendedLocator: "page.getByRole('button', { name: 'Coupon', exact: true })", locatorScope: 'page-candidate', conditional: true },
  ], files: [{ file: 'Home.vue', framework: 'vue' }] } });
  const [save, key, coupon] = verify!.checked;
  assert.deepEqual([save.verdict, save.evidence, save.remediation, save.framework], ['verified correct', 'source line', undefined, 'vue']);
  assert.deepEqual([key.verdict, key.evidence], ['verified incorrect', 'source line']);
  assert.match(key.remediation ?? '', /rendered name|test ID/);
  assert.deepEqual([coupon.verdict, coupon.evidence], ['unable to verify', 'none']);
  assert.ok(coupon.remediation);
  assert.deepEqual(verify!.summary && [verify!.summary.verifiedCorrect, verify!.summary.verifiedIncorrect, verify!.summary.unableToVerify, verify!.summary.verifiedShare], [1, 1, 1, 66.7]);
  assert.equal(save.pages[0].label, url);
});
