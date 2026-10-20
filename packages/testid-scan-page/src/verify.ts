/**
 * Runs the locators that testid-scan recommended (its --json output) on the scanned pages.
 * The locator text is never evaluated as code: it is read by a small parser that accepts only
 * Playwright locator calls with literal arguments.
 */
import type { Locator, Page } from 'playwright';
import { judgeChain, reactOwnership } from './react.ts';
import type { Evidence, LocatorOnPage, TargetCheck, Verdict, VerifiedLocator, VerifyResult, VerifySummary } from './types.ts';

type Value = string | number | boolean | { [key: string]: Value };
export interface Call { method: string; args: Value[] }

const METHODS = new Set(['getByRole', 'getByTestId', 'getByLabel', 'getByPlaceholder', 'getByText', 'getByTitle', 'getByAltText', 'locator', 'filter', 'first', 'last', 'nth']);

/** `page.getByRole('button', { name: 'Save', exact: true })` -> [{ method: 'getByRole', args: ['button', { name: 'Save', exact: true }] }] */
export function parseLocator(text: string): Call[] {
  let i = 0;
  const fail = (what: string): never => { throw new Error(`${what} at position ${i} in ${text}`); };
  const space = () => { while (i < text.length && /\s/.test(text[i])) i += 1; };
  const expect = (s: string) => { space(); if (!text.startsWith(s, i)) fail(`expected "${s}"`); i += s.length; };
  const ident = (): string => { space(); const m = /^[A-Za-z_$][\w$]*/.exec(text.slice(i)); if (!m) fail('expected a name'); i += m![0].length; return m![0]; };
  const value = (): Value => {
    space();
    const c = text[i];
    if (c === "'" || c === '"') {
      i += 1; let out = '';
      while (i < text.length && text[i] !== c) {
        if (text[i] === '\\') { i += 1; const e = text[i]; out += e === 'n' ? '\n' : e === 't' ? '\t' : e; } else out += text[i];
        i += 1;
      }
      if (text[i] !== c) fail('unterminated string');
      i += 1; return out;
    }
    if (c === '{') {
      i += 1; const obj: { [key: string]: Value } = {};
      for (;;) {
        space(); if (text[i] === '}') { i += 1; return obj; }
        const key = text[i] === "'" || text[i] === '"' ? value() as string : ident();
        expect(':'); obj[key] = value(); space();
        if (text[i] === ',') { i += 1; continue; }
        expect('}'); return obj;
      }
    }
    const m = /^(true|false|-?\d+(?:\.\d+)?)/.exec(text.slice(i));
    if (!m) fail('expected a string, number, boolean or object');
    i += m![0].length;
    return m![0] === 'true' ? true : m![0] === 'false' ? false : Number(m![0]);
  };
  if (ident() !== 'page') fail('a locator must start with page');
  const calls: Call[] = [];
  for (space(); i < text.length; space()) {
    expect('.');
    const method = ident();
    if (!METHODS.has(method)) fail(`"${method}" is not a supported locator call`);
    expect('(');
    const args: Value[] = [];
    space();
    if (text[i] !== ')') for (;;) { args.push(value()); space(); if (text[i] === ',') { i += 1; continue; } break; }
    expect(')');
    calls.push({ method, args });
  }
  if (!calls.length) fail('no locator call');
  return calls;
}

/** Build a Playwright locator from parsed calls. */
export function buildLocator(page: Page, calls: Call[]): Locator {
  let target: Page | Locator = page;
  for (const { method, args } of calls) {
    const fn: ((...a: unknown[]) => Page | Locator) | undefined = (target as unknown as Record<string, (...a: unknown[]) => Page | Locator>)[method];
    if (typeof fn !== 'function') throw new Error(`${method} is not available here`);
    target = fn.apply(target, args);
  }
  if (target === page) throw new Error('no locator call');
  return target as Locator;
}

