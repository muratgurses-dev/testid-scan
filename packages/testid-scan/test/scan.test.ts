/**
 * Tests run against the TypeScript sources (Node 22.18+):  npm test
 * Each test feeds a small template to the scanner and checks the status it gets.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMarkdown, scan, scanJsx, scanTemplate } from '../src/index.ts';
import type { Config, ElementRecord } from '../src/index.ts';

// the tests run from the TypeScript sources (npm run test:src) or compiled (npm test); start the matching CLI file
const here = fileURLToPath(import.meta.url);
const cli = join(dirname(here), '..', 'src', here.endsWith('.ts') ? 'cli.ts' : 'cli.js');

function html(lines: string[], options: Partial<Config> = {}): ElementRecord[] {
  return scanTemplate(lines.join('\n'), { requireTypeSuffix: true, ...options });
}

/** The single element that matches, so a test fails loudly when the scanner finds none or several. */
function one(rows: ElementRecord[], match: Partial<ElementRecord>): ElementRecord {
  const hits = rows.filter((r) => Object.entries(match).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v));
  assert.equal(hits.length, 1, `expected exactly one element matching ${JSON.stringify(match)}, got ${hits.length}`);
  return hits[0];
}

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'testid-scan-'));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), content);
  }
  return root;
}

// ---------- kinds and roles ----------

test('the tag decides the kind before (click)/(keyup.enter) does', () => {
  const input = one(html(['<input (keyup.enter)="search()" aria-label="Search" />']), { tag: 'input' });
  assert.equal(input.kind, 'input');
  assert.equal(input.status, 'OK (name)');
});

test('clickable elements without a role are not OK by name', () => {
  const rows = html([
    '<div (click)="save()">Save</div>',
    '<mat-icon (click)="remove()">delete</mat-icon>',
    '<a (click)="open()">Open</a>',
    '<div role="button" tabindex="0" (click)="go()">Go</div>',
  ]);
  for (const line of [1, 2, 3]) {
    assert.equal(one(rows, { line }).status, 'Needs test ID');
    assert.match(one(rows, { line }).reason ?? '', /has no role/);
  }
  assert.equal(one(rows, { line: 4 }).status, 'OK (name)');
});

test('custom components and attributes can be mapped in the config', () => {
  const rows = html(
    ['<p-dropdown aria-label="Country"></p-dropdown>', '<span pButton>Save</span>', '<p-dropdown></p-dropdown>'],
    { elements: { 'p-dropdown': 'select' }, attributes: { pButton: 'button' } },
  );
  assert.equal(one(rows, { line: 1 }).kind, 'select');
  assert.equal(one(rows, { line: 1 }).status, 'OK (name)');
  assert.equal(one(rows, { line: 2 }).status, 'OK (name)');
  assert.equal(one(rows, { line: 3 }).status, 'Missing name');
  assert.deepEqual(html(['<p-dropdown aria-label="Country"></p-dropdown>']), [], 'unknown tags are ignored without config');
});

// ---------- accessible names ----------

test('select is named by its label, never by its options', () => {
  const rows = html([
    '<mat-select><mat-option>Open</mat-option><mat-option>Closed</mat-option></mat-select>',
    '<mat-form-field><mat-label>Status</mat-label><mat-select><mat-option>Draft</mat-option></mat-select></mat-form-field>',
  ]);
  assert.equal(one(rows, { tag: 'mat-select', line: 1 }).status, 'Missing name');
  assert.equal(one(rows, { tag: 'mat-select', line: 2 }).label, 'Status');
  assert.equal(one(rows, { tag: 'mat-select', line: 2 }).status, 'OK (name)');
});

test('labels: wrapping <label>, <label for>, aria-labelledby; a placeholder locates but does not name', () => {
  const rows = html([
    '<label>Email <input type="text" /></label>',
    '<label for="phone">Phone</label><input id="phone" />',
    '<h2 id="dlg">Delete order</h2><button aria-labelledby="dlg"><mat-icon>delete</mat-icon></button>',
    '<button aria-labelledby="missing">x</button>',
    '<input placeholder="Search" />',
  ]);
  assert.equal(one(rows, { line: 1 }).label, 'Email');
  assert.equal(one(rows, { line: 2 }).label, 'Phone');
  assert.equal(one(rows, { line: 3 }).label, 'Delete order');
  assert.equal(one(rows, { line: 3 }).status, 'OK (name)');
  assert.equal(one(rows, { line: 4 }).status, 'Manual review');
  assert.equal(one(rows, { line: 5 }).status, 'OK (name)', 'found by its placeholder');
  assert.equal(one(rows, { line: 5 }).label, '', 'but the placeholder is not reported as its name');
});

