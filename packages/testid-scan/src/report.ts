import { countElements } from './classify.ts';
import type { BaselineDiff } from './baseline.ts';
import type { Counts, ElementRecord, FileResult, ScanResult } from './types.ts';

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
  /** The full 1.0 layout: one section per status for the whole scan, every section shown even when empty. */
  detailed?: boolean;
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
const plainReviewNote = (e: ElementRecord) => (e.locatorNote ?? '').split('; ').filter((part) => part && part !== 'review required: see the reason').join('; ');
/** The same, as a column of the detailed layout. */
const reviewNote = (e: ElementRecord) => (plainReviewNote(e) ? ` | ${plainReviewNote(e)}` : '');
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

/**
 * The Markdown report. By default it is grouped by file, each item with what to do about it, and the explanations
 * at the end; `detailed` gives the 1.0 layout.
 */
export function renderMarkdown(result: ScanResult, options: ReportOptions = {}): string {
  return options.detailed ? renderDetailed(result, options) : renderSummary(result, options);
}

const FRAMEWORK_NAMES: Record<string, string> = { angular: 'Angular', react: 'React', vue: 'Vue' };
const FRAMEWORK_SOURCE: Record<string, string> = {
  option: 'set by the framework option',
  'package.json': 'from package.json',
  default: 'no package.json names Angular, React or Vue, so all three were tried',
};

/** `<div>` "Select"; else the test ID or the placeholder the element is found by. */
const subject = (e: ElementRecord) => {
  const tag = code(`<${e.tag}>`);
  if (e.label) return `${tag} "${shownName(e).replace(/"/g, '\\"')}"`;
  if (e.testId) return `${tag} ${code(e.testId)}`;
  // a field without a label is located by its placeholder; the locator is built by this package, so its shape is known
  const placeholder = /getByPlaceholder\('((?:[^'\\]|\\.)*)'/.exec(e.recommendedLocator ?? '')?.[1];
  return placeholder ? `${tag} placeholder "${placeholder.replace(/\\'/g, "'")}"` : tag;
};

/** A placeholder the scanner writes for a value it cannot know: <entity>, <value>, <record>, <...>. */
const PLACEHOLDER = '<(?:entity|value|record|\\.\\.\\.)>';
const WORD_PART = `(?:[\\w.:[\\]{}="-]|${PLACEHOLDER})`;
const PLACEHOLDER_WORD = new RegExp(`${WORD_PART}*${PLACEHOLDER}${WORD_PART}*`, 'g');

