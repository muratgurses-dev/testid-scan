#!/usr/bin/env node
/**
 * Real-app referee run. On real open-source apps nobody has written down the right answer, so the most certain
 * evidence the page offers is used as the referee:
 *   - data-tsrc="<file>:<line>" on every HTML element (React and Vue apps built with testid-scan-page/vite)
 *   - Angular component hosts (any Angular build)
 * At every screen of a journey, --verify runs twice on the same page: once with that evidence (the referee) and once
 * without it, the way a plain production build is checked. The second run's verdicts are scored against the first.
 * React apps are served with source maps, and a third run checks them the way a production build with source maps is
 * checked (component ownership from React's fibers, data-tsrc ignored); it is scored against the same referee.
 *
 *   node accuracy/real/run-real.mjs --work <folder with the cloned, installed and built apps> [--scanner <cli.js>] [--app <name>] [--kit <n>] [--kit-seed <n>]
 *
 * --kit <n> also writes a blind labelling kit: n random locators per app with their source lines and a screenshot of
 * what they found, for someone who did not build the tools to judge (see accuracy/real/README.md).
 *
 * See accuracy/real/README.md for how to clone, install and build the apps.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, selectors } from 'playwright';
import { checkOnPage, finishVerify, locatorsToCheck, settle as settlePage } from '../../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, '..', '..');
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const work = option('--work') ? resolve(option('--work')) : undefined;
const scanner = resolve(option('--scanner') ?? join(pkg, '..', 'testid-scan', 'dist', 'cli.js'));
const only = option('--app');
const kitSize = Number(option('--kit') ?? 0);
// a different seed gives a new, independent sample (the default reproduces the 2026-10-15 kit)
const kitSeed = Number(option('--kit-seed') ?? 42);
const kitDir = join(here, 'results', 'label-kit');

/** A fixed-seed random order, so the same kit comes out every run. */
function shuffled(n, seed) {
  const order = [...Array(n).keys()];
  let t = seed;
  const rand = () => { t += 0x6d2b79f5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
  for (let i = n - 1; i > 0; i -= 1) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  return order;
}
const outDir = join(here, 'results');

/** The apps: where they are under --work, what testid-scan reads, what is served, and how the screens are reached. */
const APPS = [
  { name: 'bulletproof-react', framework: 'react', dir: 'bulletproof-react/apps/react-vite', source: 'src', dist: 'dist-tsrc-maps', evidence: 'data-tsrc', maps: true },
  { name: 'vue3-realworld', framework: 'vue', dir: 'vue3-realworld-example-app', source: 'src', dist: 'dist-tsrc', evidence: 'data-tsrc' },
  { name: 'angular-ngrx-material-starter', framework: 'angular', dir: 'angular-ngrx-material-starter', source: 'projects/angular-ngrx-material-starter/src', dist: 'dist/angular-ngrx-material-starter', evidence: 'Angular hosts' },
  { name: 'conduit-react', framework: 'react', dir: 'conduit-realworld-example-app/frontend', source: 'src', dist: 'dist-tsrc-maps', evidence: 'data-tsrc', maps: true },
  { name: 'conduit-angular', framework: 'angular', dir: 'angular-realworld-example-app', source: 'src/app', dist: 'dist/angular-conduit/browser', evidence: 'Angular hosts' },
];

const fail = (message) => { console.error(message); process.exit(2); };
if (!work) fail('Pass --work <folder> with the apps (see accuracy/real/README.md)');
if (!existsSync(join(pkg, 'dist', 'index.js'))) fail('Build this package first: npm run build');
if (!existsSync(scanner)) fail(`testid-scan not found at ${scanner}; pass --scanner <path to dist/cli.js>`);
mkdirSync(outDir, { recursive: true });

async function serve(root) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = join(root, path);
    if (!file.startsWith(root) || !existsSync(file) || path.endsWith('/')) file = join(root, 'index.html'); // single-page app fallback
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

/**
 * The referee's answer for one locator, from the run with evidence, on pages the evidence says show its component.
 * undefined = the evidence does not settle it.
 */
function refereeOf(a) {
  if (a.result === 'unreadable') return undefined;
  const relevant = a.pages.filter((p) => p.fileShown && p.fileShownKnown);
  if (relevant.some((p) => p.count > 1)) return 'wrong';
  if (relevant.some((p) => p.count === 1 && p.target?.check === 'exact' && p.target.ok === false)) return 'wrong';
  // right only when every single match on a page that shows its component was checked and is its element
  const single = relevant.filter((p) => p.count === 1);
  if (single.length && single.every((p) => p.target?.check === 'exact' && p.target.ok)) return 'right';
  if (relevant.some((p) => p.count === 0 && p.sourcePresent === 'visible')) return 'wrong';
  return undefined;
}

async function measure(browser, app) {
  const dir = join(work, app.dir);
  if (!existsSync(join(dir, app.dist, 'index.html'))) fail(`${app.name}: no build at ${join(dir, app.dist)} (see accuracy/real/README.md)`);
  const scanPath = join(outDir, `${app.name}.static-scan.json`);
  const r = spawnSync(process.execPath, [scanner, join(dir, app.source), '--json', scanPath, '--out', join(outDir, `${app.name}.static-report.md`), '--format', 'quiet'], { encoding: 'utf8' });
  if (r.status !== 0 && r.status !== 1) fail(`testid-scan failed on ${app.name}: ${r.stderr}`);
  const scan = JSON.parse(readFileSync(scanPath, 'utf8'));
  const withEvidence = locatorsToCheck(scan);
  const without = locatorsToCheck(scan);
  const maps = app.maps ? locatorsToCheck(scan) : undefined;
  const { journey, setup } = await import(pathToFileURL(join(here, 'journeys', `${app.name}.mjs`)).href);

  const { server, base } = await serve(join(dir, app.dist));
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const states = []; const steps = [];
  // the kit: a fixed sample of locators, and the best screenshot of each seen so far
  const sample = kitSize ? shuffled(without.items.length, kitSeed).slice(0, kitSize) : [];
  const shots = new Map(); // index -> { quality, state, count, file }
  if (sample.length) mkdirSync(join(kitDir, app.name), { recursive: true });
  const capture = async (state) => {
    for (const i of sample) {
      const b = without.items[i].pages.at(-1); const a = withEvidence.items[i].pages.at(-1);
      if (!b || !a) continue;
      // best: one to three matches on a screen that shows its component; then any one to three; then nothing found on such a screen
      const quality = b.count >= 1 && b.count <= 3 ? (a.fileShown ? 3 : 2) : b.count === 0 && a.fileShown ? 1 : 0;
      if (!quality || quality <= (shots.get(i)?.quality ?? 0)) continue;
      const file = join(kitDir, app.name, `${i}.png`);
      try {
        if (b.count) {
          const loc = (await import('../../dist/index.js')).buildLocator(page, (await import('../../dist/index.js')).parseLocator(without.items[i].locator));
          await loc.first().scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => undefined);
          await loc.evaluateAll((els) => els.forEach((e) => { e.dataset.kitOutline = e.style.outline; e.style.outline = '3px solid #e5007a'; e.style.outlineOffset = '2px'; }));
          const box = await loc.first().boundingBox();
          const vp = page.viewportSize();
          const clip = box && vp ? { x: Math.max(0, box.x - 200), y: Math.max(0, box.y - 160), width: Math.min(vp.width, box.width + 400), height: Math.min(vp.height, box.height + 320) } : undefined;
          await page.screenshot({ path: file, clip: clip && clip.x + clip.width <= vp.width && clip.y + clip.height <= vp.height ? clip : undefined });
          await loc.evaluateAll((els) => els.forEach((e) => { e.style.outline = e.dataset.kitOutline ?? ''; e.style.outlineOffset = ''; delete e.dataset.kitOutline; }));
        } else {
          await page.screenshot({ path: file });
        }
        shots.set(i, { quality, state, count: b.count, url: page.url() });
      } catch { /* a screenshot that fails leaves the previous one */ }
    }
  };
  try {
    if (setup) await setup(page);
    const settle = () => settlePage(page);
    const look = async (state) => {
      await page.waitForTimeout(250);
      await checkOnPage(page, withEvidence.items, withEvidence.selectorsByFile, { exact: true, state, react: false });
      await checkOnPage(page, without.items, {}, { exact: false, state });
      // a production build with source maps: no data-tsrc (an attribute nobody writes), React ownership on
      if (maps) await checkOnPage(page, maps.items, {}, { exact: true, state, sourceAttribute: 'data-tsrc-not-used' });
      if (sample.length) await capture(state);
      states.push({ state, url: page.url() });
      process.stderr.write(`  ${app.name}: ${state}\n`);
    };
    const step = async (name, action) => {
      try { await action(); steps.push({ name, ok: true }); } catch (e) { steps.push({ name, ok: false, error: String(e).split('\n')[0].slice(0, 140) }); }
    };
    await journey({ page, base, look, step, settle });
  } finally {
    await page.close();
    server.close();
  }
  // pages are told apart by URL; one URL can stand for several states (a dialog open, then closed), so number them
  finishVerify(withEvidence.items, withEvidence.skipped);
  finishVerify(without.items, without.skipped);
  if (maps) finishVerify(maps.items, maps.skipped);

  const rows = without.items.map((b, i) => {
    const a = withEvidence.items[i];
    return { file: b.file, line: b.line, locator: b.locator, scope: b.scope, referee: refereeOf(a), refereeWhy: a.why, refereeVerdict: a.verdict, verdict: b.verdict, why: b.why, mapsVerdict: maps?.items[i].verdict, mapsWhy: maps?.items[i].why, pages: b.pages.map((p) => ({ url: p.url.replace(/^https?:\/\/[^/]+/, ""), count: p.count, withHidden: p.withHidden, fileShown: p.fileShown })) };
  });
  const known = rows.filter((x) => x.referee);
  const said = (v, key = 'verdict') => known.filter((x) => x[key] === v);
  const mapsCounts = maps ? {
    saidCorrect: said('verified correct', 'mapsVerdict').length,
    saidCorrectRight: said('verified correct', 'mapsVerdict').filter((x) => x.referee === 'right').length,
    saidIncorrect: said('verified incorrect', 'mapsVerdict').length,
    saidIncorrectRight: said('verified incorrect', 'mapsVerdict').filter((x) => x.referee === 'wrong').length,
    unable: rows.filter((x) => x.mapsVerdict === 'unable to verify').length,
  } : undefined;
  const counts = {
    maps: mapsCounts,
    locators: rows.length,
    settledByReferee: known.length,
    saidCorrect: said('verified correct').length,
    saidCorrectRight: said('verified correct').filter((x) => x.referee === 'right').length,
    saidIncorrect: said('verified incorrect').length,
    saidIncorrectRight: said('verified incorrect').filter((x) => x.referee === 'wrong').length,
    saidUnable: said('unable to verify').length,
    unableWithout: rows.filter((x) => x.verdict === 'unable to verify').length,
    unableWith: rows.filter((x) => x.refereeVerdict === 'unable to verify').length,
    wrongByReferee: known.filter((x) => x.referee === 'wrong').length,
  };
  const kit = sample.map((i) => {
    const item = without.items[i];
    const lines = readFileSync(join(dir, app.source, item.file), 'utf8').split('\n');
    const from = Math.max(1, item.line - 3);
    const snippet = lines.slice(from - 1, item.line + 3).map((l, k) => ({ n: from + k, text: l, mark: from + k === item.line }));
    return { id: `${app.name}#${i}`, app: app.name, file: item.file, line: item.line, locator: item.locator, snippet, shot: shots.has(i) ? `${app.name}/${i}.png` : undefined, ...shots.get(i), row: rows[i] };
  });
  return { ...app, counts, rows, kit, states: states.length, stepsFailed: steps.filter((s) => !s.ok) };
}