test('content beats title; title-only name needs review; tooltip and icon text are not names', () => {
  const rows = html([
    '<button title="Tooltip">Apply</button>',
    '<button title="Only title"><mat-icon>edit</mat-icon></button>',
    '<button mat-icon-button matTooltip="Delete"><mat-icon>delete</mat-icon></button>',
  ]);
  assert.equal(one(rows, { line: 1 }).label, 'Apply');
  assert.equal(one(rows, { line: 1 }).status, 'OK (name)');
  assert.equal(one(rows, { line: 2 }).status, 'Manual review');
  assert.equal(one(rows, { line: 3 }).status, 'Missing name');
});

test('aria-hidden content is not part of the name', () => {
  const rows = html([
    '<button><span aria-hidden="true">×</span> Close</button>',
    '<button><span aria-hidden="true">×</span></button>',
  ]);
  assert.equal(one(rows, { line: 1 }).label, 'Close');
  assert.equal(one(rows, { line: 2 }).status, 'Missing name');
});

test('dynamic text needs review; an interpolation inside an attribute does not make the text dynamic', () => {
  const rows = html([
    '<button>Hello {{ name }}</button>',
    '<button><span class="{{ cls }}">Save</span></button>',
    '<button>@if (editing) { Update } @else { Create }</button>',
  ]);
  assert.equal(one(rows, { line: 1 }).status, 'Manual review');
  assert.equal(one(rows, { line: 2 }).status, 'OK (name)');
  assert.equal(one(rows, { line: 3 }).status, 'Manual review');
});

test('"<" inside expressions does not swallow the next element', () => {
  const rows = html(['<span>{{a<b}}</span><button>After</button>', '@if (count<max) { <button>More</button> }']);
  assert.equal(one(rows, { label: 'After' }).status, 'OK (name)');
  assert.equal(one(rows, { label: 'More' }).status, 'OK (name)');
});

test('duplicate names in one template need a test ID, even if one of them already has one', () => {
  assert.deepEqual(html(['<button>Save</button>', '<button>Save</button>']).map((r) => r.status), ['Needs test ID', 'Needs test ID']);
  const mixed = html(['<button data-testid="orders-save-button">Save</button>', '<button>Save</button>']);
  assert.equal(one(mixed, { line: 2 }).status, 'Needs test ID');
});

// ---------- translations ----------

test('translated literal is a static name shown by its key; parameters make it dynamic', () => {
  const rows = html([
    '<button>{{ \'COMMON.CANCEL\' | translate }}</button>',
    '<button [attr.aria-label]="\'COMMON.CLOSE\' | translate"><mat-icon>close</mat-icon></button>',
    '<button>{{ \'ORDERS.DELETE\' | translate: { id: order.id } }}</button>',
    '<button>{{ \'COMMON.SAVE\' | t }}</button>',
  ]);
  assert.equal(one(rows, { line: 1 }).label, 'COMMON.CANCEL');
  assert.deepEqual(one(rows, { line: 1 }).translationKeys, ['COMMON.CANCEL']);
  assert.equal(one(rows, { line: 1 }).status, 'OK (name)');
  assert.equal(one(rows, { line: 2 }).status, 'OK (name)');
  assert.equal(one(rows, { line: 3 }).status, 'Manual review');
  assert.equal(one(rows, { line: 4 }).status, 'Manual review', 'unknown pipe is not a translation');
  assert.equal(one(html(['<button>{{ \'COMMON.SAVE\' | t }}</button>'], { translatePipes: ['t'] }), {}).status, 'OK (name)');
});

test('with an i18n file: keys are resolved, missing keys and equal texts are reported', () => {
  const root = project({ 'en.json': JSON.stringify({ COMMON: { OK: 'OK', CONFIRM: 'OK', CLOSE: 'Close' } }) });
  const rows = html([
    '<button>{{ \'COMMON.CLOSE\' | translate }}</button>',
    '<button>{{ \'COMMON.OK\' | translate }}</button>',
    '<button>{{ \'COMMON.CONFIRM\' | translate }}</button>',
    '<button>{{ \'COMMON.NOPE\' | translate }}</button>',
  ], { i18nFile: join(root, 'en.json') });
  assert.equal(one(rows, { line: 1 }).label, 'Close');
  assert.deepEqual(one(rows, { line: 1 }).translationKeys, ['COMMON.CLOSE']);
  assert.equal(one(rows, { line: 2 }).status, 'Needs test ID', 'two keys with the same text collide');
  assert.equal(one(rows, { line: 3 }).status, 'Needs test ID');
  assert.equal(one(rows, { line: 4 }).status, 'Manual review');
  assert.match(one(rows, { line: 4 }).reason ?? '', /COMMON\.NOPE/);
});

