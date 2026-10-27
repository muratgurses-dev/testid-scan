import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compareWithBaseline, createBaseline, renderGithub, renderMarkdown, renderText, scan, scanTemplate } from '../src/index.ts';

const here = fileURLToPath(import.meta.url);
const cli = join(dirname(here), '..', 'src', here.endsWith('.ts') ? 'cli.ts' : 'cli.js');

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'testid-out-'));
  for (const [name, text] of Object.entries(files)) { mkdirSync(dirname(join(root, name)), { recursive: true }); writeFileSync(join(root, name), text); }
  return root;
}
const TWO = '<button>Save</button>\n<button>Save</button>\n<button><mat-icon>add</mat-icon></button>\n';

test('the type suffix convention is off unless asked for; other naming rules stay on', () => {
  const src = '<button data-testid="save">Save</button>\n<button data-testid="BadName">Open</button>';
  assert.deepEqual(scanTemplate(src).map((e) => e.status), ['OK (test ID)', 'Fix test ID']);
  assert.deepEqual(scanTemplate(src, { requireTypeSuffix: true }).map((e) => e.status), ['Fix test ID', 'Fix test ID']);
});

test('terminal output: to-dos by file and line, then the counts', () => {
  const result = scan(project({ 'a/a.component.html': TWO }), { framework: 'angular' });
  const text = renderText(result, { pathPrefix: 'src/' });
  assert.match(text, /^src\/a\/a\.component\.html\n\s+1 {2}Needs test ID {2}button "Save": name "Save" appears more than once/);
  assert.match(text, /\n\s+3 {2}Missing name {3}button \(no name\)/);
  assert.match(text, /3 to do · 0 to review · 0 ok · 0 test ID violations · 1 file$/);
  assert.equal(result.schemaVersion, 1);
});

test('a to-do that is rendered once and has a fixed name gets a suggested test ID', () => {
  const rows = scanTemplate('<button>Save order</button>\n<a href="/x">Help</a>\n<a href="/y">Help</a>', { prefixes: ['orders'], strict: true });
  assert.deepEqual(rows.map((e) => e.suggestedTestId), ['orders-save-order-button', undefined, undefined], 'no suggestion that would repeat an ID');
});

test('baseline: known findings are accepted, new ones are listed, moved code is not new', () => {
  const root = project({ 'a/a.component.html': TWO });
  const baseline = createBaseline(scan(root, { framework: 'angular' }));
  writeFileSync(join(root, 'a/a.component.html'), `<p>moved down</p>\n${TWO}<a href="/x"><mat-icon>x</mat-icon></a>\n`);
  const next = scan(root, { framework: 'angular' });
  const diff = compareWithBaseline(next, baseline);
  assert.deepEqual(diff.added.map((e) => [e.line, e.kind, e.status]), [[5, 'link', 'Missing name']]);
  assert.equal(diff.resolved, 0);
  assert.match(renderMarkdown(next, { baseline: diff }), /\*\*1 new\*\*, 0 resolved\. To do 3 → 4 \(\+1\)/);
  assert.match(renderGithub(next, { baseline: diff, pathPrefix: 'src/' }), /^::warning file=src\/a\/a\.component\.html,line=5,title=testid-scan%3A Missing name::link \(no name\)/);
  writeFileSync(join(root, 'a/a.component.html'), '<button>Save</button>\n');
  assert.equal(compareWithBaseline(scan(root, { framework: 'angular' }), baseline).resolved, 3);
});

test('command line: --baseline makes the gate fail on new findings only', () => {
  const root = project({ 'src/a.component.html': TWO });
  const run = (...args: string[]) => spawnSync(process.execPath, [cli, 'src', '--framework', 'angular', '--out', join(root, 'out.md'), ...args], { encoding: 'utf8', cwd: root });
  assert.equal(run('--fail-on-todo').status, 1);
  assert.equal(run('--baseline', 'base.json', '--fail-on-todo').status, 2, 'a missing baseline is an error, not a pass');
  assert.equal(run('--baseline', 'base.json', '--update-baseline').status, 0);
  assert.equal((JSON.parse(readFileSync(join(root, 'base.json'), 'utf8')) as { schemaVersion: number }).schemaVersion, 1);
  const same = run('--baseline', 'base.json', '--fail-on-todo');
  assert.equal(same.status, 0);
  assert.match(same.stdout, /0 new to do, 0 new to review, 0 resolved/);
  writeFileSync(join(root, 'src/a.component.html'), `${TWO}<button><mat-icon>x</mat-icon></button>\n`);
  const worse = run('--baseline', 'base.json', '--fail-on-todo');
  assert.equal(worse.status, 1);
  assert.match(worse.stdout, /src\/a\.component\.html\n\s+4 {2}Missing name/);
  assert.doesNotMatch(worse.stdout, /\n\s+1 {2}Needs test ID/);
});

