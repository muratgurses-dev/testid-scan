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
  const md = renderMarkdown(scan(project({ 'a/a.component.html': src }), { framework: 'angular' }));
  const line = md.split('\n').find((l) => l.includes('a/a.component.html:3') && l.includes('fingerprint'));
  assert.ok(line, 'the button is under Manual review');
  assert.match(line, /`page\.getByRole\('button', \{ name: 'Open', exact: true \}\)` \| repeated: on its own this matches every record$/);
});
