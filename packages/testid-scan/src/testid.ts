/** Reading a test ID from an element and checking it against the naming rules. */
import type { Config } from './config.ts';

export interface TestId {
  /** The value as written in the template. */
  raw: string;
  /**
   * static  - a fixed string
   * dynamic - a fixed part plus runtime values, e.g. "orders-row-{{ order.id }}"
   * opaque  - nothing fixed to check, e.g. [attr.data-testid]="testId"
   */
  kind: 'static' | 'dynamic' | 'opaque';
  /** The fixed part with runtime values removed, e.g. "orders-row". Equals `raw` for a static ID. */
  skeleton: string;
  /** The runtime expressions inside the ID. */
  exprs: string[];
  /** The ID with each runtime value shown as <expression>, e.g. "orders-row-<order.id>". */
  pattern: string;
}

const tidy = (s: string) => s.replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');

function quoted(part: string): string | undefined {
  const m = /^\s*(['"])((?:(?!\1).)*)\1\s*$/.exec(part);
  return m?.[2];
}

/** Split `a + 'b' + f(c + d)` on the '+' signs that are not inside quotes or brackets. */
function splitConcat(expr: string): string[] {
  const parts: string[] = [];
  let depth = 0; let quote = ''; let current = '';
  for (const ch of expr) {
    if (quote) { if (ch === quote) quote = ''; current += ch; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; current += ch; continue; }
    if ('([{'.includes(ch)) depth += 1;
    if (')]}'.includes(ch)) depth -= 1;
    if (ch === '+' && depth === 0) { parts.push(current); current = ''; continue; }
    current += ch;
  }
  parts.push(current);
  return parts;
}

/** Build a TestId from its fixed text and the runtime expressions that were cut out of it. */
export function makeTestId(raw: string, fixed: string, exprs: string[], pattern = fixed): TestId {
  const skeleton = tidy(fixed);
  if (!exprs.length) return { raw: fixed, kind: 'static', skeleton: fixed, exprs, pattern: fixed }; // also [attr.x]="'literal'"
  return { raw, kind: /[a-zA-Z0-9]/.test(skeleton) ? 'dynamic' : 'opaque', skeleton, exprs, pattern };
}

/**
 * Read a test ID from an HTML-like template: plain, interpolated or bound.
 * `boundNames` are the attribute names that bind it to an expression, e.g. [attr.data-testid] or :data-testid.
 */
export function readTestId(attrs: Map<string, string>, attribute: string, boundNames: string[]): TestId | undefined {
  const plain = attrs.get(attribute);
  if (plain !== undefined) {
    // data-testid="orders-row-{{ order.id }}"
    const exprs: string[] = [];
    const fixed = plain.replace(/\{\{([\s\S]*?)\}\}/g, (_m, e: string) => { exprs.push(e.trim()); return ''; });
    return makeTestId(plain, fixed, exprs, plain.replace(/\{\{([\s\S]*?)\}\}/g, (_m, e: string) => `<${e.trim()}>`));
  }
  const boundName = boundNames.find((name) => attrs.has(name));
  const bound = boundName === undefined ? undefined : attrs.get(boundName);
  if (bound === undefined) return undefined;
  // [attr.data-testid]="`orders-row-${order.id}`"
  const tpl = /^\s*`([\s\S]*)`\s*$/.exec(bound);
  if (tpl) {
    const exprs: string[] = [];
    const fixed = tpl[1].replace(/\$\{([\s\S]*?)\}/g, (_m, e: string) => { exprs.push(e.trim()); return ''; });
    return makeTestId(bound, fixed, exprs, tpl[1].replace(/\$\{([\s\S]*?)\}/g, (_m, e: string) => `<${e.trim()}>`));
  }
  // [attr.data-testid]="'orders-row-' + order.id"  (also a plain 'literal')
  const exprs: string[] = [];
  let fixed = '';
  let pattern = '';
  for (const part of splitConcat(bound)) {
    const text = quoted(part);
    if (text !== undefined) { fixed += text; pattern += text; } else { exprs.push(part.trim()); pattern += `<${part.trim()}>`; }
  }
  return makeTestId(bound, fixed, exprs, pattern);
}

/** The allowed suffix an ID ends with ("menu-item" wins over "item"), if any. */
export function typeSuffix(id: string, suffixes: string[]): string | undefined {
  const parts = id.split('-');
  const lastTwo = parts.slice(-2).join('-');
  if (parts.length > 2 && suffixes.includes(lastTwo)) return lastTwo;
  const last = parts.at(-1) ?? '';
  return suffixes.includes(last) ? last : undefined;
}

/** Naming rules that depend only on the ID itself. `id` is the fixed part for a dynamic ID. */
export function namingViolations(id: string, cfg: Config): string[] {
  const v: string[] = [];
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) v.push('not kebab-case');
  else if (cfg.requireTypeSuffix && !id.includes('-')) v.push('too short (expected <context>-<type>)');
  if (cfg.prefixes.length && !cfg.prefixes.some((p) => id.startsWith(`${p}-`))) v.push(`prefix (expected ${cfg.prefixes.join(', ')})`);
  if (cfg.requireTypeSuffix && cfg.suffixes.length && !typeSuffix(id, cfg.suffixes)) v.push('type suffix');
  const parts = id.split('-');
  for (let size = 1; size <= Math.floor(parts.length / 2); size += 1) {
    for (let s = 0; s + size * 2 <= parts.length; s += 1) {
      if (parts.slice(s, s + size).join('-') === parts.slice(s + size, s + size * 2).join('-')) v.push('repeated word');
    }
  }
  return [...new Set(v)];
}

/** Name of a separate record-key attribute such as data-order-id, [attr.data-user-key] or :data-order-id, if the element has one. */
export function entityKeyOf(attributeNames: Iterable<string>, testIdAttribute: string): string | undefined {
  const own = new Set(['', '[attr.', '[', ':', 'v-bind:'].flatMap((p) => [`${p}${testIdAttribute}`, `${p}${testIdAttribute}]`]));
  return [...attributeNames].map((k) => k.toLowerCase()).find((k) => !own.has(k) && /^(\[attr\.|\[|:|v-bind:)?data-[a-z0-9-]+-(id|key)\]?$/.test(k));
}