/** The part of testid-scan's JSON that is needed here. */
export interface StaticScan {
  elements: Array<{ file: string; line: number; tag?: string; recommendedLocator?: string; locatorScope?: string; conditional?: boolean; repeated?: boolean; alternatives?: number[] }>;
  /** Angular selectors per template, from testid-scan --json (testid-scan 0.2 and later): tell which template an element came from. */
  files?: Array<{ file: string; framework?: string; selectors?: string[] }>;
}

/** Angular selectors by template file, from testid-scan's JSON. */
export type SelectorsByFile = Record<string, string[]>;

/** Collects the locators to check; record-scoped ones with <...> placeholders cannot be run as they are. */
export function locatorsToCheck(scan: StaticScan): { items: VerifiedLocator[]; skipped: number; selectorsByFile: SelectorsByFile } {
  const items: VerifiedLocator[] = []; let skipped = 0;
  for (const e of scan.elements ?? []) {
    if (!e.recommendedLocator) continue;
    if (e.recommendedLocator.includes('<')) { skipped += 1; continue; }
    items.push({
      file: e.file, line: e.line, tag: e.tag, locator: e.recommendedLocator, scope: e.locatorScope ?? 'unknown', maxMatches: 0, seenOn: [], result: 'not visited',
      conditional: e.conditional, repeated: e.repeated, alternatives: e.alternatives, pages: [], verdict: 'unable to verify', why: 'not run yet',
    });
  }
  const selectorsByFile: SelectorsByFile = {};
  for (const f of scan.files ?? []) if (f.selectors?.length) selectorsByFile[f.file] = f.selectors.map((s) => s.toLowerCase());
  const frameworkOf = new Map((scan.files ?? []).map((f) => [f.file, f.framework]));
  for (const item of items) { const fw = frameworkOf.get(item.file); if (fw) item.framework = fw; }
  return { items, skipped, selectorsByFile };
}

const VERIFY_MARK = 'data-testid-scan-verify';
const MAX_MARKED = 50;

interface PageTarget extends TargetCheck { i: number }

