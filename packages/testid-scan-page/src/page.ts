/**
 * Scans one loaded page: lists the interactive elements, asks the browser for each one's role and
 * accessible name, and runs the locators a test would use to count what they match.
 */
import type { Locator, Page } from 'playwright';
import type { Counts, PageElement, PageFinding, PageResult, Status } from './types.ts';

/** Attribute put on each element while the page is scanned, so it can be found again. Removed afterwards. */
export const MARK = 'data-testid-scan-page';

/** Roles a user clicks, types into or selects: the ones a test locates with getByRole. */
export const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option',
  'textbox', 'searchbox', 'combobox', 'listbox', 'slider', 'spinbutton', 'treeitem',
]);

/** What the page itself says about one element, before the browser is asked for its role and name. */
interface RawElement {
  id: number;
  selector: string;
  html: string;
  tag: string;
  testId?: string;
  /** Matched only because the mouse pointer turns into a hand over it: a guess, not a certainty. */
  pointerOnly: boolean;
  /** Inside aria-hidden="true": assistive technology and getByRole do not see it. */
  hiddenFromAT: boolean;
  /** The table row or list item around it, with its first line of text, to narrow a repeated element down. */
  rowRole?: 'row' | 'listitem';
  rowText?: string;
}

/** A JavaScript string literal in single quotes (same format as testid-scan). */
export function quote(text: string): string {
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, '\\\'').replace(/\r?\n/g, '\\n')}'`;
}

/**
 * Role and name from the first line of an ARIA snapshot, e.g. `- button "Save"`.
 * Returns an empty role when the element has no role a test could query (generic, text, ...).
 */
