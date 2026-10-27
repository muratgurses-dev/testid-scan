/** Recommended locators, locator scope and accessibility findings: fields added next to the status. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMarkdown, scan, scanJsx, scanTemplate, scanVue } from '../src/index.ts';
import type { ElementRecord } from '../src/index.ts';

const here = fileURLToPath(import.meta.url);
const cli = join(dirname(here), '..', 'src', here.endsWith('.ts') ? 'cli.ts' : 'cli.js');

const html = (lines: string[], options = {}) => scanTemplate(lines.join('\n'), options);
function one(rows: ElementRecord[], match: Partial<ElementRecord>): ElementRecord {
  const hits = rows.filter((r) => Object.entries(match).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v));
  assert.equal(hits.length, 1, `expected exactly one element matching ${JSON.stringify(match)}, got ${hits.length}`);
  return hits[0];
}
const rules = (r: ElementRecord) => r.accessibilityFindings.map((f) => `${f.rule}:${f.certainty}`);

// ---------- recommended locator ----------

test('locator: role and exact name where the name is reliable, test ID where there is one', () => {
  const rows = html([
    '<button>Save</button>',
    '<a routerLink="/x">Orders</a>',
    '<mat-checkbox>Remember me</mat-checkbox>',
    '<mat-slide-toggle>Dark mode</mat-slide-toggle>',
    '<mat-button-toggle>Bold</mat-button-toggle>',
    '<button mat-menu-item>Rename</button>',
    '<button data-testid="orders-save-button">Save all</button>',
    '<mat-error>Required</mat-error>',
    '<table><tr><td>x</td></tr></table>',
    '<h2 mat-dialog-title>Delete order</h2>',
  ]);
  const locator = (line: number) => one(rows, { line }).recommendedLocator;
  assert.equal(locator(1), 'page.getByRole(\'button\', { name: \'Save\', exact: true })');
  assert.equal(locator(2), 'page.getByRole(\'link\', { name: \'Orders\', exact: true })');
  assert.equal(locator(3), 'page.getByRole(\'checkbox\', { name: \'Remember me\', exact: true })');
  assert.equal(locator(4), 'page.getByRole(\'switch\', { name: \'Dark mode\', exact: true })');
  assert.equal(locator(5), 'page.getByRole(\'button\', { name: \'Bold\', exact: true })', 'a button toggle is a button');
  assert.equal(locator(6), 'page.getByRole(\'menuitem\', { name: \'Rename\', exact: true })');
  assert.equal(locator(7), 'page.getByTestId(\'orders-save-button\')');
  assert.equal(locator(8), 'page.getByText(\'Required\', { exact: true })');
  assert.equal(locator(9), 'page.getByRole(\'table\')');
  assert.equal(locator(10), 'page.getByRole(\'heading\', { name: \'Delete order\', exact: true })');
  for (const row of rows) assert.equal(row.locatorScope, 'page-candidate');
});

test('locator: form controls go by label, because their role depends on the input type', () => {
  const rows = html([
    '<mat-form-field><mat-label>Amount</mat-label><input matInput type="number"></mat-form-field>',
    '<label for="pw">Password</label><input id="pw" type="password">',
    '<mat-form-field><mat-label>Status</mat-label><mat-select></mat-select></mat-form-field>',
  ]);
  assert.equal(one(rows, { line: 1 }).recommendedLocator, 'page.getByLabel(\'Amount\', { exact: true })');
  assert.equal(one(rows, { line: 2 }).recommendedLocator, 'page.getByLabel(\'Password\', { exact: true })');
  assert.equal(one(rows, { line: 3 }).recommendedLocator, 'page.getByLabel(\'Status\', { exact: true })');
});

test('locator: quotes and backslashes in a name are escaped', () => {
  const row = one(html(['<button>It\'s a "C:\\temp" path</button>']), {});
  assert.equal(row.recommendedLocator, 'page.getByRole(\'button\', { name: \'It\\\'s a "C:\\\\temp" path\', exact: true })');
  // the suggestion is valid JavaScript that yields the original name
  const name = new Function(`return ${/name: ('(?:[^'\\]|\\.)*')/.exec(row.recommendedLocator as string)?.[1]}`)() as string;
  assert.equal(name, 'It\'s a "C:\\temp" path');
});

test('locator: none when nothing dependable can be written', () => {
  const rows = html([
    '<button>{{ label }}</button>',
    '<button><mat-icon>add</mat-icon></button>',
    '<span (click)="go()">Go</span>',
    '<button>Save</button>', '<button>Save</button>',
    '<button [attr.data-testid]="testId">Other</button>',
    '<mat-expansion-panel-header>Details</mat-expansion-panel-header>',
  ]);
  for (const row of rows) {
    assert.equal(row.recommendedLocator, undefined, `line ${row.line}`);
    assert.equal(row.locatorScope, 'unknown');
  }
});

test('locator: a translation key is labelled as such, and resolved when a translation file is given', () => {
  const source = ['<button>{{ \'COMMON.SAVE\' | translate }}</button>'];
  const plain = one(html(source), {});
  assert.equal(plain.recommendedLocator, 'page.getByRole(\'button\', { name: \'COMMON.SAVE\', exact: true })');
  assert.match(plain.locatorNote ?? '', /translation key/);
  const root = mkdtempSync(join(tmpdir(), 'testid-scan-loc-'));
  writeFileSync(join(root, 'en.json'), JSON.stringify({ COMMON: { SAVE: 'Save' } }));
  const resolved = one(html(source, { i18nFile: join(root, 'en.json') }), {});
  assert.equal(resolved.recommendedLocator, 'page.getByRole(\'button\', { name: \'Save\', exact: true })');
  assert.equal(resolved.locatorNote, undefined);
});

test('locator: review-required and fix-first suggestions say so', () => {
  const rows = html([
    '<button title="Tip"><mat-icon>x</mat-icon></button>',
    '<button data-testid="BadName">Bad</button>',
    '<button [attr.data-testid]="\'orders-tab-\' + name">Tab</button>',
  ]);
  assert.match(one(rows, { line: 1 }).locatorNote ?? '', /review required/);
  assert.match(one(rows, { line: 2 }).locatorNote ?? '', /fix the test ID first/);
  assert.equal(one(rows, { line: 3 }).recommendedLocator, 'page.getByTestId(\'orders-tab-<name>\')');
  assert.match(one(rows, { line: 3 }).locatorNote ?? '', /replace <\.\.\.>.*review required/);
  assert.equal(one(rows, { line: 1 }).locatorScope, 'unknown');
  assert.equal(one(rows, { line: 2 }).locatorScope, 'page-candidate', 'a badly named ID still finds its element');
  assert.equal(one(rows, { line: 3 }).locatorScope, 'unknown');
  const twice = html(['<button data-testid="orders-go-button">A</button>', '<button data-testid="orders-go-button">B</button>']);
  for (const row of twice) assert.equal(row.locatorScope, 'unknown', 'a duplicated ID does not single out an element');
});

test('placeholders written as translations are recognised in all three frameworks', () => {
  const ng = html(['<input matInput [placeholder]="\'ORDERS.SEARCH\' | translate">', '<textarea placeholder="{{ \'ORDERS.NOTE\' | translate }}"></textarea>']);
  assert.equal(one(ng, { line: 1 }).recommendedLocator, 'page.getByPlaceholder(\'ORDERS.SEARCH\', { exact: true })');
  assert.match(one(ng, { line: 1 }).locatorNote ?? '', /placeholder is a translation key/);
  assert.deepEqual(rules(one(ng, { line: 2 })), ['placeholder-only:confirmed']);
  const vue = scanVue('<template>\n<el-input v-model="u" :placeholder="t(\'login.user\')" />\n</template>');
  assert.equal(one(vue, {}).recommendedLocator, 'page.getByPlaceholder(\'login.user\', { exact: true })');
  const react = scanJsx('export const C = () => <input placeholder={t("search.hint")} />;');
  assert.equal(one(react, {}).recommendedLocator, 'page.getByPlaceholder(\'search.hint\', { exact: true })');
  assert.deepEqual(rules(one(react, {})), ['placeholder-only:confirmed']);
});

// ---------- scope ----------

test('scope: elements in a keyed record are record-scoped and chained to the record; the record itself is a page candidate', () => {
  const rows = html([
    '<table mat-table [dataSource]="rows">',
    '  <ng-container matColumnDef="a"><td mat-cell *matCellDef="let row">',
    '    <button aria-label="Delete">x</button>',
    '    <button data-testid="orders-edit-button">Edit</button>',
    '  </td></ng-container>',
    '  <tr mat-row *matRowDef="let row; columns: cols" [attr.data-testid]="\'orders-row-\' + row.id"></tr>',
    '</table>',
    '<li *ngFor="let o of orders" [attr.data-order-id]="o.id"><a routerLink="/d">Details</a></li>',
    '<li *ngFor="let o of orders"><a routerLink="/e">More</a></li>',
  ]);
  const del = one(rows, { line: 3 });
  assert.equal(del.locatorScope, 'record-scoped');
  assert.equal(del.recommendedLocator, 'page.getByTestId(\'orders-row-<row.id>\').getByRole(\'button\', { name: \'Delete\', exact: true })');
  assert.match(del.locatorNote ?? '', /replace <\.\.\.>/);
  const edit = one(rows, { line: 4 });
  assert.equal(edit.status, 'OK (test ID)', 'the status is unchanged');
  assert.equal(edit.locatorScope, 'record-scoped', 'a fixed ID inside a record is not presented as page-wide');
  assert.equal(edit.recommendedLocator, 'page.getByTestId(\'orders-row-<row.id>\').getByTestId(\'orders-edit-button\')');
  const row = one(rows, { line: 6 });
  assert.equal(row.locatorScope, 'page-candidate');
  assert.equal(row.recommendedLocator, 'page.getByTestId(\'orders-row-<row.id>\')');
  const details = one(rows, { line: 8 });
  assert.equal(details.locatorScope, 'record-scoped');
  assert.equal(details.recommendedLocator, 'page.locator(\'[data-order-id="<value>"]\').getByRole(\'link\', { name: \'Details\', exact: true })');
  const more = one(rows, { line: 9 });
  assert.equal(more.locatorScope, 'unknown');
  assert.match(more.locatorNote ?? '', /matches every record/);
});

test('scope and locators work the same in React and Vue', () => {
  const react = scanJsx([
    'export const C = ({ orders }) => (<table><tbody>',
    '{orders.map((o) => <tr key={o.id} data-testid={`orders-row-${o.id}`}><td><button aria-label="Delete"><XIcon /></button></td></tr>)}',
    '</tbody></table>);',
  ].join('\n'));
  assert.equal(one(react, { tag: 'button' }).recommendedLocator, 'page.getByTestId(\'orders-row-<o.id>\').getByRole(\'button\', { name: \'Delete\', exact: true })');
  assert.equal(one(react, { tag: 'button' }).locatorScope, 'record-scoped');
  assert.equal(one(react, { tag: 'tr' }).recommendedLocator, 'page.getByTestId(\'orders-row-<o.id>\')');
  const vue = scanVue('<template>\n<li v-for="o in orders" :key="o.id" :data-testid="\'orders-item-\' + o.id"><a href="/d">Details</a></li>\n<el-input v-model="q" :label="$t(\'x\')" />\n</template>');
  assert.equal(one(vue, { tag: 'a' }).recommendedLocator, 'page.getByTestId(\'orders-item-<o.id>\').getByRole(\'link\', { name: \'Details\', exact: true })');
  assert.equal(one(vue, { tag: 'a' }).locatorScope, 'record-scoped');
});

// ---------- accessibility findings ----------

test('a11y: a valid test ID does not hide a missing name; the status stays OK (test ID)', () => {
  const rows = html([
    '<button data-testid="orders-create-button"><mat-icon>add</mat-icon></button>',
    '<button data-testid="orders-save-button">Save</button>',
    '<div data-testid="orders-summary-card">not interactive</div>',
    '<tr mat-row *matRowDef="let row; columns: c" [attr.data-testid]="\'orders-row-\' + row.id"></tr>',
    '<mat-spinner data-testid="orders-loading-spinner"></mat-spinner>',
  ]);
  for (const row of rows) assert.equal(row.status, 'OK (test ID)');
  assert.deepEqual(rules(one(rows, { line: 1 })), ['missing-name:confirmed']);
  for (const line of [2, 3, 4, 5]) assert.deepEqual(rules(one(rows, { line })), [], 'no name is required here');
});

test('a11y: placeholder-only fields, clickable elements without a role, nested controls', () => {
  const rows = html([
    '<input placeholder="Search orders">',
    '<input>',
    '<input [placeholder]="hint">',
    '<span (click)="go()">Go</span>',
    '<div (click)="open()" data-testid="orders-open-card">Open</div>',
    '<a routerLink="/o">Orders <button aria-label="Pin"><mat-icon>p</mat-icon></button></a>',
  ]);
  const search = one(rows, { line: 1 });
  assert.equal(search.status, 'OK (name)', 'a test can find it; the missing label is an accessibility finding');
  assert.match(search.reason ?? '', /found by its placeholder/);
  assert.equal(search.locatorScope, 'page-candidate');
  assert.deepEqual(rules(search), ['placeholder-only:confirmed']);
  assert.equal(search.recommendedLocator, 'page.getByPlaceholder(\'Search orders\', { exact: true })');
  assert.match(search.locatorNote ?? '', /no label/);
  assert.deepEqual(rules(one(rows, { line: 2 })), ['missing-name:confirmed']);
  assert.deepEqual(rules(one(rows, { line: 3 })), ['placeholder-only:confirmed'], 'a runtime placeholder is still a placeholder');
  assert.equal(one(rows, { line: 3 }).recommendedLocator, undefined, 'but its text is unknown, so no locator');
  assert.equal(one(rows, { line: 3 }).status, 'Manual review');
  assert.equal(one(rows, { line: 2 }).status, 'Missing name', 'no label and no placeholder is still missing');
  const twice = html(['<input placeholder="Search">', '<input placeholder="Search">']);
  for (const row of twice) assert.equal(row.status, 'Needs test ID', 'the same placeholder twice is not a locator');
  assert.deepEqual(rules(one(rows, { line: 4 })), ['no-role:confirmed']);
  assert.deepEqual(rules(one(rows, { line: 5 })), ['no-role:confirmed'], 'also when it has a test ID');
  assert.deepEqual(rules(one(rows, { line: 6, kind: 'link' })), ['nested-interactive:confirmed']);
});

test('a11y: a runtime name is not reported as missing; an assumption is marked needs-review', () => {
  const dynamic = html(['<button>{{ label }}</button>', '<button [attr.aria-label]="label"><mat-icon>x</mat-icon></button>', '<button title="Tip"><mat-icon>x</mat-icon></button>']);
  assert.deepEqual(rules(one(dynamic, { line: 1 })), []);
  assert.deepEqual(rules(one(dynamic, { line: 2 })), []);
  assert.deepEqual(rules(one(dynamic, { line: 3 })), ['title-only:needs-review']);
  const react = scanJsx('export const C = (p) => <><button><Trash2 /></button><button><TrashIcon /></button><button {...p} /><Card onClick={go}>A</Card></>;');
  assert.deepEqual(react.map(rules), [['missing-name:needs-review'], ['missing-name:confirmed'], [], []]);
});

// ---------- reports ----------

test('reports: counts, the accessibility section, and the optional locator list', () => {
  const root = mkdtempSync(join(tmpdir(), 'testid-scan-rep-'));
  mkdirSync(join(root, 'src', 'orders'), { recursive: true });
  writeFileSync(join(root, 'src', 'orders', 'orders.component.html'), [
    '<button>Save</button>',
    '<button data-testid="orders-create-button"><mat-icon>add</mat-icon></button>',
    '<input placeholder="Search">',
    '<button title="Tip"><mat-icon>x</mat-icon></button>',
  ].join('\n'));
  const result = scan(join(root, 'src'));
  const t = result.totals;
  assert.deepEqual([t.okName, t.okId, t.missingName, t.review, t.todo, t.a11y], [2, 1, 0, 1, 0, 2], 'findings are not part of To do');

  const md = renderMarkdown(result, { detailed: true });
  assert.match(md, /## Accessibility findings/);
  assert.match(md, /### Confirmed in the source \(2\)/);
  assert.match(md, /orders\.component\.html:2 \| button \| OK \(test ID\) \| missing-name: no accessible name/);
  assert.match(md, /orders\.component\.html:3 \| input \| OK \(name\) \| placeholder-only/);
  assert.match(md, /### Rests on an assumption, check before acting \(1\)/);
  assert.doesNotMatch(md, /## Recommended locators/, 'the full list is opt-in');

  const summary = renderMarkdown(result);
  assert.match(summary, /- L2 `<button>` `orders-create-button`: accessibility: no accessible name/, 'a finding on an OK element is listed under it');
  assert.match(summary, /L3 `<input>` placeholder "Search": accessibility: has a placeholder but no label/);
  assert.match(summary, /accessibility, check this: /, 'a finding that rests on an assumption says so');
  assert.doesNotMatch(summary, /## Recommended locators/, 'the full list is opt-in');
  const full = renderMarkdown(result, { locators: true });
  assert.match(full, /## Recommended locators/);
  assert.match(full, /orders\.component\.html:1 \| page-candidate \| `page\.getByRole\('button', \{ name: 'Save', exact: true \}\)`/);
  for (const e of result.elements.filter((x) => x.recommendedLocator)) assert.ok(full.includes(e.recommendedLocator as string), `lists ${e.file}:${e.line}`);

  const json = join(root, 'out.json');
  const run = (...args: string[]) => spawnSync(process.execPath, [cli, join(root, 'src'), '--out', join(root, 'out.md'), '--json', json, ...args, '--format', 'quiet'], { encoding: 'utf8', cwd: root });
  const plain = run();
  assert.match(plain.stdout, /A11y findings=2/);
  assert.equal(run('--fail-on-review').status, 1);
  assert.equal(run('--fail-on-todo').status, 0, 'a placeholder-only field no longer fails the gate');
  assert.equal(run('--locators').status, 0);
  assert.match(readFileSync(join(root, 'out.md'), 'utf8'), /## Recommended locators/);
  const parsed = JSON.parse(readFileSync(json, 'utf8')) as { totals: { a11y: number }; elements: ElementRecord[] };
  assert.equal(parsed.totals.a11y, 2);
  assert.deepEqual(parsed.elements.map((e) => e.locatorScope), ['page-candidate', 'page-candidate', 'page-candidate', 'unknown']);
  assert.equal(parsed.elements[1].accessibilityFindings[0].rule, 'missing-name');
  assert.equal(parsed.elements[0].recommendedLocator, 'page.getByRole(\'button\', { name: \'Save\', exact: true })');
});
