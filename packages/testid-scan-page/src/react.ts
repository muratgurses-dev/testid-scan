/**
 * Which component created an element, in a React production build with source maps.
 *
 * Production React keeps no owner on its elements and its component names are minified, but two things survive:
 *   - every element's props object: a component's output (the props of the elements it returned, and of the
 *     elements inside those props) reaches the props of every element it created, also when that element is passed on
 *     to another component as children. The outermost component whose output reaches an element created it.
 *   - every component's function: Chromium tells where it starts in the bundle, and the source map names the file.
 * Chained (the creator of the element, the creator of that component's element, ...), this gives the files an element
 * came through. Chromium only; without source maps it says nothing.
 */
import type { CDPSession, Page } from 'playwright';

/** One step of a creator chain: a project file of the scan, an external file (node_modules), or unknown. */
export type ChainLink = { file: string } | { external: string } | null;

export interface ReactOwnership {
  /** Per marked item: the files its element came through, its creator first. */
  chains: Map<number, ChainLink[]>;
  /** Project files with at least one component mounted on the page. */
  shown: Set<string>;
}

const SLOT = '__testidScanReactFns';

/** Runs in the page: creator chains of the marked elements, and every mounted component, as function indexes. */
function reactInPage({ mark, slot }: { mark: string; slot: string }): { chains: Record<string, Array<number | null>>; shown: number[] } | null {
  type Fiber = { tag: number; type: unknown; child: Fiber | null; sibling: Fiber | null; return: Fiber | null; alternate: Fiber | null; memoizedProps: unknown; pendingProps: unknown; stateNode: unknown };
  const keyOf = (o: object, prefix: string) => Object.keys(o).find((k) => k.startsWith(prefix));
  const COMPONENT = new Set([0, 1, 2, 11, 15]); // function, class, indeterminate, forwardRef, simple memo
  const fnOf = (f: Fiber): unknown => {
    const t = f.type as { render?: unknown; type?: unknown } | null;
    return typeof t === 'function' ? t : t && (typeof t.render === 'function' ? t.render : typeof t.type === 'function' ? t.type : null);
  };
  const fns: unknown[] = []; const index = new Map<unknown, number>();
  const id = (fn: unknown): number => { if (!index.has(fn)) { index.set(fn, fns.length); fns.push(fn); } return index.get(fn)!; };

  // the current tree of every root
  const roots = new Set<Fiber>();
  const all = document.getElementsByTagName('*');
  for (let k = 0; k < all.length; k += 1) {
    const el = all[k] as unknown as Record<string, unknown>;
    const ck = keyOf(el, '__reactContainer$');
    if (ck) { const host = el[ck] as Fiber | null; const root = (host?.stateNode as { current?: Fiber } | undefined)?.current; if (root) roots.add(root); }
    const legacy = (el._reactRootContainer as { _internalRoot?: { current?: Fiber } } | undefined)?._internalRoot?.current;
    if (legacy) roots.add(legacy);
  }
  const marked = [...document.querySelectorAll(`[${mark}]`)];
  for (const el of marked) {
    const fk = keyOf(el, '__reactFiber$');
    if (!fk) continue;
    let f = (el as unknown as Record<string, Fiber>)[fk];
    while (f.return) f = f.return;
    const current = (f.stateNode as { current?: Fiber } | undefined)?.current;
    if (f.tag === 3 && current) roots.add(current);
  }
  if (!roots.size) return null;
  const shown = new Set<number>();
  for (const root of roots) {
    const stack: Fiber[] = [root];
    let guard = 0;
    while (stack.length && guard < 200000) {
      guard += 1;
      const f = stack.pop()!;
      if (COMPONENT.has(f.tag)) { const fn = fnOf(f); if (fn) shown.add(id(fn)); }
      if (f.sibling) stack.push(f.sibling);
      if (f.child) stack.push(f.child);
    }
  }

  /** Does this value (props, elements, arrays of them) reach one of the targets? */
  const reach = (v: unknown, targets: Set<unknown>, seen: Set<unknown>, depth: number): boolean => {
    if (targets.has(v)) return true;
    if (!v || typeof v !== 'object' || depth > 40 || seen.has(v)) return false;
    seen.add(v);
    if (Array.isArray(v)) return v.some((x) => reach(x, targets, seen, depth + 1));
    const o = v as { $$typeof?: unknown; props?: unknown };
    if (o.$$typeof) return o.props ? reach(o.props, targets, seen, depth + 1) : false;
    if (Object.getPrototypeOf(v) !== Object.prototype) return false;
    for (const key of Object.keys(v)) { const x = (v as Record<string, unknown>)[key]; if (x && typeof x === 'object' && reach(x, targets, seen, depth + 1)) return true; }
    return false;
  };
  const outputReaches = (f: Fiber, targets: Set<unknown>): boolean => {
    for (const side of [f, f.alternate]) {
      if (!side) continue;
      for (let c = side.child; c; c = c.sibling) if (reach(c.memoizedProps, targets, new Set(), 0) || reach(c.pendingProps, targets, new Set(), 0)) return true;
    }
    return false;
  };
  /** The outermost component above `from` whose output reaches the props; 'top' when there is no component above. */
  const creator = (from: Fiber, targets: Set<unknown>): Fiber | 'top' | null => {
    let found: Fiber | null = null; let any = false; let steps = 0;
    for (let f = from.return; f && steps < 2000; f = f.return, steps += 1) {
      if (!COMPONENT.has(f.tag)) continue;
      any = true;
      if (outputReaches(f, targets)) found = f;
    }
    return found ?? (any ? null : 'top');
  };

  const chains: Record<string, Array<number | null>> = {};
  for (const el of marked) {
    const fk = keyOf(el, '__reactFiber$'); const pk = keyOf(el, '__reactProps$');
    if (!fk || !pk) continue;
    const chain: Array<number | null> = [];
    let from = (el as unknown as Record<string, Fiber>)[fk];
    let targets = new Set<unknown>([(el as unknown as Record<string, unknown>)[pk], from.memoizedProps, from.alternate?.memoizedProps].filter(Boolean));
    for (let depth = 0; depth < 25; depth += 1) {
      const c = creator(from, targets);
      if (c === 'top') break;
      if (!c) { chain.push(null); break; } // could not tell: the chain is incomplete
      const fn = fnOf(c);
      chain.push(fn ? id(fn) : null);
      if (!fn) break;
      from = c;
      targets = new Set([c.memoizedProps, c.alternate?.memoizedProps].filter(Boolean));
      if (depth === 24) chain.push(null);
    }
    for (const v of (el.getAttribute(mark) ?? '').split(',')) if (v) chains[v] = chain;
  }
  (window as unknown as Record<string, unknown>)[slot] = fns;
  return { chains, shown: [...shown] };
}

