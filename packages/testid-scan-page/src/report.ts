import type { Counts, PageElement, ScanPageResult, Status } from './types.ts';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const code = (text: string) => (text.includes('`') ? `\`\` ${text} \`\`` : `\`${text}\``);
const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const TODO: Status[] = ['Needs test ID', 'Missing name', 'Fix test ID'];

/** One line of counts, the same in every version, for scripts that read the output. */
export function summaryLine(result: ScanPageResult): string {
  const t = result.totals;
  const v = result.verify;
  const n = (r: string) => v?.checked.filter((c) => c.result === r).length ?? 0;
  const d = (x: string) => v?.checked.filter((c) => c.verdict === x).length ?? 0;
  const verify = v ? `; Verified correct=${d('verified correct')}; Verified incorrect=${d('verified incorrect')}; Unable to verify=${d('unable to verify')}; Verified matched=${n('matched')}; Verified wrong target=${n('wrong target')}; Verified ambiguous=${n('ambiguous')}; Verified not found=${n('not found')}; Verified not visited=${n('not visited')}` : '';
  return `Pages=${result.pages.length}; Elements=${t.elements}; OK(test ID)=${t.okId}; OK(name)=${t.okName}; Needs test ID=${t.needsId}; Missing name=${t.missingName}; Fix test ID=${t.fixId}; To do=${t.todo}; Manual review=${t.review}${verify}`;
}

const what = (e: PageElement) => (e.role ? `${e.role}${e.name ? ` "${e.name}"` : ' (no name)'}` : `<${e.tag}>`);

/** Terminal output: the work to do, page by page. */
export function renderText(result: ScanPageResult, limit = 60): string {
  const lines: string[] = [];
  for (const p of result.pages) {
    const todo = p.elements.filter((e) => TODO.includes(e.status) || e.status === 'Manual review');
    if (!todo.length) continue;
    lines.push(p.url);
    for (const e of todo.slice(0, limit)) lines.push(`  ${e.status.padEnd(14)} ${what(e)}: ${e.reason ?? ''}  [${e.selector}]`);
    if (todo.length > limit) lines.push(`  ... ${todo.length - limit} more in the report`);
    lines.push('');
  }
  const t = result.totals;
  lines.push(`${t.todo} to do · ${t.review} to review · ${t.okId + t.okName} ok · ${plural(result.pages.length, 'page')}`);
  if (result.verify) {
    const v = result.verify.checked;
    const of = (x: string) => v.filter((c) => c.verdict === x);
    const sum = result.verify.summary;
    lines.push(`testid-scan locators: ${of('verified correct').length} verified correct · ${of('verified incorrect').length} verified incorrect · ${of('unable to verify').length} unable to verify${sum ? ` (${sum.verifiedShare}% verified)` : ''} · ${result.verify.skipped} skipped (record-scoped)`);
    for (const c of risky(of('verified incorrect')).slice(0, limit)) lines.push(`  Incorrect: ${c.file}:${c.line} ${c.locator}: ${c.why}${c.remediation ? `\n    -> ${c.remediation}` : ''}`);
    for (const [why, n] of reasons(of('unable to verify'))) lines.push(`  Unable (${n}): ${why}`);
  }
  return lines.join('\n');
}

/** Incorrect locators, most harmful first: those testid-scan promised were unique, then wrong targets, then the rest. */
function risky<T extends { scope: string; evidence?: string }>(items: T[]): T[] {
  const weight = (c: T) => (c.scope === 'page-candidate' ? 0 : 2) + (c.evidence === 'match count' ? 1 : 0);
  return [...items].sort((a, b) => weight(a) - weight(b));
}

/** Why locators could not be verified, most frequent first (the record-specific part of a reason is left out). */
function reasons(items: Array<{ why: string }>): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const { why } of items) { const key = why.split(':')[0]; counts.set(key, (counts.get(key) ?? 0) + 1); }
  return [...counts].sort((a, b) => b[1] - a[1]);
}

function countTable(rows: Array<[string, Counts]>): string[] {
  const headers = ['Page', 'Elements', 'OK (test ID)', 'OK (name)', 'Needs test ID', 'Missing name', 'Fix test ID', 'To do', 'Manual review'];
  return [
    `| ${headers.join(' | ')} |`, `|---|${headers.slice(1).map(() => '---:').join('|')}|`,
    ...rows.map(([name, c]) => `| ${cell(name)} | ${[c.elements, c.okId, c.okName, c.needsId, c.missingName, c.fixId, c.todo, c.review].join(' | ')} |`),
  ];
}