/** Runs in the page: for each locator that matched one element, decide whether it is the element of its source line. */
function targetsInPage({ items, selectorsByFile, mark, exact, sourceAttribute, react }: { items: Array<{ i: number; file: string; line: number; alternatives: number[]; html: boolean; count: number }>; selectorsByFile: Record<string, string[]>; mark: string; exact: boolean; sourceAttribute: string; react: Record<number, { ok: boolean; reason: string }> }): PageTarget[] {
  const byItem = new Map<number, Element[]>();
  for (const el of document.querySelectorAll(`[${mark}]`)) {
    for (const v of (el.getAttribute(mark) ?? '').split(',')) byItem.set(Number(v), [...(byItem.get(Number(v)) ?? []), el]);
  }
  const filesOfSelector = new Map<string, string[]>();
  for (const [file, selectors] of Object.entries(selectorsByFile)) for (const s of selectors) filesOfSelector.set(s, [...(filesOfSelector.get(s) ?? []), file]);

  /** Angular: the selector of the component whose template holds the element. */
  const angularOwner = (el: Element): string | undefined => {
    // with emulated style encapsulation the element is stamped with its own component's id, even when projected or moved
    const stamp = [...el.attributes].find((a) => a.name.startsWith('_ngcontent-'));
    if (stamp) {
      const host = document.querySelector(`[${CSS.escape(`_nghost-${stamp.name.slice('_ngcontent-'.length)}`)}]`);
      if (host && filesOfSelector.has(host.tagName.toLowerCase())) return host.tagName.toLowerCase();
    }
    // otherwise the nearest component host around it
    for (let p = el.parentElement; p; p = p.parentElement) if (filesOfSelector.has(p.tagName.toLowerCase())) return p.tagName.toLowerCase();
    return undefined;
  };
  /** Vue development builds: the file of the component that rendered the element. */
  const vueFile = (el: Element): string | undefined => {
    const file = (el as unknown as { __vueParentComponent?: { type?: { __file?: unknown } } }).__vueParentComponent?.type?.__file;
    return typeof file === 'string' ? file.replace(/\\/g, '/') : undefined;
  };
  const depth = (e: Element) => { let d = 0; for (let p = e.parentElement; p; p = p.parentElement) d += 1; return d; };
  const commonAncestor = (a: Element, b: Element): Element | null => {
    let p: Element | null = a;
    while (p && !p.contains(b)) p = p.parentElement;
    return p;
  };

  const out: PageTarget[] = [];
  for (const item of items) {
    if (item.count !== 1) continue;
    const el = byItem.get(item.i)?.[0];
    if (!el) continue;
    // a test build marks every element with the line it was written at (data-tsrc), and passes component uses on
    // (data-tsrc-use): the most certain answer there is
    const source = exact ? el.getAttribute(item.html ? sourceAttribute : `${sourceAttribute}-use`) : null;
    if (source) {
      // an element in another arm of the same if/else is the one this locator is meant to find when that arm is shown
      const mine = [item.line, ...item.alternatives].map((l) => `${item.file}:${l}`);
      const ok = mine.includes(source);
      // a component use is passed on only by components that pass their props on, and an outer use hides an inner one:
      // for a component, only a match proves something
      if (ok || item.html) {
        out.push({ i: item.i, check: 'exact', by: 'source line', ok, owner: source, reason: ok ? `${item.html ? 'written' : 'used'} at ${source}${source === mine[0] ? '' : ' (the other arm of its if/else)'}` : `written at ${source}, not ${item.file}:${item.line}` });
        continue;
      }
    }
    const file = exact ? vueFile(el) : undefined;
    if (file) {
      const ok = file.endsWith(`/${item.file}`) || file === item.file;
      out.push({ i: item.i, check: 'exact', by: 'vue file', ok, owner: file, reason: ok ? 'rendered by this file (Vue development build)' : `rendered by ${file} (Vue development build)` });
      continue;
    }
    const expected = exact ? selectorsByFile[item.file] : undefined;
    const owner = expected ? angularOwner(el) : undefined;
    if (expected && owner) {
      const ok = expected.includes(owner);
      out.push({ i: item.i, check: 'exact', by: 'angular host', ok, owner, reason: ok ? `inside <${owner}>, this file's component` : `inside <${owner}> (${(filesOfSelector.get(owner) ?? []).join(', ')}), not <${expected.join('>, <')}>` });
      continue;
    }
    // React production build with source maps: the component that created the element (worked out before, in Node)
    const created = exact ? react[item.i] : undefined;
    if (created) {
      out.push({ i: item.i, check: 'exact', by: 'react owner', ok: created.ok, owner: created.reason, reason: created.reason });
      continue;
    }
    // a guess: an element of a component shares some part of the page with at least one other element of the same
    // file. One that meets them only at <body> lives elsewhere: a separate root, an overlay, another app.
    const others = [...new Set(items.filter((o) => o.file === item.file && o.i !== item.i && o.count === 1)
      .map((o) => byItem.get(o.i)?.[0]).filter((o): o is Element => Boolean(o) && o !== el))];
    if (!others.length) { out.push({ i: item.i, check: 'unchecked', reason: 'no other element of its file on this page to compare with' }); continue; }
    let nearest: Element | null = null;
    for (const o of others) {
      const a = commonAncestor(el, o);
      if (a && (!nearest || depth(a) > depth(nearest))) nearest = a;
    }
    const ok = Boolean(nearest) && nearest !== document.body && nearest !== document.documentElement;
    const where = nearest ? nearest.tagName.toLowerCase() + (nearest.id ? `#${nearest.id}` : '') : 'document';
    out.push({ i: item.i, check: 'region', ok, reason: ok
      ? `shares <${where}> with another element of its file`
      : `meets the ${others.length} other element(s) of its file only at <${where}>: it is in another part of the page (if it is in a dialog or overlay of this file, it may still be right)` });
  }
  for (const el of document.querySelectorAll(`[${mark}]`)) el.removeAttribute(mark);
  return out;
}

