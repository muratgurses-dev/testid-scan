/**
 * A small, dependency-free reader for HTML-like templates (Angular, Vue). It does not build a full AST:
 * it finds start/end tags, their attributes, their nesting and the loops around them, which is what the
 * scanner needs. What counts as a loop is decided by the framework adapter.
 */
import type { Branch, Loop } from '../types.ts';

export type Attrs = Map<string, string>;

export interface TemplateNode {
  /** Lowercased tag name. */
  tag: string;
  /** Tag name as written (Vue components may be PascalCase). */
  rawTag: string;
  /** Attribute names are lowercased; values are kept as written. */
  attrs: Attrs;
  /** 1-based line of the start tag. */
  line: number;
  /** Index after the start tag. */
  contentStart: number;
  /** Index of the closing tag (= contentStart for void and self-closing elements). */
  contentEnd: number;
  /** Index of the parent in `nodes`, -1 at the top. */
  parent: number;
  /** Every loop this element is rendered inside (outermost first). Empty = rendered once. */
  loops: Loop[];
  /** Arms of Angular @if/@else and @switch blocks the element is in (outermost first). Element-based branches are added by the adapter. */
  branches: Branch[];
  /** True when `<!-- testid-scan: reviewed -->` stands directly before the element. */
  reviewed: boolean;
  /** The fingerprint written in that comment, if any: `<!-- testid-scan: reviewed 1a2b3c4d -->`. */
  reviewedFingerprint?: string;
}

export interface Template {
  /** The template with comments blanked out (same length and line breaks as the original). */
  src: string;
  nodes: TemplateNode[];
}

const VOID_TAGS = new Set(['input', 'br', 'img', 'hr', 'meta', 'link', 'area', 'base', 'col', 'embed', 'param', 'source', 'track', 'wbr']);
export const IDENT = '[A-Za-z_$][\\w$]*';

/** Replace HTML comments with spaces/newlines so indexes and line numbers stay the same. */
function stripComments(source: string): string {
  return source.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
}

/** Index after the `)` that closes a `(` opened just before `from`. */
function skipParens(src: string, from: number): number {
  let i = from; let depth = 1;
  while (i < src.length && depth > 0) { if (src[i] === '(') depth += 1; else if (src[i] === ')') depth -= 1; i += 1; }
  return i;
}

/**
 * Same-length copy where '<' inside {{ ... }} and inside control-flow headers (@if (a < b) {) is blanked,
 * so an expression is never mistaken for a tag.
 */
