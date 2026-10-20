#!/usr/bin/env node
/**
 * Accuracy run: measures how far testid-scan's locators and testid-scan-page's --verify outcomes can be trusted.
 *
 * Each corpus (accuracy/<name>/ with a corpus.json) is a small app that marks every interactive element with
 * data-gt="<id>", an attribute neither scanner reads. That is the ground truth: for each locator testid-scan
 * recommends, the source line it came from names the element it should find, and the browser tells which element
 * it really found.
 *
 *   node accuracy/run.mjs [--scanner <testid-scan/dist/cli.js>] [--corpus <name>] [--update-baseline]
 *
 * Needs: npm run build here, testid-scan built next to this package (or --scanner), and each corpus installed
 * (npm install in accuracy/<name>). Exit code 1 when a metric is worse than accuracy/baseline.json.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, selectors } from 'playwright';
import { buildLocator, checkOnPage, finishVerify, locatorsToCheck, parseLocator, settle } from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, '..');
const outDir = join(here, 'results');
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const scanner = resolve(option('--scanner') ?? join(pkg, '..', 'testid-scan', 'dist', 'cli.js'));
const only = option('--corpus');
const updateBaseline = args.includes('--update-baseline');
const ROLE = { button: 'button', link: 'link' };

const fail = (message) => { console.error(message); process.exit(2); };
const run = (cmd, cmdArgs, cwd, env = {}) => {
  const r = spawnSync(cmd, cmdArgs, { cwd, encoding: 'utf8', shell: process.platform === 'win32', env: { ...process.env, NG_CLI_ANALYTICS: 'false', ...env } });
  if (r.status !== 0) fail(`${cmd} ${cmdArgs.join(' ')} failed in ${cwd}:\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
};

if (!existsSync(join(pkg, 'dist', 'index.js'))) fail('Build this package first: npm run build');
if (!existsSync(scanner)) fail(`testid-scan not found at ${scanner}. Build it (npm run build in testid-scan) or pass --scanner <path to dist/cli.js>`);
const corpora = readdirSync(here, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(here, d.name, 'corpus.json')) && (!only || d.name === only))
  .map((d) => d.name).sort();
if (!corpora.length) fail(only ? `No corpus named ${only}` : 'No corpus found (accuracy/<name>/corpus.json)');
for (const name of corpora) if (!existsSync(join(here, name, 'node_modules'))) fail(`Install the corpus first: cd accuracy/${name} && npm install`);
mkdirSync(outDir, { recursive: true });

/** Serve a built app on a free port. */
async function serve(root) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = join(root, path);
    if (!file.startsWith(root) || !existsSync(file) || path.endsWith('/')) file = join(root, 'index.html');
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}/` };
}

/** The builds of a corpus: one by default, or several (a production and a development build). */
const variantsOf = (corpus) => corpus.variants ?? [{ name: '', build: corpus.build, dist: corpus.dist }];

/** Build, scan and visit one corpus build; compare every recommended locator with the ground truth. */
async function measure(browser, name, variant) {
  const dir = join(here, name);
  const corpus = JSON.parse(readFileSync(join(dir, 'corpus.json'), 'utf8'));
  run(variant.build[0], variant.build.slice(1), dir, variant.env);
  const scanPath = join(outDir, `${name}.static-scan.json`);
  run(process.execPath, [scanner, join(dir, corpus.source), '--json', scanPath, '--out', join(outDir, `${name}.static-report.md`), '--format', 'quiet'], pkg);
  const scan = JSON.parse(readFileSync(scanPath, 'utf8'));

  // ground truth of a static record: the data-gt written on its source line
  const sourceLines = new Map();
  const gtOf = (file, line) => {
    if (!sourceLines.has(file)) sourceLines.set(file, readFileSync(join(dir, corpus.source, file), 'utf8').split('\n'));
    return /data-gt="([^"]+)"/.exec(sourceLines.get(file)[line - 1] ?? '')?.[1];
  };

  const { server, base } = await serve(join(dir, variant.dist));
  const { items, skipped, selectorsByFile } = locatorsToCheck(scan);
  const hits = new Map(items.map((i) => [i, []])); // item -> [{ route, count, target }]
  const visibleGt = new Map(); // data-gt -> routes where a visible element carries it
  const roleCounts = []; // for false alarms
  try {
    for (const route of corpus.routes) {
      const page = await browser.newPage();
      await page.goto(base + route);
      await settle(page);
      await checkOnPage(page, items, selectorsByFile, { state: route });
      const gts = await page.evaluate(() => [...document.querySelectorAll('[data-gt]')]
        .filter((el) => el.checkVisibility() && el.getBoundingClientRect().width > 0)
        .map((el) => el.getAttribute('data-gt')));
      for (const gt of new Set(gts)) visibleGt.set(gt, [...(visibleGt.get(gt) ?? []), route]);
      for (const item of items) {
        let count = 0; let target;
        try {
          const loc = buildLocator(page, parseLocator(item.locator));
          count = await loc.count();
          if (count === 1) target = await loc.getAttribute('data-gt');
        } catch { count = -1; }
        hits.get(item).push({ route, count, target });
      }
      // a static "Needs test ID" for a shared name: is the name really shared on the page?
      for (const record of scan.elements) {
        if (record.status !== 'Needs test ID' || !record.label || !ROLE[record.kind]) continue;
        const gt = gtOf(record.file, record.line);
        if (!gt || !gts.includes(gt)) continue;
        const count = await page.getByRole(ROLE[record.kind], { name: record.label, exact: true }).count();
        roleCounts.push({ record, gt, route, count });
      }
      await page.close();
    }
  } finally {
    server.close();
  }
  const verify = finishVerify(items, skipped);

  const rows = verify.checked.map((item) => {
    const expected = gtOf(item.file, item.line);
    const h = hits.get(item);
    let truth;
    if (item.result === 'unreadable') truth = 'unreadable';
    else if (!expected) truth = 'untagged';
    else if (h.some((x) => x.count > 1)) truth = 'ambiguous';
    else if (h.some((x) => x.count === 1 && x.target !== expected)) truth = 'wrong target';
    else if (h.some((x) => x.count === 1)) truth = 'correct';
    else truth = visibleGt.has(expected) ? 'misses a visible element' : 'element not on the scanned pages';
    const targets = [...new Set(h.filter((x) => x.count === 1).map((x) => x.target))];
    return { file: item.file, line: item.line, locator: item.locator, scope: item.scope, expected, targets, tool: item.result, check: item.target?.check, verdict: item.verdict, why: item.why, truth };
  });
  const claims = rows.filter((r) => r.scope === 'page-candidate' && r.truth !== 'element not on the scanned pages' && r.truth !== 'untagged');
  const staticGts = new Set(scan.elements.map((e) => gtOf(e.file, e.line)).filter(Boolean));
  const missed = [...visibleGt.keys()].filter((gt) => !staticGts.has(gt));
  // one entry per source element, however many screens showed it unique
  const falseAlarms = [...new Map(roleCounts.filter((r) => r.count === 1).map((r) => [`${r.record.file}:${r.record.line}`, r])).values()];
  const counts = {
    claims: claims.length,
    claimsCorrect: claims.filter((r) => r.truth === 'correct').length,
    claimsAmbiguous: claims.filter((r) => r.truth === 'ambiguous').length,
    claimsWrongTarget: claims.filter((r) => r.truth === 'wrong target').length,
    claimsMissingVisible: claims.filter((r) => r.truth === 'misses a visible element').length,
    visible: visibleGt.size,
    missedElements: missed.length,
    falseAlarms: falseAlarms.length,
    // the three-way verdict against the ground truth (untagged and unreadable rows are left out)
    ...verdictCounts(rows),
  };
  const scope = variant.name ? `${name} (${variant.name})` : name;
  return { name: scope, primary: !variant.name, framework: corpus.framework, routes: corpus.routes, counts, rows, missed, falseAlarms };
}

const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : 100);
const WRONG = new Set(['wrong target', 'ambiguous', 'misses a visible element']);
function verdictCounts(rows) {
  const judged = rows.filter((r) => r.truth !== 'untagged' && r.truth !== 'unreadable');
  const said = (v) => judged.filter((r) => r.verdict === v);
  return {
    judged: judged.length,
    wrongLocators: judged.filter((r) => WRONG.has(r.truth)).length,
    saidCorrect: said('verified correct').length,
    saidCorrectRight: said('verified correct').filter((r) => r.truth === 'correct').length,
    saidIncorrect: said('verified incorrect').length,
    saidIncorrectRight: said('verified incorrect').filter((r) => WRONG.has(r.truth)).length,
    saidUnable: said('unable to verify').length,
  };
}
/** The published metrics, from raw counts (so totals are computed from summed counts, not averaged percentages). */
function metricsOf(c) {
  return {
    claimPrecision: pct(c.claimsCorrect, c.claims),
    claims: c.claims,
    claimsAmbiguous: c.claimsAmbiguous,
    claimsWrongTarget: c.claimsWrongTarget,
    claimsMissingVisible: c.claimsMissingVisible,
    coverage: pct(c.visible - c.missedElements, c.visible),
    missedElements: c.missedElements,
    falseAlarms: c.falseAlarms,
    verifiedCorrect: c.saidCorrect,
    verifiedCorrectPrecision: pct(c.saidCorrectRight, c.saidCorrect),
    falseAssurance: c.saidCorrect - c.saidCorrectRight,
    verifiedIncorrect: c.saidIncorrect,
    verifiedIncorrectPrecision: pct(c.saidIncorrectRight, c.saidIncorrect),
    falseAlarmVerify: c.saidIncorrect - c.saidIncorrectRight,
    wrongLocatorsCaught: pct(c.saidIncorrectRight, c.wrongLocators),
    unableToVerify: c.saidUnable,
    unableShare: pct(c.saidUnable, c.judged),
  };
}
const METRICS = [
  ['claimPrecision', '%', 'page-candidate locators whose element was on a scanned screen and that found exactly that element'],
  ['claims', '', 'page-candidate locators whose element was on a scanned screen'],
  ['claimsAmbiguous', '', 'of those, matched more than one element'],
  ['claimsWrongTarget', '', 'of those, matched one element, but not the one in their source line'],
  ['claimsMissingVisible', '', 'of those, matched nothing although the element was visible'],
  ['coverage', '%', 'visible tagged elements that testid-scan reported at all'],
  ['missedElements', '', 'visible tagged elements testid-scan did not report'],
  ['falseAlarms', '', 'testid-scan said "Needs test ID" for a shared name, but on the page the name is unique'],
  ['verifiedCorrect', '', '--verify: locators verified correct'],
  ['verifiedCorrectPrecision', '%', 'of those, really correct (target: see targets.json)'],
  ['falseAssurance', '', 'verified correct, but wrong: a test would act on the wrong element and nobody would know'],
  ['verifiedIncorrect', '', '--verify: locators verified incorrect'],
  ['verifiedIncorrectPrecision', '%', 'of those, really wrong (target: see targets.json)'],
  ['falseAlarmVerify', '', 'verified incorrect, but right'],
  ['wrongLocatorsCaught', '%', 'wrong locators (several elements, wrong element, nothing although visible) that were verified incorrect'],
  ['unableToVerify', '', '--verify: locators it could not verify either way'],
  ['unableShare', '%', 'share of all locators left unverified (lower is better, but never by guessing)'],
];
const higherIsBetter = new Set(['claimPrecision', 'coverage', 'verifiedCorrectPrecision', 'verifiedIncorrectPrecision', 'wrongLocatorsCaught', 'verifiedCorrect', 'verifiedIncorrect']);
const informational = new Set(['claims']);

selectors.setTestIdAttribute('data-testid');
const browser = await chromium.launch();
const results = [];
try {
  for (const name of corpora) {
    for (const variant of variantsOf(JSON.parse(readFileSync(join(here, name, 'corpus.json'), 'utf8')))) {
      process.stderr.write(`Measuring ${name}${variant.name ? ` (${variant.name})` : ''}...\n`);
      results.push(await measure(browser, name, variant));
    }
  }
} finally {
  await browser.close();
}

// the total adds up one build per corpus (the production build), so a corpus with a development variant is not counted twice
const sum = {};
const primary = results.filter((r) => r.primary);
for (const r of primary) for (const [k, v] of Object.entries(r.counts)) sum[k] = (sum[k] ?? 0) + v;
const metrics = Object.fromEntries(results.map((r) => [r.name, metricsOf(r.counts)]));
if (primary.length > 1) metrics.total = metricsOf(sum);

// compare with the saved baseline, per corpus and in total
const baselinePath = join(here, 'baseline.json');
const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : {};
const regressions = [];
for (const [scope, m] of Object.entries(metrics)) {
  const b = baseline[scope];
  if (!b) continue;
  for (const [k] of METRICS) {
    if (informational.has(k) || !(k in b)) continue;
    if (higherIsBetter.has(k) ? m[k] < b[k] : m[k] > b[k]) regressions.push({ scope, k, from: b[k], to: m[k] });
  }
}
// the precision bar written down before the first measurement (accuracy/targets.json)
const targets = JSON.parse(readFileSync(join(here, 'targets.json'), 'utf8'));
const belowTarget = [];
for (const [scope, m] of Object.entries(metrics)) {
  for (const [k, bar] of Object.entries(targets)) if (typeof bar === 'number' && m[k] < bar) belowTarget.push({ scope, k, bar, value: m[k] });
}
const worse = (scope, k) => regressions.some((r) => r.scope === scope && r.k === k) || belowTarget.some((r) => r.scope === scope && r.k === k);

const scopes = Object.keys(metrics);
const md = [
  '# Accuracy run', '',
  `${new Date().toISOString().slice(0, 10)} · ${results.map((r) => `${r.name} (${r.framework}, screens ${r.routes.join(' ')})`).join(' · ')}`, '',
  `| Metric | ${scopes.join(' | ')} | Meaning |`, `|---|${scopes.map(() => '---:').join('|')}|---|`,
  ...METRICS.map(([k, unit, meaning]) => `| ${k} | ${scopes.map((s) => `${metrics[s][k]}${unit}${worse(s, k) ? ' ⚠' : ''}${baseline[s] && k in baseline[s] && baseline[s][k] !== metrics[s][k] ? ` (was ${baseline[s][k]}${unit})` : ''}`).join(' | ')} | ${meaning} |`),
  '',
  ...results.flatMap((r) => [
    `## ${r.name}`, '',
    '| Source | Scope | Verdict | Ground truth | Result / check | Expected | Found | Why |', '|---|---|---|---|---|---|---|---|',
    ...r.rows.map((x) => `| ${x.file}:${x.line} | ${x.scope} | ${x.verdict}${x.verdict === 'verified correct' && x.truth !== 'correct' ? ' ✗' : ''}${x.verdict === 'verified incorrect' && !WRONG.has(x.truth) ? ' ✗' : ''} | ${x.truth} | ${x.tool} / ${x.check ?? '-'} | ${x.expected ?? '-'} | ${x.targets.join(', ') || '-'} | ${x.why} |`),
    '', `Visible elements testid-scan did not report: ${r.missed.length ? r.missed.join(', ') : 'none'}`, '',
    `False alarms: ${r.falseAlarms.length ? r.falseAlarms.map((f) => `${f.record.file}:${f.record.line} ${f.record.kind} "${f.record.label}" (${f.gt})`).join('; ') : 'none'}`, '',
  ]),
].join('\n');
writeFileSync(join(outDir, 'accuracy.md'), md);
writeFileSync(join(outDir, 'accuracy.json'), `${JSON.stringify({ metrics, corpora: results.map(({ name, framework, counts, rows, missed }) => ({ name, framework, counts, rows, missed })) }, null, 2)}\n`);

for (const s of scopes) console.log(`${s.padEnd(13)} ${Object.entries(metrics[s]).map(([k, v]) => `${k}=${v}`).join('; ')}`);
console.log(`Report: ${join(outDir, 'accuracy.md')}`);
if (updateBaseline) {
  writeFileSync(baselinePath, `${JSON.stringify({ ...baseline, ...metrics }, null, 2)}\n`);
  console.log(`Baseline written: ${baselinePath}`);
}
if (belowTarget.length) console.error(`Below the target in targets.json: ${belowTarget.map((r) => `${r.scope} ${r.k} ${r.value} < ${r.bar}`).join('; ')}`);
if (!updateBaseline && regressions.length) console.error(`Worse than the baseline: ${regressions.map((r) => `${r.scope} ${r.k} ${r.from} -> ${r.to}`).join('; ')}`);
if (belowTarget.length || (!updateBaseline && regressions.length)) process.exit(1);