export function renderMarkdown(result: ScanPageResult): string {
  const t = result.totals;
  const lines: string[] = [
    '# Page Locator Status', '',
    `**${t.todo} to do, ${t.review} to review, ${t.okId + t.okName} ok** on ${plural(result.pages.length, 'page')} (${plural(t.elements, 'element')}). Scanned: ${result.scannedOn}. Test ID attribute: \`${result.testIdAttribute}\`.`, '',
    'Every locator below was run in the browser and matched exactly one element on the page as it was when scanned.',
    'Only the visible state of each page is seen: closed dialogs, other tabs, other users and empty lists are not.', '',
    ...countTable(result.pages.map((p) => [p.title || p.url, p.totals] as [string, Counts])), '',
  ];

  for (const p of result.pages) {
    lines.push(`## ${p.title || p.url}`, '', p.url, '');
    const groups: Array<[string, Status]> = [['Add a test ID', 'Needs test ID'], ['Add an accessible name', 'Missing name'], ['Fix the test ID', 'Fix test ID'], ['Check by hand', 'Manual review']];
    for (const [title, status] of groups) {
      const items = p.elements.filter((e) => e.status === status);
      if (!items.length) continue;
      lines.push(`### ${title} (${items.length})`, '');
      for (const e of items) lines.push(`- ${what(e)} | ${e.reason ?? ''} | ${code(e.selector)} | ${code(e.html)}`);
      lines.push('');
    }
    const ok = p.elements.filter((e) => e.locator);
    if (ok.length) {
      lines.push(`### Locators that work (${ok.length})`, '');
      for (const e of ok) lines.push(`- ${what(e)} | ${code(e.locator!)}${e.reason ? ` | ${e.reason}` : ''}`);
      lines.push('');
    }
    const findings = p.elements.flatMap((e) => e.findings.filter((f) => f.rule !== 'duplicate-test-id').map((f) => `- ${what(e)} | ${f.rule}: ${f.message} | ${code(e.selector)}`));
    if (findings.length) lines.push(`### Accessibility findings (${findings.length})`, '', ...findings, '');
  }

  if (result.verify) {
    const v = result.verify.checked;
    const of = (x: string) => v.filter((c) => c.verdict === x);
    const sum = result.verify.summary;
    const where = (c: (typeof v)[number]) => c.pages.filter((p) => p.count > 0 || p.fileShown).slice(0, 3).map((p) => `${p.label} (${p.count})`).join(', ') || '-';
    const row = (c: (typeof v)[number]) => `| ${cell(`${c.file}:${c.line}`)} | ${c.framework ?? '-'} | ${code(c.locator)} | ${c.evidence ?? '-'} | ${cell(where(c))} | ${cell(c.why)} | ${cell(c.remediation ?? '')} |`;
    const head = ['| Source | Framework | Locator | Evidence | Checked in (matches) | Why | What to do |', '|---|---|---|---|---|---|---|'];
    lines.push('## testid-scan locators run on these pages', '',
      `**${of('verified correct').length} verified correct · ${of('verified incorrect').length} verified incorrect · ${of('unable to verify').length} unable to verify**${sum ? ` (${sum.verifiedShare}% verified)` : ''} · ${result.verify.skipped} skipped (record-scoped, with <...> to fill in)`, '',
      'A verdict is given only on evidence, and only from the states that show the locator\'s component. Evidence, strongest first:',
      'source line (data-tsrc), component ownership (Angular host, Vue development build), elimination (only one element',
      'on the page can be it), match count (several matches). A guess (heuristic) never verifies: it stays unable to verify.', '');
    const incorrect = risky(of('verified incorrect'));
    if (incorrect.length) lines.push(`### Incorrect: do not use (${incorrect.length})`, '', 'A test using these acts on the wrong element, on several, or fails to find one. Those testid-scan expected to be unique come first.', '', ...head, ...incorrect.map(row), '');
    const unable = of('unable to verify');
    if (unable.length) {
      lines.push(`### Unable to verify: review by hand (${unable.length})`, '', '| Why | Locators |', '|---|---:|', ...reasons(unable).map(([why, n]) => `| ${why} | ${n} |`), '', ...head, ...unable.map(row), '');
    }
    const correct = of('verified correct');
    if (correct.length) lines.push(`### Verified correct: safe to use (${correct.length})`, '', ...head, ...correct.map(row), '');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
