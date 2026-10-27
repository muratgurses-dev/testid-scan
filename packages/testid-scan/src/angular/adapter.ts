/** Angular: turns a template (an .html file or an inline template string) into candidates for the core. */
import type { Config } from '../config.ts';
import { attributeText, indexTemplate, placeholderOf, resolveName } from '../html/names.ts';
import type { Dialect } from '../html/names.ts';
import { escapeRegExp, findAncestor, hasAttr, IDENT, parseTemplate, passingContent } from '../html/template.ts';
import type { Attrs, Template, TemplateNode } from '../html/template.ts';
import { translateKey } from '../i18n.ts';
import type { ScanContext, Text } from '../i18n.ts';
import { entityKeyOf, readTestId } from '../testid.ts';
import { ROLE_KINDS } from '../types.ts';
import type { Branch, Candidate, Loop } from '../types.ts';

const CLICK_EVENTS = ['(click)', '(keydown.enter)', '(keyup.enter)'];

/** `let item of items; let i = index` / `let row` / `index as i` */
function loopFromMicrosyntax(value: string): Loop {
  const loop: Loop = { itemVars: [], indexVars: [] };
  for (const m of value.matchAll(new RegExp(`\\blet\\s+(${IDENT})\\s*(?:=\\s*([\\w$]+))?`, 'g'))) {
    if (!m[2] || m[2] === '$implicit') loop.itemVars.push(m[1]);
    else if (m[2] === 'index' || m[2] === '$index') loop.indexVars.push(m[1]);
  }
  for (const m of value.matchAll(new RegExp(`\\bindex\\s+as\\s+(${IDENT})`, 'g'))) loop.indexVars.push(m[1]);
  return loop;
}

/** The loop an element starts itself (`*ngFor`, `*matCellDef`, ...), if any. */
function ownLoop(attrs: Attrs, repeatDirectives: string[]): Loop | undefined {
  const directive = repeatDirectives.find((name) => attrs.has(name));
  if (directive === undefined) return undefined;
  const loop = loopFromMicrosyntax(attrs.get(directive) ?? '');
  // <ng-template ngFor let-item [ngForOf]="items" let-i="index">
  for (const [name, value] of attrs) {
    if (!name.startsWith('let-')) continue;
    if (value === '' || value === '$implicit') loop.itemVars.push(name.slice(4));
    else if (value === 'index') loop.indexVars.push(name.slice(4));
  }
  if (loop.itemVars.length === 1) loop.record = loop.itemVars[0];
  return loop;
}

const literalRes = new WeakMap<ScanContext, RegExp>();

/** 1: quote, 2: literal, 3: translate pipe, 4: pipe arguments */
function literalRe(ctx: ScanContext): RegExp {
  let re = literalRes.get(ctx);
  if (!re) {
    const pipes = ctx.cfg.translatePipes.map(escapeRegExp).join('|');
    const pipe = pipes ? `(\\|\\s*(?:${pipes})\\b\\s*(:[^|]*)?)?` : '()()';
    re = new RegExp(`^\\s*(['"])((?:(?!\\1).)+)\\1\\s*${pipe}\\s*$`);
    literalRes.set(ctx, re);
  }
  return re;
}

/**
 * 'Save' or 'COMMON.SAVE' | translate: a fixed string, so the name is known without running the app.
 * Returns undefined for anything else (a variable, a method call, a translation with parameters).
 */
function literal(ctx: ScanContext, expr: string): Text | undefined {
  const m = literalRe(ctx).exec(expr);
  if (!m) return undefined;
  if (!m[3]) return { text: m[2], dynamic: false, keys: [], missingKeys: [] };
  if (m[4]) return undefined; // 'KEY' | translate: { name: user } -> the text depends on runtime values
  const translated = translateKey(ctx, m[2]);
  return translated.dynamic ? undefined : translated;
}

const base: Dialect = {
  literal,
  bound: (name) => [`[attr.${name}]`, `[${name}]`, `[${name.replace(/-/g, '')}]`],
  conditionalAttrs: ['*ngif', '[hidden]'],
  contentBindings: ['[innertext]', '[textcontent]', '[innerhtml]'],
  controlFlowBlocks: true,
  tagKey: (tag) => tag.toLowerCase(),
  nameAttrs: (node) => (node.tag === 'mat-tab' || node.tag === 'mat-step' ? ['label'] : []),
};

/**
 * What kind of element is this, and does it expose a role a test can query?
 * Order matters: configured attributes, explicit role, the tag's own meaning, and only last "something with a (click)".
 */