/** HTML tags and placeholders in a reason, as code, so a Markdown viewer shows them instead of reading them as markup. */
const tagsAsCode = (text: string) => text
  // a word with a placeholder in it: data-<entity>-id, [attr.data-<entity>-id]="<record>.id"
  .replace(PLACEHOLDER_WORD, (word) => code(word))
  // a tag: <div>, <a href>, [<app-row> is rendered ...]
  .replace(/(^|[\s([])(<\/?[a-zA-Z][\w-]*(?:\s[^<>`]*)?>)/g, (_m, before: string, tag: string) => `${before}${code(tag)}`);

/** Accessibility findings that say something the status line does not already say. */
function extraFindings(e: ElementRecord): string[] {
  return e.accessibilityFindings
    .filter((f) => !(f.rule === 'no-role' && e.status === 'Needs test ID') && !(f.rule === 'missing-name' && e.status === 'Missing name'))
    .map((f) => `${f.certainty === 'needs-review' ? 'accessibility, check this: ' : 'accessibility: '}${f.message}`);
}

/** What a To do or To review item says after its line number. */
function summaryText(e: ElementRecord): string {
  const reason = e.reason ?? e.violations.join('; ');
  const parts = [`${subject(e)}: ${tagsAsCode(reason)}`];
  if (e.status === 'Needs test ID' && /^name ".*" appears more than once/.test(reason)) parts.push('give each one its own test ID');
  if (e.suggestedTestId) parts.push(`suggested test ID: ${code(e.suggestedTestId)}`);
  if (e.status !== 'Fix test ID' && e.violations.length) parts.push(`test ID: ${e.violations.join('; ')}`);
  if (e.status === 'Manual review') {
    if (e.recommendedLocator) parts.push(`locator: ${code(e.recommendedLocator)}${plainReviewNote(e) ? ` (${plainReviewNote(e)})` : ''}`);
    parts.push(`fingerprint ${code(e.fingerprint ?? '')}`);
  }
  parts.push(...extraFindings(e));
  return parts.join(' · ');
}

/** One bullet per item; items that say exactly the same thing are joined: "L11, L12 `<button>` "Delete": ...". */
function summaryItems(items: ElementRecord[]): string[] {
  const groups: Array<{ lines: number[]; text: string }> = [];
  for (const e of items) {
    const text = summaryText(e);
    const same = groups.find((g) => g.text === text);
    if (same) same.lines.push(e.line); else groups.push({ lines: [e.line], text });
  }
  return groups.map((g) => `- ${g.lines.map((n) => `L${n}`).join(', ')} ${g.text}`);
}

/** The default report: what to do, by file. */
function renderSummary(result: ScanResult, options: ReportOptions): string {
  const { elements, files } = result;
  const t = result.totals;
  const ok = t.okId + t.okName + t.reviewed;
  const frameworks = result.frameworks.map((f) => FRAMEWORK_NAMES[f] ?? f).join(', ');
  const source = result.frameworkSource ? ` (${FRAMEWORK_SOURCE[result.frameworkSource]})` : '';
  const lines: string[] = [
    `# Test ID Status: ${t.todo} to do, ${t.review} to review, ${ok} OK`, '',
    `${count(files.length, 'file')} · ${count(t.elements, 'element')} · ${count(t.violations, 'test ID violation')} · ${count(t.a11y, 'accessibility finding')} · `
      + `${result.strict ? 'strict: every element needs a test ID' : 'role first, test ID where needed'} · ${frameworks}${source} · scanned ${result.scannedOn}`, '',
  ];
  if (options.baseline) {
    const b = options.baseline;
    lines.push(`Since the baseline of ${b.createdOn}: **${b.added.length} new**, ${b.resolved} resolved. To do ${b.previous.todo} → ${t.todo} (${signed(t.todo - b.previous.todo)}), manual review ${b.previous.review} → ${t.review} (${signed(t.review - b.previous.review)}).`, '');
    if (b.added.length) {
      lines.push('## New since the baseline', '');
      for (const e of b.added) lines.push(`- ${e.file}:${e.line} ${subject(e)} · ${e.status}: ${e.reason ?? e.violations.join('; ')}`);
      lines.push('');
    }
  }

  const needsAttention = (f: FileResult) => f.elements.some((e) => (e.status !== 'OK (test ID)' && e.status !== 'OK (name)') || e.accessibilityFindings.length > 0 || e.violations.length > 0);
  const sorted = [...files].sort((a, b) => a.file.localeCompare(b.file));
  for (const f of sorted.filter(needsAttention)) {
    const byLine = [...f.elements].sort((a, b) => a.line - b.line);
    const todo = byLine.filter(isTodo);
    const review = byLine.filter((e) => e.status === 'Manual review');
    const reviewed = byLine.filter((e) => e.status === 'OK (reviewed)');
    const fine = byLine.filter((e) => e.status === 'OK (test ID)' || e.status === 'OK (name)');
    const counts = [todo.length && `${todo.length} to do`, review.length && `${review.length} to review`].filter(Boolean).join(', ');
    lines.push(`## ${f.file}${counts ? ` (${counts})` : ''}`, '');
    if (todo.length) lines.push(`**To do (${todo.length})**`, '', ...summaryItems(todo), '');
    if (review.length) lines.push(`**To review in the browser (${review.length})**`, '', ...summaryItems(review), '');
    if (reviewed.length) lines.push(`**Marked reviewed by a person (${reviewed.length})**`, '', ...summaryItems(reviewed), '');
    if (fine.length) {
      lines.push(`**OK (${fine.length}):** ${fine.map((e) => `L${e.line} ${subject(e)}`).join(', ')}`, '');
      const notes = fine.filter((e) => extraFindings(e).length);
      if (notes.length) lines.push(...notes.map((e) => `- L${e.line} ${subject(e)}: ${tagsAsCode(extraFindings(e).join(' · '))}`), '');
    }
  }
  const clean = sorted.filter((f) => !needsAttention(f));
  if (clean.length) {
    const shown = clean.slice(0, 20).map((f) => f.file);
    lines.push(`**Nothing to do in ${count(clean.length, 'file')}:** ${shown.join(', ')}${clean.length > shown.length ? `, and ${clean.length - shown.length} more` : ''}`, '');
  }
  if (!files.length) lines.push('No templates found.', '');

  if (result.sharedTestIds.length) {
    lines.push('## Same test ID in more than one file', '',
      'Not counted as a violation: it is a collision only if these files are rendered on the same page.', '');
    for (const shared of result.sharedTestIds) lines.push(`- ${code(shared.testId)}: ${shared.locations.join(', ')}`);
    lines.push('');
  }
  const { otherHtml, unreadable } = result.notScanned;
  if (otherHtml.length || unreadable.length) {
    lines.push('## Not scanned', '');
    if (otherHtml.length) lines.push(`- ${count(otherHtml.length, 'other HTML file')} (rerun with --all-html to include them): ${otherHtml.join(', ')}`);
    for (const item of unreadable) lines.push(`- ${item.file}: could not be read (${item.reason}), check it by hand`);
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

  const folders = [...new Set(files.map((f) => f.folder))].sort();
  lines.push('## Totals', '', ...table(['Files', ...HEADERS], [[String(files.length), ...countRow(t)]]), '');
  if (folders.length > 1) {
    lines.push(...table(['Folder', 'Files', ...HEADERS], folders.map((folder) => {
      const inFolder = files.filter((f) => f.folder === folder);
      return [folder, String(inFolder.length), ...countRow(countElements(inFolder.flatMap((f) => f.elements)))];
    })), '');
  }

  lines.push('## How to read this report', '',
    '- **To do**: an element a test cannot find yet (it needs a test ID or an accessible name), or a test ID that breaks a naming rule. A folder is ready for review when To do and test ID violations are 0.',
    '- **To review**: the scanner cannot decide from the source. Check it in the browser, then fix it or mark it reviewed.',
    '- **OK**: a test can find it by its test ID, or by its role and accessible name.',
    '- **Accessibility** notes are shown next to the status, not instead of it: an element can be OK to locate and still have one. They are not part of To do.',
    '- This is static analysis. It does not prove that a locator is unique in the running application. Recommended locators are built from the source and have not been run; names are matched with `exact: true`, and `<...>` stands for a value only known at runtime.');
  if (t.review) {
    lines.push('- **Marking an item as reviewed**: put `<!-- testid-scan: reviewed <fingerprint> -->` (React: `{/* testid-scan: reviewed <fingerprint> */}`) directly before the element. '
      + 'When the element changes, the fingerprint no longer matches and the item comes back.');
  }
  lines.push('- For one section per status across the whole scan, run with `--detailed`.');
  return `${lines.join('\n')}\n`;
}

function renderDetailed(result: ScanResult, options: ReportOptions): string {
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