// ---------- test ID naming ----------

test('naming rules are checked on any element that carries a test ID', () => {
  const rows = html([
    '<div data-testid="BadName">x</div>',
    '<mat-card data-testid="orders-summary-card"></mat-card>',
    '<button data-testid="save">Save</button>',
    '<button data-testid="orders-save">Save all</button>',
    '<button data-testid="orders-orders-button">Orders</button>',
    '<button data-testid="">Empty</button>',
  ]);
  assert.deepEqual(one(rows, { line: 1 }).violations, ['not kebab-case', 'type suffix']);
  assert.deepEqual(one(rows, { line: 2 }).violations, []);
  assert.deepEqual(one(rows, { line: 3 }).violations, ['too short (expected <context>-<type>)', 'type suffix']);
  assert.deepEqual(one(rows, { line: 4 }).violations, ['type suffix']);
  assert.deepEqual(one(rows, { line: 5 }).violations, ['repeated word']);
  assert.deepEqual(one(rows, { line: 6 }).violations, ['empty test ID']);
  assert.equal(one(rows, { line: 6 }).status, 'OK (name)', 'an empty test ID does not count as a test ID');
});

test('prefixes, suffix list and test ID attribute are configurable', () => {
  const rows = html(['<button data-cy="app-save-btn">Save</button>', '<button data-cy="shop-open-btn">Open</button>'],
    { testIdAttribute: 'data-cy', prefixes: ['app'], suffixes: ['btn'] });
  assert.deepEqual(one(rows, { line: 1 }).violations, []);
  assert.equal(one(rows, { line: 1 }).status, 'OK (test ID)');
  assert.deepEqual(one(rows, { line: 2 }).violations, ['prefix (expected app)']);
  assert.equal(html(['<button data-testid="x-save-button">Save</button>'], { testIdAttribute: 'data-cy' })[0].testId, undefined);
});

test('suffix must fit the element it is on', () => {
  const rows = html([
    '<button data-testid="orders-save-table">Save</button>',
    '<button data-testid="orders-actions-menu-button">Actions</button>',
    '<input data-testid="orders-due-date" aria-label="Due" />',
    '<div data-testid="orders-summary-table">not a known kind, so not checked</div>',
  ]);
  assert.match(one(rows, { line: 1 }).violations.join(), /suffix "-table" does not fit a button/);
  assert.deepEqual(one(rows, { line: 2 }).violations, []);
  assert.deepEqual(one(rows, { line: 3 }).violations, []);
  assert.deepEqual(one(rows, { line: 4 }).violations, []);
  assert.deepEqual(html(['<button data-testid="orders-save-table">Save</button>'], { checkSuffixMatchesKind: false })[0].violations, []);
});

test('the same fixed test ID twice in a template is a violation', () => {
  const rows = html(['<button data-testid="orders-save-button">Save</button>', '<button data-testid="orders-save-button">Save draft</button>']);
  for (const row of rows) assert.deepEqual(row.violations, ['duplicate in template']);
});

// ---------- repeated elements and dynamic test IDs ----------

