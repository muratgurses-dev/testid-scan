#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { generate } from './generate.ts';
import { readScan } from './read.ts';

const HELP = `testid-scan-bdd <scan.json> [options]

Reads a testid-scan-page --json result and writes step definitions for playwright-bdd, plus a catalog of the
steps a scenario can use on each scanned page. It never changes the scanned pages or your feature files.

Options
  --steps <file>     step definitions (default: steps/testid-scan.steps.ts)
  --catalog <file>   Markdown catalog of the steps per page (default: testid-steps.md)
  --help, --version

Exit codes: 0 ok, 2 wrong usage or unreadable input.`;

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

const argv = process.argv.slice(2);
const values = new Map<string, string>();
const positional: string[] = [];
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === '--help') { console.log(HELP); process.exit(0); }
  if (arg === '--version') {
    // dist/cli.js in the package; one level deeper when the tests run it from .test-build/src
    const manifest = ['../package.json', '../../package.json'].map((p) => new URL(p, import.meta.url)).find((u) => existsSync(u));
    console.log((JSON.parse(readFileSync(manifest as URL, 'utf8')) as { version: string }).version);
    process.exit(0);
  }
  if (arg === '--steps' || arg === '--catalog') {
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) fail(`${arg} needs a value`);
    values.set(arg, value);
    i += 1;
  } else if (arg.startsWith('--')) fail(`Unknown option ${arg}\n\n${HELP}`);
  else positional.push(arg);
}
if (positional.length !== 1) fail(HELP);
if (!existsSync(positional[0])) fail(`File not found: ${positional[0]}`);

let generated;
try {
  generated = generate(readScan(JSON.parse(readFileSync(positional[0], 'utf8'))));
} catch (error) {
  fail(`Cannot read ${positional[0]}: ${(error as Error).message}`);
}
const stepsPath = resolve(values.get('--steps') ?? 'steps/testid-scan.steps.ts');
const catalogPath = resolve(values.get('--catalog') ?? 'testid-steps.md');
mkdirSync(dirname(stepsPath), { recursive: true });
mkdirSync(dirname(catalogPath), { recursive: true });
writeFileSync(stepsPath, generated.steps);
writeFileSync(catalogPath, generated.catalog);

const steps = generated.pages.reduce((n, p) => n + p.steps.length, 0);
const unavailable = generated.pages.reduce((n, p) => n + p.unavailable.length, 0);
console.log(`${generated.pages.length} page${generated.pages.length === 1 ? '' : 's'} · ${steps} steps · ${Object.keys(generated.testIds).length} found by test ID · ${unavailable} not available yet`);
console.log(`Steps: ${stepsPath}`);
console.log(`Catalog: ${catalogPath}`);