const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
const show = (v, unit = '%') => (v === null ? 'n/a' : `${v}${unit}`);
const targets = JSON.parse(readFileSync(join(here, '..', 'targets.json'), 'utf8'));

selectors.setTestIdAttribute('data-testid');
const browser = await chromium.launch();
const results = [];
try {
  for (const app of APPS.filter((a) => !only || a.name === only)) {
    process.stderr.write(`Measuring ${app.name}...\n`);
    results.push(await measure(browser, app));
  }
} finally {
  await browser.close();
}

const metricRows = results.map((r) => {
  const c = r.counts;
  return {
    name: r.name, framework: r.framework, evidence: r.evidence, states: r.states, stepsFailed: r.stepsFailed.length,
    locators: c.locators, settled: c.settledByReferee,
    correctPrecision: pct(c.saidCorrectRight, c.saidCorrect), saidCorrect: c.saidCorrect, falseAssurance: c.saidCorrect - c.saidCorrectRight,
    incorrectPrecision: pct(c.saidIncorrectRight, c.saidIncorrect), saidIncorrect: c.saidIncorrect, falseAlarm: c.saidIncorrect - c.saidIncorrectRight,
    wrongCaught: pct(c.saidIncorrectRight, c.wrongByReferee), wrongByReferee: c.wrongByReferee,
    unableWithout: pct(c.unableWithout, c.locators), unableWith: pct(c.unableWith, c.locators),
    maps: c.maps && {
      correctPrecision: pct(c.maps.saidCorrectRight, c.maps.saidCorrect), saidCorrect: c.maps.saidCorrect, falseAssurance: c.maps.saidCorrect - c.maps.saidCorrectRight,
      incorrectPrecision: pct(c.maps.saidIncorrectRight, c.maps.saidIncorrect), saidIncorrect: c.maps.saidIncorrect, falseAlarm: c.maps.saidIncorrect - c.maps.saidIncorrectRight,
      wrongCaught: pct(c.maps.saidIncorrectRight, c.wrongByReferee), unable: pct(c.maps.unable, c.locators),
    },
  };
});