test('dynamic test IDs: every way of writing one is read, and the fixed part is checked', () => {
  const rows = html([
    '<li *ngFor="let order of orders; let i = index">',
    '  <button data-testid="orders-open-button-{{ order.id }}">Open</button>',
    '  <button [attr.data-testid]="\'orders-edit-button-\' + order.id">Edit</button>',
    '  <button [attr.data-testid]="`orders-copy-button-${order.id}`">Copy</button>',
    '  <button [attr.data-testid]="\'orders-move-button-\' + i">Move</button>',
    '  <button [attr.data-testid]="\'orders-print-button-\' + page">Print</button>',
    '  <button [attr.data-testid]="\'Orders_Del_\' + order.id">Delete</button>',
    '  <button [attr.data-testid]="testId">Other</button>',
    '</li>',
    '<button [attr.data-testid]="\'orders-tab-\' + name">Tab</button>',
    '<button [attr.data-testid]="\'orders-add-button\'">Add</button>',
  ]);
  for (const line of [2, 3, 4]) {
    assert.equal(one(rows, { line }).testIdKind, 'dynamic');
    assert.equal(one(rows, { line }).status, 'OK (test ID)');
    assert.match(one(rows, { line }).reason ?? '', /order\.id/);
    assert.deepEqual(one(rows, { line }).violations, [], 'no separate data-<entity>-id is demanded when the ID contains the record');
  }
  assert.match(one(rows, { line: 5 }).reason ?? '', /index-based/);
  assert.match(one(rows, { line: 6 }).reason ?? '', /does not use the loop record/);
  assert.deepEqual(one(rows, { line: 7 }).violations, ['not kebab-case', 'type suffix']);
  assert.equal(one(rows, { line: 8 }).testIdKind, 'opaque');
  for (const line of [5, 6, 8, 10]) assert.equal(one(rows, { line }).status, 'Manual review');
  assert.equal(one(rows, { line: 11 }).testIdKind, 'static', 'a bound literal is a fixed ID');
  assert.equal(one(rows, { line: 11 }).testId, 'orders-add-button');
  assert.equal(one(rows, { line: 11 }).status, 'OK (test ID)');
});

test('a fixed test ID inside a loop needs a record key on it or around it', () => {
  const bare = html(['<li *ngFor="let o of orders"><button data-testid="orders-open-button">Open</button></li>']);
  assert.match(one(bare, { tag: 'button' }).violations.join(), /same test ID on every repeated element/);
  const keyed = html(['<li *ngFor="let o of orders" [attr.data-order-id]="o.id"><button data-testid="orders-open-button">Open</button><a routerLink="x">Details</a></li>']);
  assert.deepEqual(one(keyed, { tag: 'button' }).violations, []);
  assert.equal(one(keyed, { tag: 'button' }).status, 'OK (test ID)');
  assert.equal(one(keyed, { tag: 'a' }).status, 'OK (name)', 'a named element in a keyed record can be scoped');
  const unkeyed = html(['@for (o of orders; track o.id) { <a routerLink="x">Details</a> }']);
  assert.equal(one(unkeyed, { tag: 'a' }).repeated, true);
  assert.equal(one(unkeyed, { tag: 'a' }).status, 'Manual review');
});

test('tables: cell content is repeated, a clickable row stays a row, a keyed row makes its cells scopable', () => {
  const table = (rowAttrs: string) => [
    '<table mat-table [dataSource]="rows">',
    '  <ng-container matColumnDef="actions">',
    '    <th mat-header-cell *matHeaderCellDef>Actions</th>',
    '    <td mat-cell *matCellDef="let row"><button aria-label="Delete">x</button></td>',
    '  </ng-container>',
    `  <tr mat-row *matRowDef="let row; columns: cols" (click)="open(row)" ${rowAttrs}></tr>`,
    '</table>',
  ];
  const plain = html(table(''));
  assert.equal(one(plain, { tag: 'button' }).repeated, true);
  assert.equal(one(plain, { tag: 'button' }).status, 'Manual review');
  assert.equal(one(plain, { tag: 'tr' }).kind, 'row');
  assert.equal(one(plain, { tag: 'tr' }).status, 'Needs test ID');
  assert.equal(one(plain, { tag: 'table' }).status, 'OK (name)');
  const keyed = html(table('[attr.data-testid]="\'orders-row-\' + row.id"'));
  assert.equal(one(keyed, { tag: 'tr' }).status, 'OK (test ID)');
  assert.equal(one(keyed, { tag: 'button' }).status, 'OK (name)');
  const attrKeyed = html(table('[attr.data-order-id]="row.id"'));
  assert.equal(one(attrKeyed, { tag: 'tr' }).status, 'OK (test ID)');
});

// ---------- review marker, strict ----------

test('a reviewed marker acknowledges manual review only; it never hides a to-do or a violation', () => {
  const rows = html([
    '<!-- testid-scan: reviewed -->',
    '<button>{{ title }}</button>',
    '<!-- testid-scan: reviewed -->',
    '<button><mat-icon>add</mat-icon></button>',
    '<!-- testid-scan: reviewed -->',
    '<button [attr.data-testid]="\'Bad_\' + id">Go</button>',
  ]);
  assert.equal(one(rows, { line: 2 }).status, 'OK (reviewed)');
  assert.match(one(rows, { line: 2 }).reason ?? '', /not verified by the scanner/);
  assert.equal(one(rows, { line: 4 }).status, 'Missing name');
  assert.equal(one(rows, { line: 6 }).status, 'OK (reviewed)');
  assert.ok(one(rows, { line: 6 }).violations.length > 0);
});

