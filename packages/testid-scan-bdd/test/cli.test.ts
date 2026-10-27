import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);
const cli = join(dirname(here), '..', 'src', here.endsWith('.ts') ? 'cli.ts' : 'cli.js');
const fixture = join(dirname(here), '..', '..', 'test', 'fixtures', 'shop.page.json');
const run = (args: string[], cwd: string) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', cwd });

test('command line: writes the steps and the catalog, and says what it found', () => {
  const dir = mkdtempSync(join(tmpdir(), 'testid-bdd-'));
  const r = run([fixture], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^1 page · 12 steps · 3 found by test ID · 1 not available yet\n/);
  assert.match(readFileSync(join(dir, 'steps', 'testid-scan.steps.ts'), 'utf8'), /createBdd/);
  assert.match(readFileSync(join(dir, 'testid-steps.md'), 'utf8'), /## shop\.html/);

  const custom = run([fixture, '--steps', 'e2e/bdd/steps.ts', '--catalog', 'docs/steps.md'], dir);
  assert.equal(custom.status, 0, custom.stderr);
  assert.ok(existsSync(join(dir, 'e2e', 'bdd', 'steps.ts')) && existsSync(join(dir, 'docs', 'steps.md')));
});

test('command line: usage errors and unreadable input exit 2 with a message', () => {
  const dir = mkdtempSync(join(tmpdir(), 'testid-bdd-'));
  assert.equal(run([], dir).status, 2);
  assert.match(run(['missing.json'], dir).stderr, /File not found: missing\.json/);
  assert.match(run([fixture, '--steps'], dir).stderr, /--steps needs a value/);
  assert.match(run([fixture, '--nope'], dir).stderr, /Unknown option --nope/);
  writeFileSync(join(dir, 'source.json'), JSON.stringify({ schemaVersion: 1, files: [], elements: [] }));
  const source = run(['source.json'], dir);
  assert.equal(source.status, 2);
  assert.match(source.stderr, /testid-scan result \(a scan of source files\)/);
  writeFileSync(join(dir, 'broken.json'), '{');
  assert.match(run(['broken.json'], dir).stderr, /Cannot read broken\.json/);
  assert.match(run(['--version'], dir).stdout, /^\d+\.\d+\.\d+\n$/);
});