const rank = (t?: TargetCheck) => (!t ? 0 : t.ok === false ? 4 : t.check === 'exact' ? 3 : t.check === 'region' ? 2 : 1);

/** The same calls with hidden elements included in getByRole (other locators already count them). */
const withHiddenCalls = (calls: Call[]): Call[] | undefined => (calls.some((c) => c.method === 'getByRole')
  ? calls.map((c) => (c.method === 'getByRole' ? { method: c.method, args: [c.args[0], { ...(c.args[1] as object | undefined ?? {}), includeHidden: true }] } : c))
  : undefined);

/** Removes a temporary attribute from every element, without querySelectorAll (a page may have replaced it). */
function removeMark(mark: string): void {
  const all = document.getElementsByTagName('*');
  for (let k = 0; k < all.length; k += 1) if (all[k].hasAttribute(mark)) all[k].removeAttribute(mark);
}

/** How many times each list of locators has been run: every run is one observed state of the app. */
const observed = new WeakMap<VerifiedLocator[], number>();

export interface CheckOptions {
  /**
   * Use what the page says about where elements come from (data-tsrc, Angular hosts, Vue development builds).
   * false checks the way a plain production build would be checked; the accuracy runs use it to measure the rest.
   */
  exact?: boolean;
  /** Attribute written by testid-scan-page/vite (default: data-tsrc). */
  sourceAttribute?: string;
  /** A name for the app state being checked (a dialog open, a step of a journey). Default: the URL. */
  state?: string;
  /**
   * React production builds with source maps (Chromium): work out which component created each element found
   * (default true, with `exact`). false leaves it out; the accuracy runs use it to keep their referee independent.
   */
  react?: boolean;
}

const isHtmlTag = (tag?: string) => Boolean(tag && /^[a-z][a-z0-9]*$/.test(tag));

/**
 * Which source files the page shows, when the page can tell: elements marked with data-tsrc, a Vue development build,
 * or Angular component hosts. undefined = the page does not tell (a plain production build).
 */
async function filesShown(page: Page, files: string[], selectorsByFile: SelectorsByFile, sourceAttribute: string): Promise<Map<string, boolean> | undefined> {
  const found = await page.evaluate(({ files, attr, selectorsByFile }) => {
    // only presence counts: a file whose elements are all components that do not pass the mark on leaves none
    if (document.querySelector(`[${attr}]`)) {
      const prefix = (f: string) => `${f.replace(/["\\]/g, '\\$&')}:`;
      return Object.fromEntries(files.filter((f) => document.querySelector(`[${attr}^="${prefix(f)}"], [${attr}-use^="${prefix(f)}"]`)).map((f) => [f, true]));
    }
    const vue = new Set<string>();
    for (const el of document.querySelectorAll('*')) {
      const file = (el as unknown as { __vueParentComponent?: { type?: { __file?: unknown } } }).__vueParentComponent?.type?.__file;
      if (typeof file === 'string') vue.add(file.replace(/\\/g, '/'));
    }
    if (vue.size) return Object.fromEntries(files.filter((f) => [...vue].some((v) => v.endsWith(`/${f}`))).map((f) => [f, true]));
    const angular = files.filter((f) => selectorsByFile[f]?.length);
    if (angular.length) return Object.fromEntries(angular.map((f) => [f, selectorsByFile[f].some((s) => document.querySelector(s))]));
    return null;
  }, { files, attr: sourceAttribute, selectorsByFile }).catch(() => null);
  return found ? new Map(Object.entries(found)) : undefined;
}