test('strict asks for a test ID on every element', () => {
  assert.equal(html(['<button>Save</button>'], { strict: true })[0].status, 'Needs test ID');
});

// ---------- folders, inline templates, reports ----------

test('discovery: other HTML files are listed, inline templates are scanned with correct line numbers', () => {
  const root = project({
    'src/l/l.component.html': '<button>One</button>\n',
    'src/m/widget.html': '<button>Two</button>\n',
    'src/n/n.component.ts': '@Component({\n  selector: \'x\',\n  template: `\n    <button>Three</button>\n    <button><mat-icon>add</mat-icon></button>\n  `,\n})\nexport class X {}\n',
    'src/o/o.component.ts': '@Component({ template: `<p>${NOT_STATIC}</p><button>Four</button>` })\nexport class O {}\n',
    'src/node_modules/pkg/p.component.html': '<button>Ignored</button>\n',
  });
  const result = scan(join(root, 'src'));
  assert.deepEqual(result.files.map((f) => f.file), ['l/l.component.html', 'n/n.component.ts']);
  assert.equal(one(result.elements, { label: 'Three' }).line, 4);
  assert.equal(one(result.elements, { file: 'n/n.component.ts', status: 'Missing name' }).line, 5);
  assert.deepEqual(result.notScanned.otherHtml, ['m/widget.html']);
  assert.deepEqual(result.notScanned.unreadable.map((i) => i.file), ['o/o.component.ts']);
  assert.equal(scan(join(root, 'src'), { allHtml: true }).files.length, 3);
  const off = scan(join(root, 'src'), { inlineTemplates: false });
  assert.equal(off.files.length, 1);
  assert.equal(off.notScanned.unreadable.length, 2);
});

test('the same fixed test ID in two files is listed separately, not as a violation', () => {
  const root = project({
    'a/a.component.html': '<button data-testid="orders-save-button">Save</button>\n',
    'b/b.component.html': '<button data-testid="orders-save-button">Save</button>\n<button data-testid="orders-open-button">Open</button>\n',
  });
  const result = scan(root);
  assert.deepEqual(result.sharedTestIds, [{ testId: 'orders-save-button', locations: ['a/a.component.html:1', 'b/b.component.html:1'] }]);
  assert.equal(result.totals.violations, 0);
});

test('Markdown report and result agree', () => {
  const root = project({
    'orders/list/list.component.html': [
      '<button>Save</button>', '<button>Save</button>', '<button><mat-icon>add</mat-icon></button>',
      '<button data-testid="Bad">Bad</button>', '<button>{{ label }}</button>', '<button data-testid="orders-ok-button">Fine</button>',
    ].join('\n'),
  });
  const result = scan(root);
  const t = result.totals;
  assert.deepEqual([t.elements, t.okId, t.okName, t.needsId, t.missingName, t.fixId, t.todo, t.violations, t.review], [6, 1, 0, 2, 1, 1, 4, 1, 1]);
  assert.equal(t.okId + t.okName + t.reviewed + t.todo + t.review, t.elements, 'every element has exactly one status');
  const md = renderMarkdown(result);
  assert.match(md, /\| 1 \| 6 \| 1 \| 0 \| 0 \| 2 \| 1 \| 1 \| 4 \| 1 \| 1 \|/);
  assert.match(md, /\| orders \| orders\/list\/list\.component\.html \|/);
  for (const e of result.elements.filter((x) => x.status !== 'OK (test ID)' || x.violations.length)) {
    assert.ok(md.includes(`${e.file}:${e.line} |`), `report lists ${e.file}:${e.line}`);
  }
});

