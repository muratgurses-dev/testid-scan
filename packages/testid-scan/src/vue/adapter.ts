/** Vue: turns the <template> block of a single-file component into candidates for the core. */
import type { ComponentSpec, Config } from '../config.ts';
import { attributeText, indexTemplate, placeholderOf, resolveName } from '../html/names.ts';
import type { Dialect } from '../html/names.ts';
import { hasAttr, parseTemplate, passingContent } from '../html/template.ts';
import type { Attrs, Template, TemplateNode } from '../html/template.ts';
import { translateKey } from '../i18n.ts';
import type { ScanContext, Text } from '../i18n.ts';
import { entityKeyOf, readTestId } from '../testid.ts';
import { ROLE_KINDS } from '../types.ts';
import type { Branch, Candidate, Loop } from '../types.ts';

/** @click, @click.prevent, v-on:click, @keydown.enter, @keyup.enter */
const CLICK = /^(?:@|v-on:)(?:click|keydown|keyup)(?:\.|$)/;
/** my-button and MyButton are the same component in Vue. */
const tagKey = (tag: string) => tag.toLowerCase().replace(/-/g, '');
const identifiers = (s: string) => s.match(/[A-Za-z_$][\w$]*/g) ?? [];

/** v-for="item in items" / "(item, index) in items" / "{ id, name } of items" */
function loopOf(attrs: Attrs): Loop | undefined {
  const value = attrs.get('v-for');
  if (value === undefined) return undefined;
  const m = /^\s*(?:\(([^)]*)\)|(\{[^}]*\}|\[[^\]]*\]|[\w$]+))\s+(?:in|of)\s/.exec(value);
  if (!m) return { itemVars: [], indexVars: [] };
  if (m[2]) return { itemVars: identifiers(m[2]), indexVars: [] };
  // split "(item, index)" on commas that are not inside a destructuring pattern
  const parts: string[] = [];
  let depth = 0; let current = '';
  for (const ch of m[1]) {
    if ('{['.includes(ch)) depth += 1;
    if ('}]'.includes(ch)) depth -= 1;
    if (ch === ',' && depth === 0) { parts.push(current); current = ''; } else current += ch;
  }
  parts.push(current);
  return { itemVars: identifiers(parts[0] ?? ''), indexVars: parts.slice(1).flatMap(identifiers) };
}