function kindOf(node: TemplateNode, cfg: Config): { kind: string; hasRole: boolean } | undefined {
  const { tag, attrs } = node;
  const withRole = (kind: string) => ({ kind, hasRole: true });
  for (const name of attrs.keys()) {
    if (Object.hasOwn(cfg.attributes, name) && cfg.attributes[name]) return withRole(cfg.attributes[name]);
  }
  const role = (attrs.get('role') ?? '').trim().toLowerCase();
  if (Object.hasOwn(ROLE_KINDS, role)) return withRole(ROLE_KINDS[role]);
  if (tag === 'mat-tab' && hasAttr(attrs, 'label', '[label]')) return withRole('tab');
  if (tag === 'mat-step' && hasAttr(attrs, 'label', '[label]')) return withRole('step');
  if (tag === 'a' && hasAttr(attrs, 'href', '[href]', '[attr.href]', 'routerlink', '[routerlink]')) return withRole('link');
  if (tag === 'input') {
    const type = (attrs.get('type') ?? '').toLowerCase();
    if (type === 'hidden') return undefined;
    if (type === 'checkbox' || type === 'radio') return withRole(type);
    return withRole(['submit', 'button', 'reset', 'image'].includes(type) ? 'button' : 'input');
  }
  if (Object.hasOwn(cfg.elements, tag) && cfg.elements[tag]) return withRole(cfg.elements[tag]);
  if (hasAttr(attrs, 'contenteditable', '[contenteditable]')) return withRole('input');
  // Fallback: a non-semantic element (div, span, icon, <a> without href...) made clickable.
  // It has no role, so getByRole cannot find it whatever text it contains.
  if (hasAttr(attrs, ...CLICK_EVENTS)) return { kind: 'button', hasRole: false };
  return undefined;
}

/**
 * The if/else and switch arms each element is in: `*ngIf="x; else other"` with `<ng-template #other>`,
 * `*ngSwitchCase` / `*ngSwitchDefault` under one `[ngSwitch]`, and the @if / @switch blocks found by the parser.
 */