test('command line: exit codes, JSON output, config file, usage errors', () => {
  const root = project({
    'review/r.component.html': '<button>{{ label }}</button>\n',
    'todo/t.component.html': '<button><mat-icon>add</mat-icon></button>\n',
    'cfg.json': JSON.stringify({ testIdAttribute: 'data-cy', suffixes: ['btn'] }),
    'cy/c.component.html': '<button data-cy="app-save-btn">Save</button>\n',
  });
  const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args, '--out', join(root, 'out.md'), '--format', 'quiet'], { encoding: 'utf8', cwd: root });
  assert.equal(run(join(root, 'review'), '--fail-on-todo').status, 0);
  assert.equal(run(join(root, 'review'), '--fail-on-review').status, 1);
  assert.equal(run(join(root, 'todo'), '--fail-on-todo').status, 1);
  assert.equal(run(join(root, 'todo')).status, 0);
  assert.equal(run(join(root, 'missing-folder')).status, 2);
  assert.equal(run(join(root, 'todo'), '--nope').status, 2);
  assert.equal(run().status, 2);

  const json = join(root, 'out.json');
  const withConfig = run(join(root, 'cy'), '--config', join(root, 'cfg.json'), '--json', json, '--fail-on-todo');
  assert.equal(withConfig.status, 0, withConfig.stderr);
  const parsed = JSON.parse(readFileSync(json, 'utf8')) as { totals: { okId: number }; elements: ElementRecord[] };
  assert.equal(parsed.totals.okId, 1);
  assert.equal(parsed.elements[0].testId, 'app-save-btn');
  assert.match(readFileSync(join(root, 'out.md'), 'utf8'), /# Test ID Status/);
  assert.equal(run(join(root, 'cy'), '--config', join(root, 'nope.json')).status, 2);
});

// ---------- reliability of a test ID, nesting, review fingerprints ----------

test('a test ID that breaks a rule is "Fix test ID", never OK', () => {
  const rows = html([
    '<button data-testid="orders-save-button">Save</button>',
    '<button data-testid="orders-save-button">Save draft</button>',
    '<button data-testid="BadName">Open</button>',
    '<li *ngFor="let o of orders"><button data-testid="orders-open-button">Go</button></li>',
    '<li *ngFor="let o of orders"><button [attr.data-testid]="\'Orders_\' + o.id">Edit</button></li>',
    '<button data-testid="orders-close-button">Close</button>',
  ]);
  for (const line of [1, 2, 3, 4, 5]) assert.equal(one(rows, { line }).status, 'Fix test ID');
  assert.match(one(rows, { line: 1 }).reason ?? '', /duplicate in template/);
  assert.equal(one(rows, { line: 6 }).status, 'OK (test ID)');
  const root = project({ 'a/a.component.html': '<button data-testid="BadName">Open</button>\n' });
  const run = (...args: string[]) => spawnSync(process.execPath, [cli, root, '--out', join(root, 'out.md'), ...args, '--format', 'quiet'], { encoding: 'utf8', cwd: root });
  assert.equal(run('--fail-on-todo').status, 1);
  assert.match(run().stdout, /Fix test ID=1; To do=1; Violations=1/);
});

test('nested loops: the test ID has to change with the innermost loop', () => {
  const rows = html([
    '<section *ngFor="let group of groups">',
    '  @for (item of group.items; track item.id; let i = $index) {',
    '    <button [attr.data-testid]="\'orders-open-button-\' + item.id">Open</button>',
    '    <button [attr.data-testid]="\'orders-edit-button-\' + group.id + \'-\' + item.id">Edit</button>',
    '    <button [attr.data-testid]="\'orders-move-button-\' + group.id">Move</button>',
    '    <button [attr.data-testid]="\'orders-sort-button-\' + i">Sort</button>',
    '  }',
    '  <button [attr.data-testid]="\'orders-add-button-\' + group.id">Add</button>',
    '</section>',
    '@for (group of groups; track group.id) {',
    '  <li *ngFor="let item of group.items"><button [attr.data-testid]="\'orders-copy-button-\' + group.id">Copy</button></li>',
    '}',
  ]);
  for (const line of [3, 4, 8]) assert.equal(one(rows, { line }).status, 'OK (test ID)');
  assert.match(one(rows, { line: 5 }).reason ?? '', /outer loop only/);
  assert.match(one(rows, { line: 6 }).reason ?? '', /index-based/);
  assert.match(one(rows, { line: 11 }).reason ?? '', /outer loop only/, 'a block loop outside an element loop is the outer one');
});