/** Run every locator on the page as it is now, record what it matched, and check single matches against their source line. */
export async function checkOnPage(page: Page, items: VerifiedLocator[], selectorsByFile: SelectorsByFile = {}, options: CheckOptions = {}): Promise<void> {
  const exact = options.exact ?? true;
  const sourceAttribute = options.sourceAttribute ?? 'data-tsrc';
  const counted: Array<{ i: number; file: string; line: number; alternatives: number[]; html: boolean; count: number }> = [];
  const shown = exact ? await filesShown(page, [...new Set(items.map((i) => i.file))], selectorsByFile, sourceAttribute) : undefined;
  const url = page.url();
  // one observed state: evidence from it is never mixed with another state, even one with the same URL
  const state = observed.get(items) ?? 0;
  observed.set(items, state + 1);
  const label = options.state ?? url;
  const here = new Map<number, LocatorOnPage>(); // this state's record of each locator
  try {
  for (const [i, item] of items.entries()) {
    if (item.result === 'unreadable') continue;
    let count: number; let locator: Locator; let withHidden: number;
    try {
      const calls = parseLocator(item.locator);
      locator = buildLocator(page, calls);
      count = await locator.count();
      const hiddenToo = count <= 1 ? withHiddenCalls(calls) : undefined;
      withHidden = hiddenToo ? await buildLocator(page, hiddenToo).count() : count;
    } catch (error) {
      item.result = 'unreadable'; item.maxMatches = -1; item.error = (error as Error).message.split('\n')[0];
      continue;
    }
    if (count > 0) item.seenOn.push(url);
    item.maxMatches = Math.max(item.maxMatches, count);
    const known = shown?.has(item.file) ?? false;
    const record: LocatorOnPage = { url, state, label, count, withHidden, fileShown: known ? Boolean(shown!.get(item.file)) : false, fileShownKnown: known };
    item.pages.push(record);
    here.set(i, record);
    if (count >= 1 && count <= MAX_MARKED) {
      await locator.evaluateAll((els, { i, mark }) => {
        for (const el of els) el.setAttribute(mark, el.hasAttribute(mark) ? `${el.getAttribute(mark)},${i}` : String(i));
      }, { i, mark: VERIFY_MARK }).catch(() => undefined);
      counted.push({ i, file: item.file, line: item.line, alternatives: item.alternatives ?? [], html: isHtmlTag(item.tag), count });
    }
  }
  // React: the component that created each single match, and the files with a component on the page
  const react: Record<number, { ok: boolean; reason: string }> = {};
  const ownership = exact && options.react !== false && counted.some((c) => c.count === 1)
    ? await reactOwnership(page, VERIFY_MARK, [...new Set(items.map((x) => x.file))]) : undefined;
  if (ownership) {
    for (const c of counted) {
      if (c.count !== 1) continue;
      const judged = judgeChain(ownership.chains.get(c.i), c.file, c.html);
      // "another component's element" only when a component of its own file is on the page: a file of helpers
      // (table columns, render functions) creates its elements inside other files' components
      if (judged && (judged.ok || ownership.shown.has(c.file))) react[c.i] = judged;
    }
  }
  const targets = await page.evaluate(targetsInPage, { items: counted, selectorsByFile, mark: VERIFY_MARK, exact, sourceAttribute, react }).catch(() => [] as PageTarget[]);
  for (const { i, ...target } of targets) {
    const record = here.get(i)!;
    record.target = target;
    // the element of its own line is on the page: so is its component
    if (target.check === 'exact' && target.ok) { record.fileShown = true; record.fileShownKnown = true; }
  }
  // a component of its file is mounted (React, source maps): only presence counts, as with data-tsrc
  if (ownership) for (const [i, record] of here) if (ownership.shown.has(items[i].file)) { record.fileShown = true; record.fileShownKnown = true; }
  // test builds with data-tsrc: for locators that found nothing, is the element of their line on the page at all?
  if (exact) {
    const missing = [...here].filter(([, r]) => r.count === 0);
    const presence = await page.evaluate(({ keys, attr }) => {
      if (!document.querySelector(`[${attr}]`)) return null;
      return keys.map(({ key, html }) => {
        const els = [...document.querySelectorAll(`[${html ? attr : `${attr}-use`}="${CSS.escape(key)}"]`)];
        // a component use that is not passed on leaves no mark: its absence proves nothing
        if (!els.length) return html ? 'absent' : null;
        return els.some((e) => e.checkVisibility() && e.getBoundingClientRect().width > 0) ? 'visible' : 'hidden';
      });
    }, { keys: missing.map(([i]) => ({ key: `${items[i].file}:${items[i].line}`, html: isHtmlTag(items[i].tag) })), attr: sourceAttribute }).catch(() => null);
    if (presence) missing.forEach(([, r], k) => { if (presence[k]) r.sourcePresent = presence[k] as 'visible' | 'hidden' | 'absent'; });
  }
  } finally {
    // the page is left as it was, also when a step above failed
    await page.evaluate(removeMark, VERIFY_MARK).catch(() => undefined);
  }
}