const md = [
  '# Real-app referee run', '',
  `${new Date().toISOString().slice(0, 10)}. Each app was walked through its screens; at every screen --verify ran once with the`,
  'evidence the page offers (the referee) and once without it, as a plain production build would be checked.',
  'Only locators the referee could settle are scored. Targets from accuracy/targets.json apply to the run without evidence.', '',
  '| | ' + metricRows.map((m) => `${m.name} (${m.framework})`).join(' | ') + ' |',
  '|---|' + metricRows.map(() => '---:').join('|') + '|',
  `| referee evidence | ${metricRows.map((m) => m.evidence).join(' | ')} |`,
  `| screens visited (steps failed) | ${metricRows.map((m) => `${m.states} (${m.stepsFailed})`).join(' | ')} |`,
  `| locators from testid-scan | ${metricRows.map((m) => m.locators).join(' | ')} |`,
  `| settled by the referee | ${metricRows.map((m) => m.settled).join(' | ')} |`,
  `| without evidence: verified correct, really right | ${metricRows.map((m) => `${show(m.correctPrecision)} (${m.saidCorrect - m.falseAssurance} of ${m.saidCorrect})`).join(' | ')} |`,
  `| without evidence: false assurance | ${metricRows.map((m) => m.falseAssurance).join(' | ')} |`,
  `| without evidence: verified incorrect, really wrong | ${metricRows.map((m) => `${show(m.incorrectPrecision)} (${m.saidIncorrect - m.falseAlarm} of ${m.saidIncorrect})`).join(' | ')} |`,
  `| without evidence: false alarms | ${metricRows.map((m) => m.falseAlarm).join(' | ')} |`,
  `| wrong locators (referee) caught without evidence | ${metricRows.map((m) => `${show(m.wrongCaught)} (of ${m.wrongByReferee})`).join(' | ')} |`,
  `| unable to verify, without evidence | ${metricRows.map((m) => show(m.unableWithout)).join(' | ')} |`,
  `| unable to verify, with evidence | ${metricRows.map((m) => show(m.unableWith)).join(' | ')} |`,
  ...(metricRows.some((m) => m.maps) ? [
    `| production build with source maps (React): verified correct, really right | ${metricRows.map((m) => (m.maps ? `${show(m.maps.correctPrecision)} (${m.maps.saidCorrect - m.maps.falseAssurance} of ${m.maps.saidCorrect})` : '-')).join(' | ')} |`,
    `| with source maps: verified incorrect, really wrong | ${metricRows.map((m) => (m.maps ? `${show(m.maps.incorrectPrecision)} (${m.maps.saidIncorrect - m.maps.falseAlarm} of ${m.maps.saidIncorrect})` : '-')).join(' | ')} |`,
    `| with source maps: wrong locators caught | ${metricRows.map((m) => (m.maps ? `${show(m.maps.wrongCaught)} (of ${m.wrongByReferee})` : '-')).join(' | ')} |`,
    `| with source maps: unable to verify | ${metricRows.map((m) => (m.maps ? show(m.maps.unable) : '-')).join(' | ')} |`,
  ] : []),
  '',
  ...results.flatMap((r) => [
    `## ${r.name}`, '',
    r.stepsFailed.length ? `Steps that failed (their screens were not reached): ${r.stepsFailed.map((s) => s.name).join(', ')}` : 'Every step of the journey worked.', '',
    '### Disagreements with the referee', '',
    ...(() => {
      const against = (v) => (v === 'verified correct' ? 'wrong' : v === 'verified incorrect' ? 'right' : undefined);
      const bad = r.rows.flatMap((x) => [
        ...(x.referee && against(x.verdict) === x.referee ? [`- ${x.file}:${x.line} | without evidence said ${x.verdict} | referee: ${x.referee} (${x.refereeWhy}) | ${x.why}`] : []),
        ...(x.referee && x.mapsVerdict && against(x.mapsVerdict) === x.referee ? [`- ${x.file}:${x.line} | with source maps said ${x.mapsVerdict} | referee: ${x.referee} (${x.refereeWhy}) | ${x.mapsWhy}`] : []),
      ]);
      return bad.length ? bad : ['- none'];
    })(), '',
    '### Every locator', '',
    ...(r.maps
      ? ['| Source | Scope | Without evidence | With source maps | With evidence (referee) | Referee |', '|---|---|---|---|---|---|',
        ...r.rows.map((x) => `| ${x.file}:${x.line} | ${x.scope} | ${x.verdict}: ${x.why.replace(/\|/g, '/')} | ${x.mapsVerdict}: ${x.mapsWhy.replace(/\|/g, '/')} | ${x.refereeVerdict}: ${x.refereeWhy.replace(/\|/g, '/')} | ${x.referee ?? '-'} |`)]
      : ['| Source | Scope | Without evidence | With evidence (referee) | Referee |', '|---|---|---|---|---|',
        ...r.rows.map((x) => `| ${x.file}:${x.line} | ${x.scope} | ${x.verdict}: ${x.why.replace(/\|/g, '/')} | ${x.refereeVerdict}: ${x.refereeWhy.replace(/\|/g, '/')} | ${x.referee ?? '-'} |`)]),
    '',
  ]),
].join('\n');
writeFileSync(join(outDir, 'real.md'), md);
writeFileSync(join(outDir, 'real.json'), `${JSON.stringify({ metrics: metricRows, apps: results.map(({ name, counts, rows, stepsFailed }) => ({ name, counts, rows, stepsFailed })) }, null, 2)}\n`);
for (const m of metricRows) {
  if (m.maps) console.log(`${''.padEnd(30)} with source maps: correct=${show(m.maps.correctPrecision)} (${m.maps.saidCorrect}, false assurance ${m.maps.falseAssurance}) incorrect=${show(m.maps.incorrectPrecision)} (${m.maps.saidIncorrect}, false alarms ${m.maps.falseAlarm}) caught=${show(m.maps.wrongCaught)} unable ${show(m.maps.unable)}`);
  console.log(`${m.name.padEnd(30)} settled=${m.settled}/${m.locators} correct=${show(m.correctPrecision)} (${m.saidCorrect}, false assurance ${m.falseAssurance}) incorrect=${show(m.incorrectPrecision)} (${m.saidIncorrect}, false alarms ${m.falseAlarm}) caught=${show(m.wrongCaught)} unable: without ${show(m.unableWithout)}, with ${show(m.unableWith)} states=${m.states} stepsFailed=${m.stepsFailed}`);
  for (const [k, bar] of Object.entries(targets)) {
    const v = k === 'verifiedCorrectPrecision' ? m.correctPrecision : k === 'verifiedIncorrectPrecision' ? m.incorrectPrecision : undefined;
    if (typeof bar === 'number' && v !== null && v !== undefined && v < bar) console.log(`  below target: ${k} ${v} < ${bar}`);
  }
}
console.log(`Report: ${join(outDir, 'real.md')}`);