test('an interactive element inside a button or link needs review; a row or a tab may contain buttons', () => {
  const rows = html([
    '<a routerLink="/orders">Orders <button aria-label="Pin"><mat-icon>push_pin</mat-icon></button></a>',
    '<button>Plain <span>text</span></button>',
    '<a routerLink="/x" data-testid="orders-all-link">All <button aria-label="Star"><mat-icon>star</mat-icon></button></a>',
    '<mat-tab label="Details"><button>Inside a tab</button></mat-tab>',
  ]);
  assert.equal(one(rows, { line: 1, kind: 'link' }).status, 'Manual review');
  assert.match(one(rows, { line: 1, kind: 'link' }).reason ?? '', /contains another interactive element \(<button>\)/);
  assert.equal(one(rows, { line: 1, kind: 'button' }).status, 'OK (name)');
  assert.equal(one(rows, { line: 2 }).status, 'OK (name)');
  assert.equal(one(rows, { line: 3, kind: 'link' }).status, 'OK (test ID)', 'a test ID is not affected by the name');
  assert.equal(one(rows, { line: 4, kind: 'tab' }).status, 'OK (name)');
});

test('statically hidden content is not part of the name; [hidden] makes it conditional', () => {
  const rows = html([
    '<button><span hidden>Old label</span> Save</button>',
    '<button><span hidden>Only hidden</span></button>',
    '<button><span [hidden]="busy">Send</span></button>',
    '<button><span class="cdk-visually-hidden">Close dialog</span><mat-icon>close</mat-icon></button>',
  ]);
  assert.equal(one(rows, { line: 1 }).label, 'Save');
  assert.equal(one(rows, { line: 2 }).status, 'Missing name');
  assert.equal(one(rows, { line: 3 }).status, 'Manual review');
  assert.equal(one(rows, { line: 4 }).label, 'Close dialog', 'visually hidden text is still read out');
});

test('a reviewed marker with a fingerprint goes out of date when the element changes', () => {
  const fingerprint = one(html(['<button>{{ title }}</button>']), {}).fingerprint as string;
  assert.match(fingerprint, /^[0-9a-f]{8}$/);
  const marked = (element: string, mark = fingerprint) => one(html([`<!-- testid-scan: reviewed ${mark} -->`, element]), {});
  assert.equal(marked('<button>{{ title }}</button>').status, 'OK (reviewed)');
  assert.equal(one(html(['', '', `<!-- testid-scan: reviewed ${fingerprint} -->`, '<button  class="x">{{ title }}</button>']), {}).status,
    'OK (reviewed)', 'moving or restyling the element does not change the fingerprint');
  const changed = marked('<button>{{ title }} now</button>');
  assert.equal(changed.status, 'Manual review');
  assert.match(changed.reason ?? '', /reviewed marker is out of date/);
  assert.match(changed.reason ?? '', new RegExp(`write ${changed.fingerprint}`));
  const bare = marked('<button>{{ title }}</button>', '');
  assert.equal(bare.status, 'OK (reviewed)', 'a marker without a fingerprint still works');
  assert.match(bare.reason ?? '', new RegExp(`add ${fingerprint} to detect later changes`));
  assert.equal(one(html(['<button>Save</button>']), {}).fingerprint, undefined, 'only review items carry one');
});

test('a name that is part of another name is OK only with exact: true', () => {
  const rows = html(['<button>Save</button>', '<button>Save draft</button>', '<a routerLink="/x">Save</a>', '<button>Cancel</button>']);
  assert.equal(one(rows, { line: 1 }).status, 'OK (name)');
  assert.match(one(rows, { line: 1 }).reason ?? '', /exact: true.*"Save draft"/);
  assert.equal(one(rows, { line: 2 }).reason, undefined, 'the longer name is not ambiguous');
  assert.equal(one(rows, { line: 3 }).reason, undefined, 'a link is a different role');
  assert.equal(one(rows, { line: 4 }).reason, undefined);
  const jsx = scanJsx('export const C = () => <><button>Delete</button><button>delete all</button></>;');
  assert.match(one(jsx, { label: 'Delete' }).reason ?? '', /exact: true/);
});

// ---------- found by running on real projects ----------

test('an image names the link or button around it through its alt text', () => {
  const rows = html([
    '<a href="https://example.org"><img src="a.png" alt="Buy me a coffee"></a>',
    '<a href="/x"><img src="a.png" alt></a>',
    '<button><img src="a.png" [alt]="caption"></button>',
    '<a href="/profile"><img alt src="avatar.png"> Dino</a>',
  ]);
  assert.equal(one(rows, { line: 1 }).label, 'Buy me a coffee');
  assert.equal(one(rows, { line: 1 }).status, 'OK (name)');
  assert.equal(one(rows, { line: 2 }).status, 'Missing name');
  assert.equal(one(rows, { line: 3 }).status, 'Manual review');
  assert.equal(one(rows, { line: 4 }).label, 'Dino');
});