/** A verdict with the kind of evidence behind it and what to do about it. */
interface Judgement { verdict: Verdict; why: string; evidence: Evidence; remediation?: string }

const FIX = {
  several: (item: VerifiedLocator) => (item.repeated || item.scope !== 'page-candidate'
    ? 'narrow it to its record first (a row or list item), or give each record a test ID built from its key'
    : 'narrow it to its part of the page (a dialog, a form), or add a unique test ID to the element at ' + `${item.file}:${item.line}`),
  wrong: (item: VerifiedLocator) => `it acts on another component's element: add a test ID to ${item.file}:${item.line}, or narrow the locator to its component`,
  missing: 'the role or name on the page differs from the source (a translation key, a name set from code): use the rendered name, or add a test ID',
  url: 'add the URL (or journey step) of the screen that shows its component',
  state: 'check it in the state where the element is shown (open the dialog, fill the list), or build with testid-scan-page/vite to settle it',
  build: 'build with testid-scan-page/vite, check a Vue development build, or serve a React build with source maps to settle it for certain',
  hidden: 'check at the screen size or in the state where it is visible',
  twin: 'a hidden element with the same role and name exists: remove it from the page when hidden, or add a test ID',
  json: 'rerun a current testid-scan to get its JSON',
};

/**
 * The verdict for one locator, from what was seen in every state. Only evidence verifies; a guess leaves it unverified.
 * Only states that show its component count: a login form's "Email" locator also finds the register form's "Email"
 * field on the register page, which says nothing about the login form.
 */