export function parseSnapshot(snapshot: string): { role: string; name: string } {
  let line = snapshot.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  line = line.replace(/^- /, '');
  // YAML quotes the whole entry in single quotes when it contains special characters
  if (line.startsWith("'")) line = line.slice(1).replace(/'(?=:?\s*$)|'$/, '').replace(/''/g, "'");
  const m = /^([a-z]+)(?:\s+"((?:[^"\\]|\\.)*)")?/.exec(line);
  if (!m || !INTERACTIVE_ROLES.has(m[1])) return { role: '', name: '' };
  return { role: m[1], name: (m[2] ?? '').replace(/\\(["\\])/g, '$1') };
}

/** Runs in the page: finds the interactive elements and marks each one with MARK. */
function collectInPage({ attr, mark, roles }: { attr: string; mark: string; roles: string[] }): RawElement[] {
  const NATIVE = 'a[href],area[href],button,input:not([type=hidden]),select,textarea,summary,[contenteditable=""],[contenteditable="true"]';
  const roleSet = new Set(roles);
  const interactiveSelector = `${NATIVE},${roles.map((r) => `[role="${r}"]`).join(',')}`;
  const visible = (el: Element) => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    if (getComputedStyle(el).visibility === 'hidden') return false;
    return typeof el.checkVisibility === 'function' ? el.checkVisibility() : true;
  };
  const cursorOf = (el: Element | null) => (el ? getComputedStyle(el).cursor : '');
  const selectorOf = (el: Element) => {
    const parts: string[] = [];
    for (let e: Element | null = el; e && e !== document.body && parts.length < 4; e = e.parentElement) {
      let part = e.tagName.toLowerCase();
      if (e.id && /^[A-Za-z][\w-]*$/.test(e.id)) { parts.unshift(`${part}#${e.id}`); break; }
      const tid = e.getAttribute(attr);
      if (tid && !/["\\]/.test(tid)) { parts.unshift(`${part}[${attr}="${tid}"]`); break; }
      const same = e.parentElement ? [...e.parentElement.children].filter((c) => c.tagName === e!.tagName) : [];
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(e) + 1})`;
      parts.unshift(part);
    }
    return parts.join(' > ');
  };

  const found: RawElement[] = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.hasAttribute(mark)) el.removeAttribute(mark);
    const role = (el.getAttribute('role') ?? '').trim().split(/\s+/)[0];
    const native = el.matches(NATIVE);
    const byRole = roleSet.has(role);
    const focusable = el.hasAttribute('tabindex') && (el as HTMLElement).tabIndex >= 0;
    const onclick = el.hasAttribute('onclick');
    // where the hand cursor starts (not every child of a clickable area)
    const pointer = cursorOf(el) === 'pointer' && cursorOf(el.parentElement) !== 'pointer' && el.tagName !== 'LABEL';
    if (!native && !byRole && !focusable && !onclick && !pointer) continue;
    if (!native && !byRole) {
      // a wrapper around a real control, or a part of one, is not a control of its own
      if (el.querySelector(interactiveSelector)) continue;
      if (el.parentElement?.closest(interactiveSelector)) continue;
      if (['HTML', 'BODY', 'SVG', 'PATH', 'IMG'].includes(el.tagName.toUpperCase()) && !onclick && !focusable) continue;
    }
    if (!visible(el)) continue;
    const id = found.length;
    el.setAttribute(mark, String(id));
    const row = el.parentElement?.closest('tr,[role="row"],li,[role="listitem"]');
    // what tells this row apart: the first cell with text in a table row, the first line in a list item
    const isTableRow = Boolean(row?.matches('tr,[role="row"]'));
    const firstText = (node: Element) => ((node as HTMLElement).innerText ?? '').split(/[\n\t]/).map((t) => t.trim()).find(Boolean);
    const rowText = !row ? undefined : (isTableRow
      ? [...row.querySelectorAll('td,th,[role="cell"],[role="gridcell"]')].map(firstText).find(Boolean)
      : firstText(row))?.slice(0, 60);
    const start = el.outerHTML.slice(0, el.outerHTML.indexOf('>') + 1).replace(new RegExp(`\\s${mark}="\\d+"`), '');
    found.push({
      id, selector: selectorOf(el), html: start.length > 140 ? `${start.slice(0, 137)}...` : start, tag: el.tagName.toLowerCase(),
      testId: el.getAttribute(attr) ?? undefined,
      pointerOnly: !native && !byRole && !focusable && !onclick,
      hiddenFromAT: Boolean(el.closest('[aria-hidden="true"]')),
      rowRole: row ? (row.matches('tr,[role="row"]') ? 'row' : 'listitem') : undefined,
      rowText: rowText || undefined,
    });
  }
  return found;
}

export interface PageOptions {
  testIdAttribute: string;
}

/** Scan the page as it is now (the caller has loaded it and waited for it to settle). */
export async function scanLoadedPage(page: Page, options: PageOptions): Promise<PageResult> {
  const attr = options.testIdAttribute;
  const raws = await page.evaluate(collectInPage, { attr, mark: MARK, roles: [...INTERACTIVE_ROLES] });

  // the same locator is often asked for many times (every "Edit" in a table): count each one once
  const counts = new Map<string, number>();
  const countOf = async (key: string, make: () => Locator) => {
    if (!counts.has(key)) counts.set(key, await make().count().catch(() => 0));
    return counts.get(key) as number;
  };
  const visibleTestIds = (tid: string) => countOf(`tid|${tid}`, () => page.getByTestId(tid).filter({ visible: true }));
  const byName = (role: string, name: string) => countOf(`role|${role}|${name}`, () => page.getByRole(role as Parameters<Page['getByRole']>[0], { name, exact: true }));

  const elements: PageElement[] = [];
  try {
  for (const raw of raws) {
    const own = page.locator(`[${MARK}="${raw.id}"]`);
    const { role, name } = raw.hiddenFromAT ? { role: '', name: '' } : parseSnapshot(await own.ariaSnapshot({ timeout: 2000 }).catch(() => ''));
    const nameMatches = role && name ? await byName(role, name) : 0;
    const testIdMatches = raw.testId ? await visibleTestIds(raw.testId) : 0;
    const roleLocator = `page.getByRole(${quote(role)}, { name: ${quote(name)}, exact: true })`;
    const testIdLocator = raw.testId ? `page.getByTestId(${quote(raw.testId)})` : undefined;
    const uniqueTestId = raw.testId !== undefined && raw.testId.trim() !== '' && testIdMatches === 1;
    const findings: PageFinding[] = [];
    let status: Status; let reason: string | undefined; let locator: string | undefined;

    if (!role) {
      if (raw.pointerOnly) findings.push({ rule: 'no-role', message: `<${raw.tag}> looks clickable (pointer cursor) but has no role: if it is a control, use <button> / <a href>` });
      else findings.push({ rule: 'no-role', message: raw.hiddenFromAT ? 'inside aria-hidden="true": hidden from assistive technology and from getByRole' : `<${raw.tag}> is focusable or clickable but has no role a test can query` });
      if (uniqueTestId) { status = 'OK (test ID)'; locator = testIdLocator; }
      else if (raw.pointerOnly) { status = 'Manual review'; reason = 'looks clickable (pointer cursor) but has no role: check whether it is a control'; }
      else { status = 'Needs test ID'; reason = findings[0].message; }
    } else if (!name) {
      findings.push({ rule: 'missing-name', message: 'no accessible name (add visible text, a label or aria-label)' });
      if (uniqueTestId) { status = 'OK (test ID)'; locator = testIdLocator; }
      else { status = 'Missing name'; reason = `${role} without an accessible name: getByRole cannot tell it apart`; }
    } else if (nameMatches === 1) {
      status = 'OK (name)'; locator = roleLocator;
    } else if (uniqueTestId) {
      status = 'OK (test ID)'; locator = testIdLocator;
      reason = nameMatches > 1 ? `name "${name}" matches ${nameMatches} elements; the test ID is unique` : undefined;
    } else if (nameMatches === 0) {
      status = 'Manual review'; reason = `the browser names it ${role} "${name}", but getByRole found nothing with that name`;
    } else {
      // repeated: try to narrow it down to its row or list item
      let scoped: string | undefined;
      if (raw.rowRole && raw.rowText) {
        const n = await countOf(`row|${raw.rowRole}|${raw.rowText}|${role}|${name}`, () => page.getByRole(raw.rowRole as 'row').filter({ hasText: raw.rowText }).getByRole(role as 'button', { name, exact: true }));
        if (n === 1) scoped = `page.getByRole(${quote(raw.rowRole)}).filter({ hasText: ${quote(raw.rowText)} }).getByRole(${quote(role)}, { name: ${quote(name)}, exact: true })`;
      }
      if (scoped) { status = 'OK (name)'; locator = scoped; reason = `repeated (${nameMatches} on the page): unique inside its ${raw.rowRole === 'row' ? 'row' : 'list item'}`; }
      else { status = 'Needs test ID'; reason = `name "${name}" matches ${nameMatches} elements on the page`; }
    }

    // a test ID that is there but not unique is work to do, whatever else found the element
    if (raw.testId !== undefined && !uniqueTestId) {
      const message = raw.testId.trim() === '' ? 'empty test ID' : `test ID "${raw.testId}" is on ${testIdMatches} visible elements`;
      findings.push({ rule: 'duplicate-test-id', message });
      if (status === 'OK (name)' || status === 'Needs test ID') { status = 'Fix test ID'; reason = reason ? `${message}; ${reason}` : message; }
    }
    elements.push({ selector: raw.selector, html: raw.html, tag: raw.tag, role, name, testId: raw.testId, nameMatches, testIdMatches, status, reason, locator, findings });
  }
  } finally {
    // the page is left as it was, also when a step above failed
    await page.evaluate((mark) => {
      const all = document.getElementsByTagName('*');
      for (let k = 0; k < all.length; k += 1) if (all[k].hasAttribute(mark)) all[k].removeAttribute(mark);
    }, MARK).catch(() => undefined);
  }
  return { url: page.url(), title: await page.title().catch(() => ''), elements, totals: countElements(elements) };
}

export function countElements(elements: PageElement[]): Counts {
  const c: Counts = { elements: 0, okId: 0, okName: 0, needsId: 0, missingName: 0, fixId: 0, review: 0, todo: 0 };
  for (const e of elements) {
    c.elements += 1;
    if (e.status === 'OK (test ID)') c.okId += 1;
    else if (e.status === 'OK (name)') c.okName += 1;
    else if (e.status === 'Needs test ID') c.needsId += 1;
    else if (e.status === 'Missing name') c.missingName += 1;
    else if (e.status === 'Fix test ID') c.fixId += 1;
    else c.review += 1;
  }
  c.todo = c.needsId + c.missingName + c.fixId;
  return c;
}

export function addCounts(all: Counts[]): Counts {
  const sum: Counts = { elements: 0, okId: 0, okName: 0, needsId: 0, missingName: 0, fixId: 0, review: 0, todo: 0 };
  for (const c of all) for (const k of Object.keys(sum) as Array<keyof Counts>) sum[k] += c[k];
  return sum;
}