if (kitSize) {
  const items = results.flatMap((r) => r.kit);
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Locator labelling kit</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:24px;max-width:1100px;color:#1b1b1b;background:#fff}
h1{font-size:22px}.item{border:1px solid #ccc;border-radius:8px;padding:16px;margin:20px 0}
pre{background:#f6f6f6;padding:10px;overflow:auto;font-size:13px}.mark{background:#ffe08a;display:block}
img{max-width:100%;border:1px solid #ddd}code{background:#f0f0f0;padding:1px 4px}.q{font-weight:600}</style></head><body>
<h1>Locator labelling kit</h1>
<p>For each item: the <b>highlighted source line</b> is an element in the app's code. Below it is the Playwright locator a tool
recommends for that element, and a screenshot of the running app where the elements the locator found are
<b>outlined in pink</b> (no outline: the locator found nothing on that screen).</p>
<p class="q">Question: would a test using this locator act on exactly the element of the highlighted line?</p>
<p>Write one of <code>correct</code>, <code>incorrect</code> or <code>cannot tell</code> in the <code>label</code> column of
<code>labels.csv</code>, with the item id. "incorrect" covers: several elements outlined, another element outlined, or
nothing outlined although the element is visible on the screen. Use "cannot tell" whenever the screenshot and the
source do not settle it: it is never counted as right or wrong. Do not look at the tools' reports before you finish.</p>
<p>Fill <code>reviewer</code> with your name or initials and <code>review_type</code> with <code>human</code> if you judged
every item yourself, <code>ai-assisted</code> if an AI tool proposed labels you checked, or <code>ai</code> if an AI tool
labelled them. Only <code>human</code> counts as an independent human review.</p>
${items.map((it) => `<div class="item" id="${esc(it.id)}"><b>${esc(it.id)}</b> · ${esc(it.app)} · <code>${esc(it.file)}:${it.line}</code>
<pre>${it.snippet.map((l) => `<span class="${l.mark ? 'mark' : ''}">${String(l.n).padStart(4)}  ${esc(l.text)}</span>`).join('\n')}</pre>
<p>Locator: <code>${esc(it.locator)}</code></p>
${it.shot ? `<p>Screen: ${esc(it.state)} · ${it.count} element(s) found</p><img src="${esc(it.shot)}" alt="screenshot">` : '<p><i>The locator found nothing on any screen of the journey where its component was shown, and no screenshot was taken.</i></p>'}
</div>`).join('\n')}
</body></html>`;
  writeFileSync(join(kitDir, 'index.html'), html);
  writeFileSync(join(kitDir, 'labels.csv'), `id,app,file,line,label,note,reviewer,review_type\n${items.map((it) => `${it.id},${it.app},${it.file},${it.line},,,,`).join('\n')}\n`);
  // the answers stay out of the kit's pages: score-labels.mjs reads them
  const frameworkOfApp = Object.fromEntries(APPS.map((a) => [a.name, a.framework]));
  writeFileSync(join(outDir, 'label-key.json'), `${JSON.stringify(Object.fromEntries(items.map((it) => [it.id, { app: it.app, framework: frameworkOfApp[it.app], verdictWithoutEvidence: it.row.verdict, verdictWithEvidence: it.row.refereeVerdict, ...(it.row.mapsVerdict ? { verdictWithSourceMaps: it.row.mapsVerdict } : {}), referee: it.row.referee ?? null }])), null, 2)}\n`);
  console.log(`Labelling kit: ${join(kitDir, 'index.html')} (${items.length} items, ${items.filter((i) => i.shot).length} with a screenshot)`);
}
