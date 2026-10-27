import { countElements } from './classify.ts';
import type { BaselineDiff } from './baseline.ts';
import type { Counts, ElementRecord, ScanResult } from './types.ts';

const HEADERS = ['Elements', 'OK (test ID)', 'OK (name)', 'OK (reviewed)', 'Needs test ID', 'Missing name', 'Fix test ID', 'To do', 'Violations', 'Manual review', 'A11y findings'];

function countRow(c: Counts): string[] {
  return [c.elements, c.okId, c.okName, c.reviewed, c.needsId, c.missingName, c.fixId, c.todo, c.violations, c.review, c.a11y].map(String);
}

function table(headers: string[], rows: string[][]): string[] {
  const left = new Set(['Folder', 'File']);
  return [`| ${headers.join(' | ')} |`, `|${headers.map((h) => (left.has(h) ? '---' : '---:')).join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)];
}

/** Name as shown in the report; the translation key is kept next to translated text for debugging. */
function shownName(e: ElementRecord): string {
  if (!e.label) return '(no static name)';
  const keys = e.translationKeys.filter((k) => !e.label.includes(k));
  return keys.length ? `${e.label} [${keys.join(', ')}]` : e.label;
}

/** One line of the console summary. */
export function summaryLine(result: ScanResult): string {
  const t = result.totals;
  return `Files=${result.files.length}; Elements=${t.elements}; OK(test ID)=${t.okId}; OK(name)=${t.okName}; OK(reviewed)=${t.reviewed}; `
    + `Needs test ID=${t.needsId}; Missing name=${t.missingName}; Fix test ID=${t.fixId}; To do=${t.todo}; Violations=${t.violations}; Manual review=${t.review}; A11y findings=${t.a11y}`;
}

export interface ReportOptions {
  /** Add a section that lists the recommended locator of every element that has one. */
  locators?: boolean;
  /** The comparison with a baseline, when one was given. */
  baseline?: BaselineDiff;
}

/** `code` in Markdown; a backtick inside the code needs a longer fence. */
const code = (text: string) => (text.includes('`') ? `\`\` ${text} \`\`` : `\`${text}\``);

/** The work a To do item asks for, in the order it is usually done. */
const TASKS: Array<{ status: ElementRecord['status']; title: string }> = [
  { status: 'Needs test ID', title: 'Add a test ID' },
  { status: 'Missing name', title: 'Add an accessible name' },
  { status: 'Fix test ID', title: 'Fix the test ID' },
];
/**
 * The locator note under Manual review. Without it a repeated element's locator reads as if it were unique, while on
 * its own it matches every record. "Review required" is dropped: the section already says so.
 */
const reviewNote = (e: ElementRecord) => {
  const note = (e.locatorNote ?? '').split('; ').filter((part) => part && part !== 'review required: see the reason').join('; ');
  return note ? ` | ${note}` : '';
};
const isTodo = (e: ElementRecord) => TASKS.some((t) => t.status === e.status);
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
/** "1 file", "2 files". */
const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Files with the most items first, items of one file in line order. */
function byBusiestFile(items: ElementRecord[]): Array<[string, ElementRecord[]]> {
  const groups = new Map<string, ElementRecord[]>();
  for (const e of items) groups.set(e.file, [...(groups.get(e.file) ?? []), e]);
  return [...groups].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
}

const what = (e: ElementRecord) => (e.status === 'Fix test ID' ? `${e.kind} ${e.testId || '(empty)'}` : `${e.kind} ${e.label ? `"${e.label}"` : '(no name)'}`);

export interface TextOptions {
  /** Prefix for file paths, so they can be opened from where the command was run. */
  pathPrefix?: string;
  baseline?: BaselineDiff;
  /** Longest list to print; the rest is counted. */
  limit?: number;
}

/** What a developer needs in the terminal: the open to-dos by file and line, then one line of totals. */
export function renderText(result: ScanResult, options: TextOptions = {}): string {
  const prefix = options.pathPrefix ?? '';
  const limit = options.limit ?? 60;
  const all = options.baseline ? options.baseline.added.filter(isTodo) : result.elements.filter(isTodo);
  const lines: string[] = [];
  let printed = 0;
  for (const [file, items] of [...byBusiestFile(all)].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (printed >= limit) break;
    lines.push(`${prefix}${file}`);
    for (const e of items) {
      if (printed >= limit) break;
      lines.push(`  ${String(e.line).padStart(4)}  ${e.status.padEnd(13)}  ${what(e)}: ${e.reason ?? ''}${e.suggestedTestId ? ` (suggestion: ${e.suggestedTestId})` : ''}`);
      printed += 1;
    }
    lines.push('');
  }
  if (all.length > printed && limit > 0) lines.push(`... and ${all.length - printed} more, see the report`, '');
  const t = result.totals;
  const ok = t.okId + t.okName + t.reviewed;
  if (options.baseline) {
    const b = options.baseline;
    lines.push(`${b.added.filter(isTodo).length} new to do, ${b.added.filter((e) => e.status === 'Manual review').length} new to review, ${b.resolved} resolved since the baseline of ${b.createdOn}`);
  }
  lines.push(`${t.todo} to do · ${t.review} to review · ${ok} ok · ${t.violations} test ID violations · ${count(result.files.length, 'file')}`);
  return lines.join('\n');
}

/** GitHub Actions annotations: each to-do shows up next to its line in the pull request. */
export function renderGithub(result: ScanResult, options: TextOptions = {}): string {
  const esc = (text: string) => text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  const prop = (text: string) => esc(text).replace(/:/g, '%3A').replace(/,/g, '%2C');
  const items = options.baseline ? options.baseline.added : result.elements.filter((e) => isTodo(e) || e.status === 'Manual review');
  return items.map((e) => `::${isTodo(e) ? 'warning' : 'notice'} file=${prop(`${options.pathPrefix ?? ''}${e.file}`)},line=${e.line},title=${prop(`testid-scan: ${e.status}`)}::${esc(`${what(e)}: ${e.reason ?? ''}`)}`).join('\n');
}

export function renderMarkdown(result: ScanResult, options: ReportOptions = {}): string {
  const { elements, files } = result;
  const folders = [...new Set(files.map((f) => f.folder))].sort();
  const t = result.totals;
  const lines: string[] = [
    '# Test ID Status', '',
    `**${t.todo} to do, ${t.review} to review, ${t.okId + t.okName + t.reviewed} ok** in ${count(files.length, 'file')} (${count(t.elements, 'element')}). Test ID violations: ${t.violations}. Accessibility findings: ${t.a11y}.`, '',
  ];
  if (options.baseline) {
    const b = options.baseline;
    lines.push(`Since the baseline of ${b.createdOn}: **${b.added.length} new**, ${b.resolved} resolved. To do ${b.previous.todo} → ${t.todo} (${signed(t.todo - b.previous.todo)}), manual review ${b.previous.review} → ${t.review} (${signed(t.review - b.previous.review)}).`, '');
    if (b.added.length) {
      lines.push('## New since the baseline', '');
      for (const e of b.added) lines.push(`- ${e.file}:${e.line} | ${what(e)} | ${e.status}: ${e.reason ?? e.violations.join('; ')}`);
      lines.push('');
    }
  }
  lines.push(
    `Source: ${result.source} · Frameworks: ${result.frameworks.join(', ')} · Scanned: ${result.scannedOn}`, '',
    result.strict ? 'Policy: strict, every element needs a test ID.' : 'Policy: role first, test ID where needed.',
    'An area is ready for review when **To do = 0** and **Violations = 0**. To do = Needs test ID + Missing name + Fix test ID.',
    'This is static analysis of the source files. It does not prove that a locator is unique in the running application: everything under Manual review, and every OK (reviewed) item, still depends on a check in the browser.',
    'Recommended locators are built from the source and have not been run. Names are matched with `exact: true`; `<...>` stands for a value only known at runtime.', '',
    '## To do', '',
  );
  const todo = elements.filter(isTodo);
  if (!todo.length) lines.push('- None', '');
  for (const task of TASKS) {
    const items = todo.filter((e) => e.status === task.status);
    if (!items.length) continue;
    lines.push(`### ${task.title} (${items.length})`, '');
    for (const [, list] of byBusiestFile(items)) {
      for (const e of list) lines.push(`- ${e.file}:${e.line} | ${what(e)} | ${e.reason}${e.suggestedTestId ? ` | suggestion: ${code(e.suggestedTestId)}` : ''}`);
    }
    lines.push('');
  }

  lines.push('## Violations', '',
    'Every test ID that breaks a rule, including IDs on elements listed under Manual review.', '');
  const violations = elements.filter((e) => e.violations.length);
  if (!violations.length) lines.push('- None');
  for (const e of violations) lines.push(`- ${e.file}:${e.line} | ${e.kind} | ${e.testId || '(empty)'} | ${e.violations.join('; ')}`);

  lines.push('', '## Manual review (check in the browser)', '');
  const review = elements.filter((e) => e.status === 'Manual review');
  if (!review.length) lines.push('- None');
  for (const e of review) lines.push(`- ${e.file}:${e.line} | ${e.kind} | ${e.testId ?? shownName(e)} | ${e.reason} | fingerprint ${e.fingerprint}${e.recommendedLocator ? ` | ${code(e.recommendedLocator)}${reviewNote(e)}` : ''}`);

  lines.push('', '## Acknowledged by a reviewed marker', '');
  const acknowledged = elements.filter((e) => e.status === 'OK (reviewed)');
  if (!acknowledged.length) lines.push('- None');
  for (const e of acknowledged) lines.push(`- ${e.file}:${e.line} | ${e.kind} | ${e.testId ?? shownName(e)} | ${e.reason}`);

  lines.push('', '## Accessibility findings', '',
    'Reported next to the status, not instead of it: an element can be OK to locate and still be listed here. Not part of To do.', '');
  const withFindings = elements.filter((e) => e.accessibilityFindings.length);
  if (!withFindings.length) lines.push('- None');
  for (const certainty of ['confirmed', 'needs-review'] as const) {
    const items = withFindings.flatMap((e) => e.accessibilityFindings.filter((f) => f.certainty === certainty).map((f) => ({ e, f })));
    if (!items.length) continue;
    lines.push(certainty === 'confirmed' ? `### Confirmed in the source (${items.length})` : `### Rests on an assumption, check before acting (${items.length})`, '');
    for (const { e, f } of items) lines.push(`- ${e.file}:${e.line} | ${e.kind} | ${e.status} | ${f.rule}: ${f.message}`);
    lines.push('');
  }

  if (options.locators) {
    lines.push('## Recommended locators', '',
      'page-candidate: expected to match one element, checked within its own file only. record-scoped: narrow down to one record first. unknown: its reach cannot be told from the source.', '');
    const located = elements.filter((e) => e.recommendedLocator);
    if (!located.length) lines.push('- None');
    for (const e of located) lines.push(`- ${e.file}:${e.line} | ${e.locatorScope} | ${code(e.recommendedLocator as string)}${e.locatorNote ? ` | ${e.locatorNote}` : ''}`);
    lines.push('');
  }

  lines.push('## Same test ID in more than one file', '',
    'Not counted as a violation: it is a collision only if these files are rendered on the same page.', '');
  if (!result.sharedTestIds.length) lines.push('- None');
  for (const shared of result.sharedTestIds) lines.push(`- ${shared.testId} | ${shared.locations.join(', ')}`);

  lines.push('', '## Not scanned', '');
  const { otherHtml, unreadable } = result.notScanned;
  if (!otherHtml.length && !unreadable.length) lines.push('- None');
  if (otherHtml.length) {
    lines.push(`### Other HTML files (${otherHtml.length}): rerun with --all-html to include them`, '');
    for (const file of otherHtml) lines.push(`- ${file}`);
    lines.push('');
  }
  if (unreadable.length) {
    lines.push(`### Templates the scanner could not read (${unreadable.length}): check by hand`, '');
    for (const item of unreadable) lines.push(`- ${item.file} | ${item.reason}`);
  }
  lines.push('', '## Counts', '', '### Totals', '', ...table(['Files', ...HEADERS], [[String(files.length), ...countRow(result.totals)]]), '',
    '### Per folder', '',
    ...table(['Folder', 'Files', ...HEADERS], folders.map((folder) => {
      const inFolder = files.filter((f) => f.folder === folder);
      return [folder, String(inFolder.length), ...countRow(countElements(inFolder.flatMap((f) => f.elements)))];
    })), '',
    '### Per file', '',
    ...table(['Folder', 'File', ...HEADERS], [...files].sort((a, b) => `${a.folder}|${a.file}`.localeCompare(`${b.folder}|${b.file}`))
      .map((f) => [f.folder, f.file, ...countRow(countElements(f.elements))])));
  return `${lines.join('\n')}\n`;
}