function judge(item: VerifiedLocator): Judgement {
  if (item.result === 'unreadable') return { verdict: 'unable to verify', why: `not a plain locator call: ${item.error ?? ''}`, evidence: 'none', remediation: 'write it as a chain of page.getBy...() calls with literal arguments' };
  const relevant = item.pages.filter((p) => p.fileShown);
  const elsewhere = item.pages.filter((p) => !p.fileShown && p.count > 0);
  const byOf = (t?: TargetCheck): Evidence => (t?.by === 'source line' ? 'source line' : 'component ownership');
  const several = relevant.find((p) => p.count > 1);
  if (several) return { verdict: 'verified incorrect', why: `matches ${several.count} elements in a state that shows its component (${several.label})${item.scope === 'page-candidate' ? ', although testid-scan expected one' : ' (testid-scan already listed it as repeated or to review)'}`, evidence: 'match count', remediation: FIX.several(item) };
  const wrong = relevant.find((p) => p.count === 1 && p.target?.check === 'exact' && p.target.ok === false);
  if (wrong) return { verdict: 'verified incorrect', why: `finds another element in a state that shows its component (${wrong.label}): ${wrong.target!.reason}`, evidence: byOf(wrong.target), remediation: FIX.wrong(item) };
  // a single match counts in every state that shows its component: each must be proved, not just one
  const single = relevant.filter((p) => p.count === 1);
  // proof by elimination in one state: the element of its line must be there, and only one element has this role and name
  const eliminates = (p: LocatorOnPage) => item.conditional === false && !item.repeated && p.withHidden === 1;
  const proved = (p: LocatorOnPage) => (p.target?.check === 'exact' && p.target.ok) || (p.target?.check !== 'exact' && eliminates(p));
  if (single.length && single.every(proved)) {
    const exactly = single.filter((p) => p.target?.check === 'exact');
    // the weakest proof over the states decides what the verdict rests on
    if (exactly.length === single.length) return { verdict: 'verified correct', why: exactly[0].target!.reason, evidence: exactly.every((p) => p.target?.by === 'source line') ? 'source line' : 'component ownership' };
    return { verdict: 'verified correct', why: 'its component is on the page and shows this element unconditionally, and no other element, visible or hidden, has this role and name: the one found must be it', evidence: 'elimination' };
  }
  if (single.length) {
    const open = single.find((p) => !proved(p))!;
    const where = single.length > 1 ? ` (in ${open.label})` : '';
    if (open.target?.check === 'region' && open.target.ok === false) return { verdict: 'unable to verify', why: `likely the wrong element${where}: ${open.target.reason}`, evidence: 'heuristic', remediation: FIX.build };
    // older testid-scan JSON does not say whether an element is conditional: then nothing is proved by elimination
    if (item.conditional === undefined) return { verdict: 'unable to verify', why: 'the testid-scan JSON does not say whether the element is shown only under a condition: rerun a current testid-scan', evidence: 'none', remediation: FIX.json };
    if (item.conditional) return { verdict: 'unable to verify', why: `shown only under a condition: the one element found${where} may be another one with the same role and name`, evidence: 'none', remediation: FIX.build };
    if (item.repeated) return { verdict: 'unable to verify', why: 'repeated per record: only one record was on the page', evidence: 'none', remediation: 'check it with more than one record on the page' };
    return { verdict: 'unable to verify', why: `a hidden element has the same role and name${where}`, evidence: 'none', remediation: FIX.twin };
  }
  const right = item.pages.find((p) => p.count === 1 && p.target?.check === 'exact' && p.target.ok);
  if (right) return { verdict: 'verified correct', why: right.target!.reason, evidence: byOf(right.target) };
  if (relevant.some((p) => p.sourcePresent === 'visible')) return { verdict: 'verified incorrect', why: 'the element of its line was visible on the page (data-tsrc), but the locator found nothing: its name or role differs on the page', evidence: 'source line', remediation: FIX.missing };
  if (relevant.some((p) => p.sourcePresent === 'hidden')) return { verdict: 'unable to verify', why: 'present but hidden on the scanned pages (data-tsrc): screen size, collapsed menu', evidence: 'none', remediation: FIX.hidden };
  if (relevant.length && relevant.every((p) => p.sourcePresent === 'absent')) {
    return { verdict: 'unable to verify', why: 'its component was on the page, but the element of its line was not rendered (data-tsrc): add the screen or state where it shows', evidence: 'none', remediation: FIX.state };
  }
  if (elsewhere.length) {
    return { verdict: 'unable to verify', why: `found only on pages where its component could not be shown to be (${elsewhere.some((p) => p.count > 1) ? 'several matches there' : 'one match there'}): add the screen of its component, or a distinctive locator of its file`, evidence: 'none', remediation: FIX.url };
  }
  if (!relevant.length) return { verdict: 'unable to verify', why: 'its component was not on any scanned page: add the URL of its screen', evidence: 'none', remediation: FIX.url };
  if (relevant.some((p) => p.withHidden > 0)) return { verdict: 'unable to verify', why: 'present but hidden on the scanned pages (screen size, collapsed menu)', evidence: 'none', remediation: FIX.hidden };
  if (item.conditional === undefined) return { verdict: 'unable to verify', why: 'nothing found, but the testid-scan JSON does not say whether the element is shown only under a condition: rerun a current testid-scan', evidence: 'none', remediation: FIX.json };
  if (item.conditional) return { verdict: 'unable to verify', why: 'its component was on the page, but the element is shown only under a condition that was not met', evidence: 'none', remediation: FIX.state };
  if (item.repeated) return { verdict: 'unable to verify', why: 'its component was on the page, but the list it repeats in may have been empty', evidence: 'none', remediation: 'check it with records in the list' };
  return { verdict: 'verified incorrect', why: 'its component was on the page and shows this element unconditionally, but the locator found nothing: its name or role differs on the page', evidence: 'elimination', remediation: FIX.missing };
}