/** 'Save', $t('KEY'), t("KEY"): fixed text. Anything else (a variable, a call with parameters) is undefined. */
function literal(ctx: ScanContext, expr: string): Text | undefined {
  const quoted = /^\s*(['"`])((?:(?!\1)[^$]|\$(?!\{))+)\1\s*$/.exec(expr);
  if (quoted) return { text: quoted[2], dynamic: false, keys: [], missingKeys: [] };
  const call = /^\s*([\w$.]+)\s*\(\s*(['"`])((?:(?!\2).)+)\2\s*\)\s*$/.exec(expr);
  if (!call || !ctx.cfg.translateFunctions.includes(call[1])) return undefined;
  const translated = translateKey(ctx, call[3]);
  return translated.dynamic ? undefined : translated;
}

const specs = new WeakMap<Config, Map<string, ComponentSpec>>();

/** The `components` map with keys normalised, so "v-btn", "VBtn" and "vBtn" all find the same entry. */
function componentSpecs(cfg: Config): Map<string, ComponentSpec> {
  let map = specs.get(cfg);
  if (!map) {
    map = new Map();
    for (const [name, spec] of Object.entries(cfg.components)) {
      if (spec) map.set(tagKey(name), typeof spec === 'string' ? { kind: spec, nameProps: ['label'] } : { nameProps: ['label'], ...spec });
      else map.delete(tagKey(name)); // "" removes a default
    }
    specs.set(cfg, map);
  }
  return map;
}

/** A plain HTML tag is written in lowercase without a hyphen; anything else is a component. */
const isHtml = (node: TemplateNode) => /^[a-z][a-z0-9]*$/.test(node.rawTag);

function dialectFor(cfg: Config): Dialect {
  return {
    literal,
    bound: (name) => [`:${name}`, `v-bind:${name}`],
    conditionalAttrs: ['v-if', 'v-else-if', 'v-else', 'v-show', ':hidden'],
    contentBindings: ['v-text', 'v-html'],
    controlFlowBlocks: false,
    tagKey,
    nameAttrs: (node) => (isHtml(node) ? [] : componentSpecs(cfg).get(tagKey(node.tag))?.nameProps ?? []),
  };
}

function kindOf(node: TemplateNode, cfg: Config): { kind: string; hasRole: boolean; roleUnknown?: boolean } | undefined {
  const { tag, attrs } = node;
  const withRole = (kind: string) => ({ kind, hasRole: true });
  const role = (attrs.get('role') ?? '').trim().toLowerCase();
  if (Object.hasOwn(ROLE_KINDS, role)) return withRole(ROLE_KINDS[role]);
  const clickable = [...attrs.keys()].some((name) => CLICK.test(name));
  if (!isHtml(node)) {
    const spec = componentSpecs(cfg).get(tagKey(tag));
    if (spec) return withRole(spec.kind);
    return clickable ? { kind: 'button', hasRole: false, roleUnknown: true } : undefined;
  }
  if (tag === 'button') return withRole('button');
  if (tag === 'a' && hasAttr(attrs, 'href', ':href', 'v-bind:href')) return withRole('link');
  if (tag === 'input') {
    const type = (attrs.get('type') ?? '').toLowerCase();
    if (type === 'hidden') return undefined;
    if (type === 'checkbox' || type === 'radio') return withRole(type);
    return withRole(['submit', 'button', 'reset', 'image'].includes(type) ? 'button' : 'input');
  }
  if (tag === 'select') return withRole('select');
  if (tag === 'textarea') return withRole('input');
  if (tag === 'table') return withRole('table');
  if (tag === 'tr' && node.loops.length) return withRole('row');
  if (hasAttr(attrs, 'contenteditable', ':contenteditable')) return withRole('input');
  // A non-semantic element (div, span, <a> without href...) made clickable: no role for getByRole to find.
  return clickable ? { kind: 'button', hasRole: false } : undefined;
}

/** Props bound to an expression (:order="o", v-bind:order="o"); names lose their hyphens so order-item and orderItem agree. */
function boundPropsOf(node: TemplateNode): Record<string, string> {
  const props: Record<string, string> = {};
  for (const [name, value] of node.attrs) {
    const m = /^(?::|v-bind:)([a-z][\w-]*)$/.exec(name);
    if (m && !['key', 'class', 'style', 'is', 'ref'].includes(m[1])) props[m[1].replace(/-/g, '')] = value || m[1];
  }
  return props;
}

/** Props given as plain text (name="home"); names lose their hyphens like the bound ones. */
function staticPropsOf(node: TemplateNode): Record<string, string> {
  const props: Record<string, string> = {};
  for (const [name, value] of node.attrs) if (/^[a-z][\w-]*$/.test(name) && !/^v-/.test(name)) props[name.replace(/-/g, '')] = value;
  return props;
}

export interface VueTemplate { source: string; lineOffset: number }

/**
 * The top-level <template> block of a single-file component.
 * Returns a reason instead when there is none the scanner can read.
 */
export function vueTemplate(text: string): VueTemplate | { skipped: string } {
  const open = /^<template\b([^>]*)>/m.exec(text);
  if (!open) return { skipped: 'no <template> block (render function or JSX)' };
  if (/\blang\s*=\s*["']?(pug|jade)\b/i.test(open[1])) return { skipped: 'template is written in Pug' };
  if (/\bsrc\s*=/.test(open[1])) return { skipped: 'template is in an external file' };
  const start = open.index + open[0].length;
  // find the matching </template>, stepping over nested <template v-if> / <template #slot> blocks
  let depth = 1; let end = text.length;
  const tags = /<template\b[^>]*?(\/?)>|<\/template\s*>/g;
  tags.lastIndex = start;
  for (let m = tags.exec(text); m; m = tags.exec(text)) {
    if (m[0].startsWith('</')) depth -= 1;
    else if (!m[1]) depth += 1;
    if (depth === 0) { end = m.index; break; }
  }
  return { source: text.slice(start, end), lineOffset: text.slice(0, start).split('\n').length - 1 };
}

/** The v-if / v-else-if / v-else arms each element is in. A chain is a run of sibling elements. */
function branchesOf(tpl: Template): Branch[][] {
  const own: Array<Branch | undefined> = [];
  const lastChild = new Map<number, number>(); // parent -> its latest child seen so far
  tpl.nodes.forEach((n, i) => {
    const previous = lastChild.get(n.parent);
    lastChild.set(n.parent, i);
    if (hasAttr(n.attrs, 'v-if')) { own.push({ group: `vif@${i}`, arm: 0 }); return; }
    const chain = previous !== undefined ? own[previous] : undefined;
    own.push(chain && hasAttr(n.attrs, 'v-else-if', 'v-else') ? { group: chain.group, arm: i } : undefined);
  });
  const all: Branch[][] = [];
  tpl.nodes.forEach((n, i) => { all.push([...(n.parent >= 0 ? all[n.parent] : []), ...(own[i] ? [own[i] as Branch] : [])]); });
  return all;
}

/** `lineOffset` is added to line numbers, so they point into the .vue file. */
export function vueCandidates(source: string, ctx: ScanContext, lineOffset = 0): Candidate[] {
  const { cfg } = ctx;
  const dialect = dialectFor(cfg);
  const tpl = parseTemplate(source, { loopOf, controlFlowBlocks: false });
  const index = indexTemplate(tpl);
  const boundTestId = dialect.bound(cfg.testIdAttribute);
  const branch = (n: TemplateNode) => hasAttr(n.attrs, 'v-else-if', 'v-else'); // the v-if itself counts once for the chain
  const conditionalAt = (i: number): boolean => { for (let p = i; p >= 0; p = tpl.nodes[p].parent) if (branch(tpl.nodes[p])) return true; return false; };
  const passes = passingContent(tpl.nodes, 'slot');
  const branches = branchesOf(tpl);
  const rendersConditionally = (i: number): boolean => {
    for (let p = i; p >= 0; p = tpl.nodes[p].parent) {
      const n = tpl.nodes[p];
      if (hasAttr(n.attrs, 'v-if', 'v-else-if', 'v-else', 'v-show', ':hidden', 'v-bind:hidden')) return true;
      // a named slot's content (<template #footer>): the component decides when, or whether, it is shown
      if (n.tag === 'template' && [...n.attrs.keys()].some((a) => a.startsWith('#') || a.startsWith('v-slot'))) return true;
    }
    return false;
  };
  return tpl.nodes.map((node, i) => {
    const kind = kindOf(node, cfg);
    const testId = readTestId(node.attrs, cfg.testIdAttribute, boundTestId);
    const label = /^\s*(?:props\.)?([A-Za-z_$][\w$]*)\s*$/.exec(node.attrs.get(':aria-label') ?? node.attrs.get('v-bind:aria-label') ?? '');
    return {
      staticProps: isHtml(node) ? undefined : staticPropsOf(node),
      usageName: !isHtml(node) && !kind ? resolveName(ctx, dialect, tpl, index, i, 'button') : undefined,
      passesContent: passes.has(i), nameProp: label?.[1],
      line: node.line + lineOffset, tag: node.rawTag, parent: node.parent, loops: node.loops, reviewed: node.reviewed, reviewedFingerprint: node.reviewedFingerprint,
      kind: kind?.kind, hasRole: kind?.hasRole, roleUnknown: kind?.roleUnknown,
      isTable: node.tag === 'table' || (!isHtml(node) && componentSpecs(cfg).get(tagKey(node.tag))?.kind === 'table'),
      name: kind || testId ? resolveName(ctx, dialect, tpl, index, i, kind?.kind ?? 'other') : undefined,
      testId, entityKey: entityKeyOf(node.attrs.keys(), cfg.testIdAttribute),
      placeholder: placeholderOf(attributeText(ctx, dialect, node, 'placeholder'), Boolean(ctx.i18n)),
      component: !isHtml(node), boundProps: isHtml(node) ? undefined : boundPropsOf(node),
      conditional: conditionalAt(i), branches: branches[i], rendersConditionally: rendersConditionally(i),
    };
  });
}