function maskExpressions(src: string, controlFlowBlocks: boolean): string {
  const chars = src.replace(/\{\{[\s\S]*?\}\}/g, (m) => m.replace(/</g, ' ')).split('');
  if (!controlFlowBlocks) return chars.join('');
  for (const m of src.matchAll(/@(?:if|else\s+if|for|switch|case|defer|placeholder|loading)\s*\(/g)) {
    const from = (m.index ?? 0) + m[0].length;
    const to = skipParens(src, from);
    for (let i = from; i < to; i += 1) if (src[i] === '<') chars[i] = ' ';
  }
  return chars.join('');
}

export interface ParseOptions {
  /** The loop an element starts itself (*ngFor, v-for, ...), if any. */
  loopOf(attrs: Attrs, tag: string): Loop | undefined;
  /** Angular block syntax: @for (...) { } repeats its content, and '<' may appear in @if (...) headers. */
  controlFlowBlocks: boolean;
}

interface ForBlock { open: number; end: number; loop: Loop }

/** Ranges covered by `@for (item of items; track item.id; let i = $index) { ... }` blocks. */
function forBlocks(src: string): ForBlock[] {
  const blocks: ForBlock[] = [];
  for (const m of src.matchAll(/@for\s*\(/g)) {
    const headerStart = (m.index ?? 0) + m[0].length;
    const headerEnd = skipParens(src, headerStart);
    const header = src.slice(headerStart, headerEnd - 1);
    const open = src.indexOf('{', headerEnd);
    if (open < 0) continue;
    let depth = 1; let j = open + 1;
    while (j < src.length && depth > 0) { if (src[j] === '{') depth += 1; else if (src[j] === '}') depth -= 1; j += 1; }
    const loop: Loop = { itemVars: [], indexVars: ['$index'] };
    const item = new RegExp(`^\\s*(${IDENT})\\s+of\\b`).exec(header);
    if (item) loop.itemVars.push(item[1]);
    for (const alias of header.matchAll(new RegExp(`(${IDENT})\\s*=\\s*\\$index\\b`, 'g'))) loop.indexVars.push(alias[1]);
    blocks.push({ open, end: j, loop });
  }
  return blocks;
}

/** Index after the `}` that closes the `{` at `open`. */
function closeBrace(src: string, open: number): number {
  let depth = 1; let j = open + 1;
  while (j < src.length && depth > 0) { if (src[j] === '{') depth += 1; else if (src[j] === '}') depth -= 1; j += 1; }
  return j;
}

interface ArmBlock { open: number; end: number; branch: Branch }

/**
 * Ranges of the arms of `@if (...) { } @else if (...) { } @else { }` chains and of the `@case` / `@default`
 * arms of `@switch (...) { }`. Only one arm of a chain or switch is rendered at a time.
 */
function armBlocks(src: string): ArmBlock[] {
  const arms: ArmBlock[] = [];
  const skipSpace = (k: number) => { while (k < src.length && /\s/.test(src[k])) k += 1; return k; };
  for (const m of src.matchAll(/@if\s*\(/g)) {
    const group = `if@${m.index}`;
    let k = skipParens(src, (m.index ?? 0) + m[0].length);
    for (let arm = 0; ; arm += 1) {
      const open = src.indexOf('{', k);
      if (open < 0) break;
      const end = closeBrace(src, open);
      arms.push({ open, end, branch: { group, arm } });
      k = skipSpace(end);
      const next = /^@else\b\s*(if\s*\()?/.exec(src.slice(k, k + 40));
      if (!next) break;
      k += next[0].length;
      if (next[1]) k = skipParens(src, k);
    }
  }
  for (const m of src.matchAll(/@switch\s*\(/g)) {
    const group = `switch@${m.index}`;
    const open = src.indexOf('{', skipParens(src, (m.index ?? 0) + m[0].length));
    if (open < 0) continue;
    const end = closeBrace(src, open);
    let arm = 0;
    for (let k = open + 1; k < end - 1;) {
      const c = /@(?:case\s*\(|default\b)/g;
      c.lastIndex = k;
      const found = c.exec(src);
      if (!found || found.index >= end - 1) break;
      let h = found.index + found[0].length;
      if (found[0].startsWith('@case')) h = skipParens(src, h);
      const armOpen = src.indexOf('{', h);
      if (armOpen < 0 || armOpen >= end) break;
      const armEnd = closeBrace(src, armOpen);
      arms.push({ open: armOpen, end: armEnd, branch: { group, arm } });
      arm += 1;
      k = armEnd;
    }
  }
  return arms;
}

/**
 * Parse a start tag beginning at `start` ('<'). Quoted attribute values may contain '<' and '>'.
 * Returns the attributes, the index after '>', and whether the tag is self-closing.
 */
function parseStartTag(src: string, start: number): { tag: string; rawTag: string; attrs: Attrs; end: number; selfClosing: boolean } | null {
  const nameMatch = /^<([a-zA-Z][\w:-]*)/.exec(src.slice(start, start + 100));
  if (!nameMatch) return null;
  const rawTag = nameMatch[1];
  const tag = rawTag.toLowerCase();
  const attrs: Attrs = new Map();
  let i = start + nameMatch[0].length;
  while (i < src.length) {
    while (i < src.length && /\s/.test(src[i])) i += 1;
    if (src[i] === '>') return { tag, rawTag, attrs, end: i + 1, selfClosing: false };
    if (src[i] === '/' && src[i + 1] === '>') return { tag, rawTag, attrs, end: i + 2, selfClosing: true };
    const nameStart = i;
    while (i < src.length && !/[\s=>]/.test(src[i]) && !(src[i] === '/' && src[i + 1] === '>')) i += 1;
    const name = src.slice(nameStart, i).toLowerCase();
    if (!name) { i += 1; continue; }
    while (i < src.length && /\s/.test(src[i])) i += 1;
    let value = '';
    if (src[i] === '=') {
      i += 1;
      while (i < src.length && /\s/.test(src[i])) i += 1;
      const q = src[i];
      if (q === '"' || q === "'") {
        const close = src.indexOf(q, i + 1);
        value = src.slice(i + 1, close < 0 ? src.length : close);
        i = close < 0 ? src.length : close + 1;
      } else {
        const valueStart = i;
        while (i < src.length && !/[\s>]/.test(src[i])) i += 1;
        value = src.slice(valueStart, i);
      }
    }
    attrs.set(name, value);
  }
  return { tag, rawTag, attrs, end: src.length, selfClosing: false };
}

export function parseTemplate(raw: string, options: ParseOptions): Template {
  const src = stripComments(raw);
  const scan = maskExpressions(src, options.controlFlowBlocks); // used to find tags; attribute values come from it too (only '<' inside {{ }} differs)
  const lineStarts = [0];
  for (let i = 0; i < src.length; i += 1) if (src[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (index: number) => {
    let lo = 0; let hi = lineStarts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= index) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
  const blocks = options.controlFlowBlocks ? forBlocks(src) : [];
  const arms = options.controlFlowBlocks ? armBlocks(src).sort((a, b) => a.open - b.open) : [];

  // <!-- testid-scan: reviewed --> applies to the tag that starts right after it
  const reviewedStarts = new Map<number, string | undefined>();
  for (const m of raw.matchAll(/<!--\s*testid-scan:\s*reviewed\b(?:\s+([0-9a-f]{8})\b)?[\s\S]*?-->/g)) {
    let k = (m.index ?? 0) + m[0].length;
    while (k < src.length && /\s/.test(src[k])) k += 1;
    if (src[k] === '<') reviewedStarts.set(k, m[1]);
  }

  const nodes: TemplateNode[] = [];
  const stack: Array<{ tag: string; index: number; start: number; loop?: Loop }> = [];

  let i = 0;
  while (i < scan.length) {
    const lt = scan.indexOf('<', i);
    if (lt < 0) break;
    if (scan[lt + 1] === '/') {
      const m = /^<\/([a-zA-Z][\w:-]*)\s*>/.exec(scan.slice(lt, lt + 100));
      if (m) {
        const tag = m[1].toLowerCase();
        for (let s = stack.length - 1; s >= 0; s -= 1) {
          if (stack[s].tag === tag) {
            // also closes anything left open inside it (unclosed <p>, <li>, ...)
            for (let k = stack.length - 1; k >= s; k -= 1) nodes[stack[k].index].contentEnd = lt;
            stack.length = s;
            break;
          }
        }
        i = lt + m[0].length;
        continue;
      }
      i = lt + 1;
      continue;
    }
    const parsed = parseStartTag(scan, lt);
    if (!parsed) { i = lt + 1; continue; }
    const { tag, rawTag, attrs, end, selfClosing } = parsed;
    const loop = options.loopOf(attrs, tag);
    // outermost first: block loops and element loops can be nested in either order
    const loops = [
      ...blocks.filter((b) => lt > b.open && lt < b.end).map((b) => ({ at: b.open, loop: b.loop })),
      ...stack.flatMap((s) => (s.loop ? [{ at: s.start, loop: s.loop }] : [])),
      ...(loop ? [{ at: lt, loop }] : []),
    ].sort((a, b) => a.at - b.at).map((entry) => entry.loop);
    nodes.push({
      tag, rawTag, attrs, line: lineOf(lt), contentStart: end, contentEnd: end,
      parent: stack.at(-1)?.index ?? -1, loops, branches: arms.filter((a) => lt > a.open && lt < a.end).map((a) => a.branch), reviewed: reviewedStarts.has(lt), reviewedFingerprint: reviewedStarts.get(lt),
    });
    if (!selfClosing && !VOID_TAGS.has(tag)) stack.push({ tag, index: nodes.length - 1, start: lt, loop });
    i = end;
  }
  // elements never closed run to the end of the template
  for (const open of stack) nodes[open.index].contentEnd = src.length;

  return { src, nodes };
}

export function hasAttr(attrs: Attrs, ...names: string[]): boolean {
  return names.some((n) => attrs.has(n));
}

/** Nearest ancestor (not the node itself) that passes the test, or -1. */
export function findAncestor(tpl: Template, index: number, test: (node: TemplateNode, index: number) => boolean): number {
  let p = tpl.nodes[index].parent;
  while (p >= 0) {
    if (test(tpl.nodes[p], p)) return p;
    p = tpl.nodes[p].parent;
  }
  return -1;
}

export function contentOf(tpl: Template, node: TemplateNode): string {
  return tpl.src.slice(node.contentStart, node.contentEnd);
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Indexes of the elements that contain the default slot (`<slot>`, `<ng-content>`): they show what their component is given. */
export function passingContent(nodes: TemplateNode[], slotTag: string): Set<number> {
  const result = new Set<number>();
  nodes.forEach((node) => {
    if (node.tag !== slotTag || (node.attrs.get('name') ?? 'default') !== 'default' || node.attrs.has('select')) return;
    for (let p = node.parent; p >= 0; p = nodes[p].parent) result.add(p);
  });
  return result;
}