/**
 * Decide each locator's outcome once every page has been run. A page "shows" a file when an Angular host of it was
 * there, or when another locator of the same file matched on that page, and only a locator that no other file of
 * the project has: a login and a register page both have an "Email" field, so finding one says nothing about which
 * page is shown.
 */
export function finishVerify(items: VerifiedLocator[], skipped: number): VerifyResult {
  const filesOf = new Map<string, Set<string>>(); // locator text -> files that recommend it
  for (const item of items) filesOf.set(item.locator, new Set([...(filesOf.get(item.locator) ?? []), item.file]));
  const distinctive = (item: VerifiedLocator) => (filesOf.get(item.locator)?.size ?? 0) === 1;
  // per observed state, not per URL: a dialog opened and closed on one URL are two states
  const shownOn = new Map<number, Set<string>>(); // state -> file + line of distinctive locators with a match
  for (const item of items) {
    if (!distinctive(item)) continue;
    for (const p of item.pages) if (p.count > 0) shownOn.set(p.state, new Set([...(shownOn.get(p.state) ?? []), `${item.file}\u0000${item.line}`]));
  }
  for (const item of items) {
    for (const p of item.pages) {
      if (p.fileShownKnown) continue; // the page said for certain
      // another distinctive locator of the same file (a different source line) matched on this page
      p.fileShown = [...(shownOn.get(p.state) ?? [])].some((k) => k.startsWith(`${item.file}\u0000`) && k !== `${item.file}\u0000${item.line}`);
    }
    // the target shown in reports: the strongest finding on a page that shows its component, else on any page
    const targets = item.pages.filter((p) => p.target && p.fileShown).map((p) => p.target!);
    item.target = (targets.length ? targets : item.pages.filter((p) => p.target).map((p) => p.target!)).reduce<TargetCheck | undefined>((best, t) => (rank(t) > rank(best) ? t : best), undefined);
    if (item.result !== 'unreadable') {
      if (item.maxMatches === 1) item.result = item.target?.ok === false && item.pages.some((p) => p.fileShown && p.target?.ok === false) ? 'wrong target' : 'matched';
      else if (item.maxMatches > 1) item.result = 'ambiguous';
      else item.result = item.pages.some((p) => p.fileShown) ? 'not found' : 'not visited';
    }
    const j = judge(item);
    item.verdict = j.verdict; item.why = j.why; item.evidence = j.evidence;
    if (j.remediation) item.remediation = j.remediation; else delete item.remediation;
  }
  return { checked: items, skipped, summary: summarize(items, skipped) };
}

/** Counts for scripts and CI: verdicts, the evidence behind them, and the share verified. */
export function summarize(items: VerifiedLocator[], skipped: number): VerifySummary {
  const by = <K extends string>(key: (i: VerifiedLocator) => K) => items.reduce<Record<string, number>>((acc, i) => ({ ...acc, [key(i)]: (acc[key(i)] ?? 0) + 1 }), {});
  const verified = items.filter((i) => i.verdict !== 'unable to verify').length;
  return {
    locators: items.length, skipped,
    verifiedCorrect: items.filter((i) => i.verdict === 'verified correct').length,
    verifiedIncorrect: items.filter((i) => i.verdict === 'verified incorrect').length,
    unableToVerify: items.filter((i) => i.verdict === 'unable to verify').length,
    verifiedShare: items.length ? Math.round((1000 * verified) / items.length) / 10 : 0,
    evidence: by((i) => `${i.verdict}: ${i.evidence ?? 'none'}`),
  };
}