// ---- source maps -------------------------------------------------------------------------------------------------

const B64 = Object.fromEntries([...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'].map((c, i) => [c, i]));

/** Decodes source map mappings: per generated line, segments [column, source, original line, original column]. */
export function decodeMappings(mappings: string): number[][][] {
  const lines: number[][][] = [];
  let source = 0; let line = 0; let column = 0;
  for (const text of mappings.split(';')) {
    const segments: number[][] = []; let generated = 0;
    if (text) {
      for (const seg of text.split(',')) {
        const values: number[] = []; let value = 0; let shift = 0;
        for (const ch of seg) {
          const digit = B64[ch];
          if (digit === undefined) break;
          value += (digit & 31) << shift;
          if (digit & 32) shift += 5;
          else { values.push(value & 1 ? -(value >>> 1) : value >>> 1); value = 0; shift = 0; }
        }
        if (!values.length) continue;
        generated += values[0];
        if (values.length >= 4) { source += values[1]; line += values[2]; column += values[3]; segments.push([generated, source, line, column]); }
      }
    }
    lines.push(segments);
  }
  return lines;
}

export interface SourceMap { sources: string[]; sourceRoot?: string; mappings: string; decoded?: number[][][] }

/** The original source file of a generated position (0-based line and column), or undefined. */
export function sourceAt(map: SourceMap, line: number, column: number): string | undefined {
  map.decoded ??= decodeMappings(map.mappings);
  let hit: number[] | undefined;
  for (const s of map.decoded[line] ?? []) { if (s[0] <= column) hit = s; else break; }
  return hit ? `${map.sourceRoot ?? ''}${map.sources[hit[1]]}` : undefined;
}

/** A source map path as a project file of the scan, an external file, or unknown. */
export function linkOf(source: string | undefined, files: string[]): ChainLink {
  if (!source) return null;
  const path = source.replace(/\\/g, '/').replace(/^[a-z]+:\/\/[^/]*\//i, '/').replace(/\?.*$/, '');
  const joined = path.split('/').filter((p) => p && p !== '.' && p !== '..').join('/');
  if (/(^|\/)node_modules\//.test(joined) || /^(\(webpack\)|webpack\/)/.test(joined)) return { external: joined };
  let best: string | undefined;
  for (const f of files) if ((joined === f || joined.endsWith(`/${f}`)) && (!best || f.length > best.length)) best = f;
  return best ? { file: best } : { external: joined };
}

// ---- the page ------------------------------------------------------------------------------------------------------

const mapCache = new WeakMap<Page, Map<string, Promise<SourceMap | null>>>();

async function loadMap(page: Page, scriptUrl: string, mapUrl: string): Promise<SourceMap | null> {
  let cache = mapCache.get(page);
  if (!cache) { cache = new Map(); mapCache.set(page, cache); }
  const key = `${scriptUrl}\u0000${mapUrl}`;
  if (!cache.has(key)) {
    cache.set(key, (async () => {
      try {
        if (mapUrl.startsWith('data:')) {
          const comma = mapUrl.indexOf(',');
          const body = mapUrl.slice(comma + 1);
          return JSON.parse(/;base64/.test(mapUrl.slice(0, comma)) ? Buffer.from(body, 'base64').toString('utf8') : decodeURIComponent(body)) as SourceMap;
        }
        const response = await page.request.get(new URL(mapUrl, scriptUrl).href);
        if (!response.ok()) return null;
        const map = await response.json() as SourceMap;
        return Array.isArray(map.sources) && typeof map.mappings === 'string' ? map : null;
      } catch { return null; }
    })());
  }
  return cache.get(key)!;
}

/**
 * Creator chains of the elements marked with `mark`, and the project files with a component on the page.
 * undefined when the page is not React, the browser is not Chromium, or nothing could be resolved.
 */
export async function reactOwnership(page: Page, mark: string, files: string[]): Promise<ReactOwnership | undefined> {
  const found = await page.evaluate(reactInPage, { mark, slot: SLOT }).catch(() => null);
  if (!found) return undefined;
  let session: CDPSession | undefined;
  try {
    session = await page.context().newCDPSession(page);
    const scripts = new Map<string, { url: string; sourceMapURL?: string }>();
    session.on('Debugger.scriptParsed', (e: { scriptId: string; url: string; sourceMapURL?: string }) => { scripts.set(e.scriptId, e); });
    await session.send('Debugger.enable');
    await session.send('Debugger.setSkipAllPauses', { skip: true }); // a debugger statement in the app must not stop it
    const count = await page.evaluate((slot) => ((window as unknown as Record<string, unknown[]>)[slot] ?? []).length, SLOT);
    const links: ChainLink[] = [];
    for (let k = 0; k < count; k += 1) {
      let link: ChainLink = null;
      try {
        const { result } = await session.send('Runtime.evaluate', { expression: `window[${JSON.stringify(SLOT)}][${k}]`, objectGroup: 'testid-scan' });
        if (result.objectId) {
          const props = await session.send('Runtime.getProperties', { objectId: result.objectId, ownProperties: false });
          const loc = props.internalProperties?.find((p) => p.name === '[[FunctionLocation]]')?.value?.value as { scriptId: string; lineNumber: number; columnNumber: number } | undefined;
          const script = loc && scripts.get(loc.scriptId);
          if (loc && script?.sourceMapURL) {
            const map = await loadMap(page, script.url, script.sourceMapURL);
            if (map) link = linkOf(sourceAt(map, loc.lineNumber, loc.columnNumber), files);
          }
        }
      } catch { link = null; }
      links.push(link);
    }
    await session.send('Runtime.releaseObjectGroup', { objectGroup: 'testid-scan' }).catch(() => undefined);
    await session.send('Debugger.disable').catch(() => undefined);
    if (!links.some(Boolean)) return undefined; // no source maps: nothing to say
    const chains = new Map<number, ChainLink[]>();
    for (const [i, chain] of Object.entries(found.chains)) chains.set(Number(i), chain.map((n) => (n === null ? null : links[n])));
    const shown = new Set<string>();
    for (const n of found.shown) { const l = links[n]; if (l && 'file' in l) shown.add(l.file); }
    return { chains, shown };
  } catch {
    return undefined;
  } finally {
    await page.evaluate((slot) => { delete (window as unknown as Record<string, unknown>)[slot]; }, SLOT).catch(() => undefined);
    await session?.detach().catch(() => undefined);
  }
}

/**
 * Is the element a locator found the element of its source line? From its creator chain:
 *   - an HTML element of file F was created by F's component: the chain starts with F.
 *   - a component used in F (`<Button>`): the first project file in the chain is F (F used a library component that
 *     rendered it), or the one after it is (F used a project component that rendered it).
 * A chain without F is another component's element. Anything else (F further up, a link unknown) says nothing.
 */
export function judgeChain(chain: ChainLink[] | undefined, file: string, html: boolean): { ok: boolean; reason: string } | undefined {
  if (!chain?.length || chain[0] === null) return undefined;
  const name = (l: ChainLink) => (l === null ? '?' : 'file' in l ? l.file : l.external);
  const has = chain.some((l) => l && 'file' in l && l.file === file);
  const complete = !chain.includes(null);
  const created = name(chain[0]);
  if (html) {
    if (created === file) return { ok: true, reason: `created by this file's component (React, source map)` };
    if (!has && complete) return { ok: false, reason: `created by ${created} (React, source map), not ${file}` };
    return undefined;
  }
  const p = chain.findIndex((l) => l === null || 'file' in l);
  if (p < 0 || chain[p] === null) return undefined;
  if (p >= 1 && name(chain[p]) === file) return { ok: true, reason: `rendered by ${name(chain[p - 1])}, used in this file (React, source map)` };
  if (chain[p + 1] && name(chain[p + 1]) === file) return { ok: true, reason: `rendered by ${name(chain[p])}, used in this file (React, source map)` };
  if (!has && complete) return { ok: false, reason: `rendered through ${chain.slice(0, 3).map(name).join(' < ')} (React, source map), not ${file}` };
  return undefined;
}