test('an .html file named by templateUrl is scanned whatever it is called', () => {
  const root = project({
    'src/orders/orders.ts': '@Component({ selector: \'app-orders\', templateUrl: \'./orders.html\' })\nexport class Orders {}\n',
    'src/orders/orders.html': '<button>Refresh</button>\n',
    'src/shared/card.ts': '@Component({ selector: \'app-card\', templateUrl: "../views/card-view.html" })\nexport class Card {}\n',
    'src/views/card-view.html': '<button>Open</button>\n',
    'src/static/terms.html': '<button>Not a template</button>\n',
  });
  const result = scan(join(root, 'src'));
  assert.deepEqual(result.files.map((f) => f.file), ['orders/orders.html', 'views/card-view.html']);
  assert.deepEqual(result.notScanned.otherHtml, ['static/terms.html']);
});

test('a progress indicator with a name is located by it', () => {
  const rows = html(['<mat-progress-spinner aria-label="Loading orders"></mat-progress-spinner>', '<mat-spinner></mat-spinner>']);
  assert.equal(one(rows, { line: 1 }).status, 'OK (name)');
  assert.equal(one(rows, { line: 2 }).status, 'Needs test ID');
});

test('found in a running app: Angular Material before 15 renders a placeholder as the label', () => {
  const field = ['<mat-form-field><input matInput placeholder="Username"></mat-form-field>', '<input placeholder="Outside a form field">'];
  const legacy = html(field, { placeholderAsLabel: 'always' });
  assert.equal(one(legacy, { line: 1 }).status, 'OK (name)');
  assert.equal(one(legacy, { line: 1 }).recommendedLocator, 'page.getByLabel(\'Username\', { exact: true })');
  assert.deepEqual(one(legacy, { line: 1 }).accessibilityFindings, []);
  assert.equal(one(legacy, { line: 2 }).recommendedLocator, 'page.getByPlaceholder(\'Outside a form field\', { exact: true })', 'only inside a form field');
  const modern = html(field);
  assert.equal(one(modern, { line: 1 }).label, '');
  assert.equal(one(modern, { line: 1 }).recommendedLocator, 'page.getByPlaceholder(\'Username\', { exact: true })');
  assert.equal(one(modern, { line: 1 }).accessibilityFindings[0].rule, 'placeholder-only');

  const files = { 'src/a/a.component.html': `${field[0]}\n` };
  const old = project({ ...files, 'package.json': JSON.stringify({ dependencies: { '@angular/core': '~12.2.6', '@angular/material': '~12.2.6' } }) });
  assert.equal(scan(join(old, 'src')).elements[0].label, 'Username', 'read from package.json');
  const current = project({ ...files, 'package.json': JSON.stringify({ dependencies: { '@angular/core': '^20.0.0', '@angular/material': '^20.0.0' } }) });
  assert.equal(scan(join(current, 'src')).elements[0].label, '');
  assert.equal(scan(join(current, 'src'), { placeholderAsLabel: 'always' }).elements[0].label, 'Username', 'the option overrides the version');
});

test('found in a running app: the same validation message on several fields is not a unique locator', () => {
  const rows = html([
    '<mat-error *ngIf="a.invalid">Please provide value</mat-error>',
    '<mat-error *ngIf="b.invalid">Please provide value</mat-error>',
    '<mat-error *ngIf="c.invalid">Name is too short</mat-error>',
  ]);
  assert.equal(one(rows, { line: 1 }).status, 'Needs test ID');
  assert.equal(one(rows, { line: 2 }).recommendedLocator, undefined);
  assert.equal(one(rows, { line: 3 }).recommendedLocator, 'page.getByText(\'Name is too short\', { exact: true })');
});

test('JSON names the Angular selectors of each template, so a browser tool can map elements back to files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'testid-sel-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { '@angular/core': '19' } }));
  mkdirSync(join(dir, 'home'));
  writeFileSync(join(dir, 'home', 'home.component.ts'), "@Component({ selector: 'app-home', templateUrl: './home.component.html' }) export class HomeComponent {}");
  writeFileSync(join(dir, 'home', 'home.component.html'), '<button (click)="x()">Save</button>');
  const result = scan(dir);
  assert.deepEqual(result.files.map((f) => [f.file, f.selectors]), [['home/home.component.html', ['app-home']]]);
});
