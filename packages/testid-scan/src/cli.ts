#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { loadConfigFile } from './config.ts';
import type { Config } from './config.ts';
import { compareWithBaseline, createBaseline } from './baseline.ts';
import type { Baseline } from './baseline.ts';
import { renderGithub, renderMarkdown, renderText, summaryLine } from './report.ts';
import { scan } from './scan.ts';

const HELP = `testid-scan <folder> [options]

Reads the Angular templates, React components and Vue single-file components under <folder> and reports which elements a UI test can find by
role and accessible name, and which ones need a test ID or a name. It never changes your files.

Options
  --out <file>        Markdown report (default: testid-status.md)
  --json <file>       also write the full result as JSON
  --locators          list the recommended locator of every element in the report
  --config <file>     config file (default: testid-scan.config.json in the current folder, if present)
  --framework <name>  angular, react, vue or auto (default: auto, from the nearest package.json)
  --prefixes <a,b>    allowed first word(s) of a test ID
  --attr <name>       test ID attribute (default: data-testid)
  --i18n <file>       translation JSON; translated keys are resolved to their text
  --strict            require a test ID on every element
  --require-suffix    require test IDs to be <context>-<type> and end in a known type (orders-save-button)
  --baseline <file>   compare with a saved baseline: only findings that are not in it are listed and fail the gates
  --update-baseline   write the current findings to the --baseline file
  --format <name>     terminal output: text (default), github (annotations for GitHub Actions) or quiet (one line of counts)
  --all-html          Angular: scan every *.html file, not only component templates
  --no-inline         Angular: do not scan inline templates in *.ts files
  --fail-on-todo      exit 1 while To do > 0 or Violations > 0 (with a baseline: while there are new ones)
  --fail-on-review    exit 1 while Manual review > 0 (with a baseline: while there are new ones)
  --help, --version

Exit codes: 0 ok, 1 a --fail-on-* gate failed, 2 wrong usage or unreadable input.`;

const VALUE_FLAGS = new Set(['--out', '--json', '--config', '--framework', '--prefixes', '--attr', '--i18n', '--baseline', '--format']);
const BOOLEAN_FLAGS = new Set(['--strict', '--require-suffix', '--update-baseline', '--all-html', '--no-inline', '--fail-on-todo', '--fail-on-review', '--locators', '--help', '--version']);

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

const values = new Map<string, string>();
const flags = new Set<string>();
const positional: string[] = [];
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
  else positional.push(arg);
}

if (flags.has('--help')) { console.log(HELP); process.exit(0); }
if (flags.has('--version')) {
  console.log((JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version);
  process.exit(0);
}
if (positional.length !== 1) fail(HELP);
if (!existsSync(positional[0])) fail(`Folder not found: ${positional[0]}`);

try {
  const configPath = values.get('--config') ?? (existsSync('testid-scan.config.json') ? 'testid-scan.config.json' : undefined);
  const options: Partial<Config> = configPath ? loadConfigFile(configPath) : {};
  // command-line options win over the config file
  if (values.has('--framework')) options.framework = values.get('--framework') as Config['framework'];
  if (values.has('--prefixes')) options.prefixes = values.get('--prefixes')!.split(',').map((p) => p.trim()).filter(Boolean);
  if (values.has('--attr')) options.testIdAttribute = values.get('--attr')!;
  if (values.has('--i18n')) options.i18nFile = values.get('--i18n')!;
  if (flags.has('--strict')) options.strict = true;
  if (flags.has('--require-suffix')) options.requireTypeSuffix = true;
  if (flags.has('--all-html')) options.allHtml = true;
  if (flags.has('--no-inline')) options.inlineTemplates = false;

  const format = values.get('--format') ?? 'text';
  if (!['text', 'github', 'quiet'].includes(format)) fail(`--format must be text, github or quiet, not ${format}`);
  const baselinePath = values.get('--baseline');
  if (flags.has('--update-baseline') && !baselinePath) fail('--update-baseline needs --baseline <file>');

  const result = scan(positional[0], options);
  let baseline = undefined as ReturnType<typeof compareWithBaseline> | undefined;
  if (baselinePath && flags.has('--update-baseline')) writeFileSync(resolve(baselinePath), `${JSON.stringify(createBaseline(result), null, 2)}\n`);
  else if (baselinePath) {
    if (!existsSync(baselinePath)) fail(`Baseline not found: ${baselinePath}. Create it with --baseline ${baselinePath} --update-baseline`);
    baseline = compareWithBaseline(result, JSON.parse(readFileSync(baselinePath, 'utf8')) as Baseline);
  }

  const reportPath = resolve(values.get('--out') ?? 'testid-status.md');
  writeFileSync(reportPath, renderMarkdown(result, { locators: flags.has('--locators'), baseline }));
  if (values.has('--json')) writeFileSync(resolve(values.get('--json')!), `${JSON.stringify(result, null, 2)}\n`);

  // paths as seen from where the command runs, so an editor or GitHub can open them
  const pathPrefix = `${relative(process.cwd(), resolve(positional[0])).replace(/\\/g, '/')}/`.replace(/^\/$/, '');
  if (format === 'github') { const out = renderGithub(result, { pathPrefix, baseline }); if (out) console.log(out); }
  // quiet: one line of key=value pairs, the same in every version, for scripts that read the output
  console.log(format === 'quiet' ? summaryLine(result) : renderText(result, { pathPrefix, baseline, limit: format === 'text' ? 60 : 0 }));
  const { otherHtml, unreadable } = result.notScanned;
  if (otherHtml.length + unreadable.length) console.log(`Not scanned: ${otherHtml.length} other .html file(s), ${unreadable.length} unreadable template(s). See the report.`);
  if (baselinePath && flags.has('--update-baseline')) console.log(`Baseline written: ${resolve(baselinePath)}`);
  console.log(`Report: ${reportPath}`);

  const { totals } = result;
  const failures: string[] = [];
  const isTodo = (status: string) => status === 'Needs test ID' || status === 'Missing name' || status === 'Fix test ID';
  if (baseline) {
    const todo = baseline.added.filter((e) => isTodo(e.status) || e.violations.length).length;
    const review = baseline.added.filter((e) => e.status === 'Manual review').length;
    if (flags.has('--fail-on-todo') && todo > 0) failures.push(`${todo} new to do or violations`);
    if (flags.has('--fail-on-review') && review > 0) failures.push(`${review} new manual reviews`);
  } else {
    if (flags.has('--fail-on-todo') && totals.todo + totals.violations > 0) failures.push(`${totals.todo} to do, ${totals.violations} violations`);
    if (flags.has('--fail-on-review') && totals.review > 0) failures.push(`${totals.review} manual reviews`);
  }
  if (failures.length) {
    console.error(`Failed: ${failures.join('; ')}. See ${reportPath}`);
    process.exit(1);
  }
} catch (error) {
  fail((error as Error).message);
}