function branchesOf(tpl: Template): Branch[][] {
  const own: Branch[][] = tpl.nodes.map(() => []);
  const refs = new Map<string, number>(); // template reference (#name) -> its <ng-template>
  tpl.nodes.forEach((n, i) => {
    if (n.tag !== 'ng-template') return;
    for (const name of n.attrs.keys()) {
      const ref = /^(?:#|ref-)(.+)$/.exec(name)?.[1];
      if (ref) refs.set(ref, i);
    }
  });
  tpl.nodes.forEach((n, i) => {
    const ngIf = n.attrs.get('*ngif');
    if (ngIf !== undefined) {
      const thenRef = /\bthen\s*:?\s*([A-Za-z_$][\w$]*)/.exec(ngIf)?.[1]?.toLowerCase();
      const elseRef = /\belse\s*:?\s*([A-Za-z_$][\w$]*)/.exec(ngIf)?.[1]?.toLowerCase();
      const elseAt = elseRef ? refs.get(elseRef) : undefined;
      if (elseAt !== undefined) {
        const group = `ngif@${i}`;
        const thenAt = thenRef ? refs.get(thenRef) : undefined;
        own[thenAt ?? i].push({ group, arm: 0 });
        own[elseAt].push({ group, arm: 1 });
      }
    }
    if (hasAttr(n.attrs, '*ngswitchcase', '*ngswitchdefault')) {
      const host = findAncestor(tpl, i, (a) => hasAttr(a.attrs, '[ngswitch]'));
      own[i].push({ group: `ngswitch@${host}`, arm: i });
    }
  });
  // an element is in every arm its ancestors are in
  const all: Branch[][] = [];
  tpl.nodes.forEach((n, i) => {
    const mine = [...(n.parent >= 0 ? all[n.parent] : []), ...n.branches, ...own[i]];
    all.push(mine.filter((x, k) => mine.findIndex((y) => y.group === x.group && y.arm === x.arm) === k));
  });
  return all;
}

/** `lineOffset` is added to line numbers (used for inline templates). */
export function angularCandidates(source: string, ctx: ScanContext, lineOffset = 0): Candidate[] {
  const { cfg } = ctx;
  const tpl = parseTemplate(source, { loopOf: (attrs) => ownLoop(attrs, cfg.repeatDirectives), controlFlowBlocks: true });
  const index = indexTemplate(tpl);
  const boundTestId = base.bound(cfg.testIdAttribute);
  const dialect: Dialect = { ...base, placeholderLabels: cfg.placeholderAsLabel === 'always' };
  const branch = (n: TemplateNode) => hasAttr(n.attrs, '*ngswitchcase', '*ngswitchdefault');
  const conditionalAt = (i: number): boolean => { for (let p = i; p >= 0; p = tpl.nodes[p].parent) if (branch(tpl.nodes[p])) return true; return false; };
  const passes = passingContent(tpl.nodes, 'ng-content');
  const branches = branchesOf(tpl);
  // shown only under a condition: an @if/@switch arm, *ngIf/*ngSwitchCase, [hidden], or inside an ng-template
  const CONDITION_ATTRS = ['*ngif', '*ngswitchcase', '*ngswitchdefault', '[hidden]'];
  const rendersConditionally = (i: number): boolean => {
    if (branches[i].length) return true;
    for (let p = i; p >= 0; p = tpl.nodes[p].parent) if (hasAttr(tpl.nodes[p].attrs, ...CONDITION_ATTRS) || tpl.nodes[p].tag === 'ng-template') return true;
    return false;
  };
  return tpl.nodes.map((node, i) => {
    const kind = kindOf(node, cfg);
    const testId = readTestId(node.attrs, cfg.testIdAttribute, boundTestId);
    const isComponent = node.tag.includes('-');
    const label = new RegExp(`^\\s*(${IDENT})\\s*$`).exec(node.attrs.get('[attr.aria-label]') ?? node.attrs.get('[aria-label]') ?? '');
    let name = kind || testId ? resolveName(ctx, dialect, tpl, index, i, kind?.kind ?? 'other') : undefined;
    // Angular Material names the calendar button itself
    if (node.tag === 'mat-datepicker-toggle' && name?.kind === 'none') name = { ...name, label: 'Open calendar', kind: 'static', hint: 'default name given by Angular Material' };
    return {
      staticProps: isComponent ? staticPropsOf(node) : undefined,
      usageName: isComponent && !kind ? resolveName(ctx, dialect, tpl, index, i, 'button') : undefined,
      passesContent: passes.has(i), nameProp: label?.[1].toLowerCase(),
      line: node.line + lineOffset, tag: node.tag, parent: node.parent, loops: node.loops, reviewed: node.reviewed, reviewedFingerprint: node.reviewedFingerprint,
      kind: kind?.kind, hasRole: kind?.hasRole,
      isTable: Object.hasOwn(cfg.elements, node.tag) && cfg.elements[node.tag] === 'table',
      name,
      testId, entityKey: entityKeyOf(node.attrs.keys(), cfg.testIdAttribute),
      placeholder: placeholderOf(attributeText(ctx, dialect, node, 'placeholder'), Boolean(ctx.i18n)),
      component: node.tag.includes('-'), boundProps: node.tag.includes('-') ? boundPropsOf(node) : undefined,
      conditional: conditionalAt(i), branches: branches[i], rendersConditionally: rendersConditionally(i),
    };
  });
}

/** Inputs bound to an expression ([order]="o"). Attribute names are lowercase here, so they are compared without case. */
function boundPropsOf(node: TemplateNode): Record<string, string> {
  const props: Record<string, string> = {};
  for (const [name, value] of node.attrs) {
    const m = /^\[([a-z][\w]*)\]$/.exec(name);
    if (m && !/^ng(class|style|if|for|switch|model)/.test(m[1])) props[m[1]] = value;
  }
  return props;
}

/** Inputs given as plain text (label="Save"). */
function staticPropsOf(node: TemplateNode): Record<string, string> {
  const props: Record<string, string> = {};
  for (const [name, value] of node.attrs) if (/^[a-z][\w-]*$/.test(name)) props[name] = value;
  return props;
}

/** Element selectors of the @Component decorators in a TypeScript file, e.g. "app-order-row". */
export function componentSelectors(text: string): string[] {
  return [...text.matchAll(/\bselector\s*:\s*(['"`])([^'"`\n]+)\1/g)]
    .flatMap((m) => m[2].split(',').map((s) => s.trim()))
    .filter((s) => /^[a-z][\w-]*$/i.test(s));
}

/** Paths given as `templateUrl: './x.html'` in a TypeScript file (as written, relative to that file). */
export function templateUrls(text: string): string[] {
  return [...text.matchAll(/\btemplateUrl\s*:\s*(['"`])([^'"`\n]+)\1/g)].map((m) => m[2]);
}

export interface InlineTemplate { source: string; lineOffset: number }

/** `template: \`...\`` / `template: '...'` strings of the @Component decorators in a TypeScript file. */
export function inlineTemplates(text: string): { templates: InlineTemplate[]; skipped: string[] } {
  const templates: InlineTemplate[] = [];
  const skipped: string[] = [];
  if (!/@Component\s*\(/.test(text)) return { templates, skipped };
  for (const m of text.matchAll(/\btemplate\s*:\s*/g)) {
    const start = (m.index ?? 0) + m[0].length;
    const quote = text[start];
    if (quote !== '`' && quote !== '\'' && quote !== '"') { skipped.push('inline template is not a string literal'); continue; }
    let end = start + 1;
    while (end < text.length && text[end] !== quote) end += text[end] === '\\' ? 2 : 1;
    const source = text.slice(start + 1, end);
    if (quote === '`' && source.includes('${')) { skipped.push('inline template string contains ${...}'); continue; }
    templates.push({ source, lineOffset: text.slice(0, start + 1).split('\n').length - 1 });
  }
  return { templates, skipped };
}