test('report: a repeated element that cannot be scoped does not show its locator as if it were unique', () => {
  const src = '<table>\n  <tr *ngFor="let o of orders">\n    <td><button (click)="open(o)">Open</button></td>\n  </tr>\n</table>\n';
  const md = renderMarkdown(scan(project({ 'a/a.component.html': src }), { framework: 'angular' }), { detailed: true });
  const line = md.split('\n').find((l) => l.includes('a/a.component.html:3') && l.includes('fingerprint'));
  assert.ok(line, 'the button is under Manual review');
  assert.match(line, /`page\.getByRole\('button', \{ name: 'Open', exact: true \}\)` \| repeated: on its own this matches every record$/);
});

// ---------- the default report: by file, what to do, explanations at the end ----------

const ORDERS_PAGE = [
  '<h2>Orders</h2>',
  '<input placeholder="Search orders">',
  '<button (click)="refresh()">Refresh</button>',
  '<table>',
  '  <tr *ngFor="let o of orders">',
  '    <td>{{ o.number }}</td>',
  '    <td><button (click)="open(o)">Open</button></td>',
  '  </tr>',
  '</table>',
  '<div class="select" (click)="select()">Select</div>',
  '<button (click)="delete()">Delete</button>',
  '<button (click)="delete()">Delete</button>',
  '<button (click)="close()"><mat-icon>close</mat-icon></button>',
  '<button data-testid="export-button" (click)="export()">Export</button>',
].join('\n');

test('summary report: grouped by file, each item with its fix, OK elements listed, explanations last', () => {
  const root = project({ 'app/orders/order-list.component.html': ORDERS_PAGE, 'app/clean/clean.component.html': '<button>Save</button>\n' });
  const md = renderMarkdown(scan(root));
  const lines = md.split('\n');
  assert.equal(lines[0], '# Test ID Status: 4 to do, 1 to review, 5 OK');
  assert.match(lines[2], /^2 files · 10 elements · 0 test ID violations · 3 accessibility findings · role first, test ID where needed · Angular, React, Vue \(no package\.json names Angular, React or Vue, so all three were tried\) · scanned /);
  assert.ok(md.includes('## app/orders/order-list.component.html (4 to do, 1 to review)'));
  assert.ok(md.includes('- L10 `<div>` "Select": clickable `<div>` has no role: use `<button>` / `<a href>`, or add role + tabindex, or add a test ID · suggested test ID: `select-button`'), 'the tag is the one in the source, and tags are code');
  assert.ok(md.includes('- L11, L12 `<button>` "Delete": name "Delete" appears more than once · give each one its own test ID'), 'identical items are joined');
  assert.ok(md.includes('- L13 `<button>`: no accessible name'));
  assert.match(md, /- L7 `<button>` "Open": repeated element: .* · locator: `page\.getByRole\('button', \{ name: 'Open', exact: true \}\)` \(repeated: on its own this matches every record\) · fingerprint `079cb9c2`/);
  assert.ok(md.includes('**OK (4):** L2 `<input>` placeholder "Search orders", L3 `<button>` "Refresh", L4 `<table>`, L14 `<button>` "Export"'));
  assert.ok(md.includes('- L2 `<input>` placeholder "Search orders": accessibility: has a placeholder but no label'));
  assert.equal((md.match(/no accessible name/g) ?? []).length, 1, 'a finding that repeats the status is not listed twice');
  assert.ok(md.includes('**Nothing to do in 1 file:** app/clean/clean.component.html'));
  for (const empty of ['## Violations', '## Not scanned', '## Same test ID', '- None', '### Per file']) assert.ok(!md.includes(empty), `no empty section: ${empty}`);
  assert.ok(md.indexOf('## Totals') > md.indexOf('## app/orders') && md.indexOf('## How to read this report') > md.indexOf('## Totals'));
  assert.match(md, /testid-scan: reviewed <fingerprint>/, 'says how to use the fingerprint when there is something to review');
  // no raw tag or placeholder outside code: a Markdown viewer would drop it
  assert.doesNotMatch(md.replace(/``[^`]*``|`[^`]*`/g, ''), /<[a-z.]/i);
});

test('summary report: where the framework list came from; --detailed gives the full layout', () => {
  const root = project({ 'package.json': JSON.stringify({ dependencies: { '@angular/core': '^18.0.0' } }), 'src/a/a.component.html': TWO });
  assert.match(renderMarkdown(scan(join(root, 'src'))), /· Angular \(from package\.json\) ·/);
  assert.match(renderMarkdown(scan(join(root, 'src'), { framework: 'angular' })), /· Angular \(set by the framework option\) ·/);
  const run = spawnSync(process.execPath, [cli, join(root, 'src'), '--out', join(root, 'out.md'), '--detailed', '--format', 'quiet'], { encoding: 'utf8', cwd: root });
  assert.equal(run.status, 0);
  const detailed = readFileSync(join(root, 'out.md'), 'utf8');
  assert.match(detailed, /^# Test ID Status\n/);
  assert.match(detailed, /## Violations\n\nEvery test ID that breaks a rule/);
});
