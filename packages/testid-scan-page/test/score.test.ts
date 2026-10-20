/** accuracy/real/score-labels.mjs: reviewer files are validated, and the scores are computed as documented. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = here.includes('.test-build') ? join(here, '..', '..') : join(here, '..');
const script = join(root, 'accuracy', 'real', 'score-labels.mjs');
const dir = mkdtempSync(join(tmpdir(), 'score-'));
const key = {
  'r#1': { app: 'r', framework: 'react', verdictWithoutEvidence: 'verified correct', verdictWithEvidence: 'verified correct', referee: 'right' },
  'r#2': { app: 'r', framework: 'react', verdictWithoutEvidence: 'verified correct', verdictWithEvidence: 'verified incorrect', referee: 'wrong' },
  'v#1': { app: 'v', framework: 'vue', verdictWithoutEvidence: 'verified incorrect', verdictWithEvidence: 'verified incorrect', referee: 'wrong' },
  'v#2': { app: 'v', framework: 'vue', verdictWithoutEvidence: 'unable to verify', verdictWithEvidence: 'verified correct', referee: null },
};
writeFileSync(join(dir, 'key.json'), JSON.stringify(key));
const csv = (rows: string[][], header = 'id,app,file,line,label,note,reviewer,review_type') => [header, ...rows.map((r) => r.join(','))].join('\n');
const run = (...files: string[]) => spawnSync(process.execPath, [script, '--key', join(dir, 'key.json'), '--json', join(dir, 'out.json'), ...files], { encoding: 'utf8' });

test('scores one reviewer: precision, false assurance, recall, cannot tell left out, per framework', () => {
  writeFileSync(join(dir, 'a.csv'), csv([
    ['r#1', 'r', 'f', '1', 'correct', '"fine, really"', 'ann', 'human'],
    ['r#2', 'r', 'f', '2', 'incorrect', '', 'ann', 'human'],
    ['v#1', 'v', 'f', '3', 'incorrect', '', 'ann', 'human'],
    ['v#2', 'v', 'f', '4', 'cannot tell', '', 'ann', 'human'],
  ]));
  const r = run(join(dir, 'a.csv'));
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(readFileSync(join(dir, 'out.json'), 'utf8'));
  const without = out.reviews[0].modes.verdictWithoutEvidence.all;
  assert.deepEqual([without.correctPrecision.hit, without.correctPrecision.of], [1, 2]); // r#2 called correct, reviewer says incorrect
  assert.equal(without.falseAssuranceRate.value, 50);
  assert.deepEqual([without.incorrectPrecision.hit, without.incorrectPrecision.of], [1, 1]);
  assert.deepEqual([without.incorrectRecall.hit, without.incorrectRecall.of], [1, 2]);
  assert.equal(without.cannotTell, 1);
  assert.equal(without.matrix['unable to verify']['cannot tell'], 1);
  const withEvidence = out.reviews[0].modes.verdictWithEvidence.frameworks.react;
  assert.equal(withEvidence.correctPrecision.value, 100);
  assert.equal(out.reviews[0].type, 'human');
  assert.match(r.stdout, /Review type: \*\*human\*\*/);
});

test('rejects unknown ids, duplicates and labels that are not allowed', () => {
  writeFileSync(join(dir, 'bad.csv'), csv([
    ['r#1', 'r', 'f', '1', 'correct', '', 'bo', 'human'],
    ['r#1', 'r', 'f', '1', 'incorrect', '', 'bo', 'human'],
    ['x#9', 'x', 'f', '1', 'correct', '', 'bo', 'human'],
    ['v#1', 'v', 'f', '3', 'maybe', '', 'bo', 'human'],
  ]));
  const r = run(join(dir, 'bad.csv'));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /labelled twice/);
  assert.match(r.stderr, /unknown id x#9/);
  assert.match(r.stderr, /"maybe" is not one of/);
  writeFileSync(join(dir, 'nohead.csv'), 'a,b\n1,2');
  assert.equal(run(join(dir, 'nohead.csv')).status, 2);
});

test('marks unspecified and AI review types, and computes agreement between reviewers', () => {
  writeFileSync(join(dir, 'b.csv'), csv([
    ['r#1', 'r', 'f', '1', 'correct', '', 'bot', 'ai-assisted'],
    ['r#2', 'r', 'f', '2', 'correct', '', 'bot', 'ai-assisted'],
    ['v#1', 'v', 'f', '3', 'incorrect', '', 'bot', 'ai-assisted'],
    ['v#2', 'v', 'f', '4', 'cannot tell', '', 'bot', 'ai-assisted'],
  ]));
  writeFileSync(join(dir, 'c.csv'), csv([['r#1', 'r', 'f', '1', 'correct', '']], 'id,app,file,line,label,note'));
  const r = run(join(dir, 'a.csv'), join(dir, 'b.csv'), join(dir, 'c.csv'));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Review type: \*\*ai-assisted\*\*. This is not an independent human review/);
  assert.match(r.stdout, /not marked as an independent human review/);
  assert.match(r.stderr, /no review_type/);
  const out = JSON.parse(readFileSync(join(dir, 'out.json'), 'utf8'));
  const ab = out.interRater.find((x: { a: string; b: string }) => x.a === 'ann' && x.b === 'bot');
  assert.deepEqual([ab.items, ab.agreement], [4, 75]);
  assert.ok(ab.kappa > 0 && ab.kappa < 1);
});
