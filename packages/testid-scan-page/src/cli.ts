#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderMarkdown, renderText, summaryLine } from './report.ts';
import { scanPages } from './scan.ts';
import type { StaticScan } from './verify.ts';

const HELP = `testid-scan-page <url> [<url> ...] [options]

Opens each page in Chromium and reports, element by element, whether a Playwright test can find it by role
and accessible name, by test ID, or not at all. Every locator it lists was run on the page.

Options
  --out <file>            Markdown report (default: testid-page.md)
  --json <file>           also write the full result as JSON
  --attr <name>           test ID attribute (default: data-testid)
  --storage-state <file>  Playwright storage state of a logged-in session
                          (create one with: npx playwright codegen --save-storage=auth.json <url>)
  --verify <file>         testid-scan --json output: run its recommended locators on these pages
  --wait <ms>             extra wait after each page has loaded (default: 0)
  --viewport <WxH>        browser window size (default: 1280x800)
  --headed                show the browser
  --format <name>         terminal output: text (default) or quiet (one line of counts)
  --fail-on-todo          exit 1 while To do > 0
  --min-verified <pct>    exit 1 while fewer than <pct>% of the --verify locators have a verdict either way
  --summary <file>        write the --verify counts (verdicts, evidence, share verified) as JSON
  --fail-on-incorrect     exit 1 while a --verify locator is verified incorrect (several elements, another
                          element, or nothing although its element must be there)
  --fail-on-ambiguous     exit 1 while a --verify locator that testid-scan expected to be unique
                          matches more than one element
  --fail-on-wrong-target  exit 1 while a --verify locator finds another element than its source line's
                          (certain ones only; add --strict-target to count likely ones too)
  --help, --version

Exit codes: 0 ok, 1 a --fail-on-* gate failed, 2 wrong usage, unreachable page or no browser.`;

const VALUE_FLAGS = new Set(['--out', '--json', '--attr', '--storage-state', '--verify', '--wait', '--viewport', '--format', '--min-verified', '--summary']);
const BOOLEAN_FLAGS = new Set(['--headed', '--fail-on-todo', '--fail-on-incorrect', '--fail-on-ambiguous', '--fail-on-wrong-target', '--strict-target', '--help', '--version']);

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

const values = new Map<string, string>();
const flags = new Set<string>();
const urls: string[] = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (VALUE_FLAGS.has(arg)) {
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) fail(`${arg} needs a value`);
    values.set(arg, value);
    i += 1;
  } else if (BOOLEAN_FLAGS.has(arg)) flags.add(arg);
  else if (arg.startsWith('--')) fail(`Unknown option ${arg}\n\n${HELP}`);
  else urls.push(arg);
}

if (flags.has('--help')) { console.log(HELP); process.exit(0); }
if (flags.has('--version')) {
  console.log((JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version);
  process.exit(0);
}
if (!urls.length) fail(HELP);
for (const url of urls) if (!/^(https?|file):\/\//i.test(url)) fail(`Not a URL: ${url} (start it with http://, https:// or file://)`);

const format = values.get('--format') ?? 'text';
if (!['text', 'quiet'].includes(format)) fail(`--format must be text or quiet, not ${format}`);
const wait = Number(values.get('--wait') ?? 0);
if (!Number.isFinite(wait) || wait < 0) fail('--wait must be a number of milliseconds');
if (values.has('--min-verified')) {
  const pct = Number(values.get('--min-verified'));
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) fail('--min-verified must be a percentage from 0 to 100');
  if (!values.has('--verify')) fail('--min-verified needs --verify <testid-scan JSON>');
}
let viewport: { width: number; height: number } | undefined;
if (values.has('--viewport')) {
  const m = /^(\d+)x(\d+)$/.exec(values.get('--viewport')!);
  if (!m) fail('--viewport must look like 1280x800');
  viewport = { width: Number(m![1]), height: Number(m![2]) };
}
const storageState = values.get('--storage-state');
if (storageState && !existsSync(storageState)) fail(`Storage state not found: ${storageState}`);
let staticScan: StaticScan | undefined;
if (values.has('--verify')) {
  const path = values.get('--verify')!;
  if (!existsSync(path)) fail(`testid-scan JSON not found: ${path} (create it with: npx testid-scan src --json ${path})`);
  staticScan = JSON.parse(readFileSync(path, 'utf8')) as StaticScan;
  if (!Array.isArray(staticScan.elements)) fail(`${path} is not testid-scan --json output`);
}

try {
  const result = await scanPages(urls, {
    testIdAttribute: values.get('--attr'), storageState, wait, viewport, headed: flags.has('--headed'), staticScan,
    onPage: (p) => { if (format === 'text') console.error(`Scanned ${p.url}: ${p.totals.elements} elements`); },
  });
  const reportPath = resolve(values.get('--out') ?? 'testid-page.md');
  writeFileSync(reportPath, renderMarkdown(result));
  if (values.has('--json')) writeFileSync(resolve(values.get('--json')!), `${JSON.stringify(result, null, 2)}\n`);
  if (values.has('--summary')) writeFileSync(resolve(values.get('--summary')!), `${JSON.stringify({ pages: result.totals, verify: result.verify?.summary ?? null }, null, 2)}\n`);
  console.log(format === 'quiet' ? summaryLine(result) : renderText(result));
  console.log(`Report: ${reportPath}`);

  const failures: string[] = [];
  if (flags.has('--fail-on-todo') && result.totals.todo > 0) failures.push(`${result.totals.todo} to do`);
  // only a locator testid-scan expected to be unique is a failure; repeated ones were already reported as such
  const ambiguous = result.verify?.checked.filter((c) => c.result === 'ambiguous' && c.scope === 'page-candidate').length ?? 0;
  if (flags.has('--fail-on-ambiguous') && ambiguous > 0) failures.push(`${ambiguous} testid-scan locators expected to be unique match more than one element`);
  const wrong = result.verify?.checked.filter((c) => c.result === 'wrong target' && (flags.has('--strict-target') || c.target?.check === 'exact')).length ?? 0;
  if (flags.has('--fail-on-wrong-target') && wrong > 0) failures.push(`${wrong} testid-scan locators find another element than their source line's`);
  const incorrect = result.verify?.checked.filter((c) => c.verdict === 'verified incorrect').length ?? 0;
  if (flags.has('--fail-on-incorrect') && incorrect > 0) failures.push(`${incorrect} testid-scan locators verified incorrect`);
  const minVerified = values.has('--min-verified') ? Number(values.get('--min-verified')) : undefined;
  if (minVerified !== undefined && result.verify?.summary && result.verify.summary.verifiedShare < minVerified) failures.push(`${result.verify.summary.verifiedShare}% of the testid-scan locators verified, below ${minVerified}%`);
  if (failures.length) {
    console.error(`Failed: ${failures.join('; ')}. See ${reportPath}`);
    process.exit(1);
  }
} catch (error) {
  // Playwright adds a call log under the first line; the first line says what went wrong
  fail((error as Error).message.split('\n')[0].replace(/^page\.goto: /, 'Could not open the page: '));
}
