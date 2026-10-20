/**
 * Static approximation of an element's accessible name (what getByRole(..., { name }) matches) for
 * HTML-like templates. It follows the usual order: aria-labelledby, aria-label, own content or label,
 * then title. A placeholder or a tooltip is deliberately not a name.
 *
 * What differs between Angular and Vue (how a binding is written, what a fixed expression looks like)
 * comes in through a Dialect.
 */
import { DYNAMIC_TEXT, joinText } from '../i18n.ts';
import type { ScanContext, Text } from '../i18n.ts';
import type { NameResult } from '../types.ts';
import { contentOf, escapeRegExp, findAncestor, hasAttr } from './template.ts';
import type { Template, TemplateNode } from './template.ts';

export interface Dialect {
  /** Text of an expression when it is fixed ('Save', 'KEY' | translate, $t('KEY')); undefined when only known at runtime. */
  literal(ctx: ScanContext, expr: string): Text | undefined;
  /** Attribute names that bind `name` to an expression, e.g. [attr.title] or :title. */
  bound(name: string): string[];
  /** A placeholder on a control inside a form field wrapper is rendered as its label (Angular Material before 15). */
  placeholderLabels?: boolean;
  /** Attributes that render an element only under a condition (lowercase). */
  conditionalAttrs: string[];
  /** Attributes that replace an element's content with a runtime value (lowercase). */
  contentBindings: string[];
  /** Angular block syntax (@if, @for) may appear in text. */
  controlFlowBlocks: boolean;
  /** One key for a tag however it is written (Vue: my-button and MyButton are the same component). */
  tagKey(tag: string): string;
  /** Attributes other than aria-label that name this element, e.g. label="..." on a tab. */
  nameAttrs(node: TemplateNode): string[];
}

/** Visible, fixed text of a piece of template; `dynamic` when part of it is only known at runtime. */
function textOf(ctx: ScanContext, d: Dialect, raw: string): Text {
  const exprs: string[] = [];
  // 1. take interpolations out first, so a '<' or '>' inside them cannot confuse tag removal
  let s = raw.replace(/\{\{([\s\S]*?)\}\}/g, (_m, expr: string) => { exprs.push(expr); return `\u0001${exprs.length - 1}\u0001`; });
  // 2. drop what assistive technology does not read: icon ligatures and aria-hidden subtrees
  for (const tag of new Set(ctx.cfg.iconTags.flatMap((t) => [t, d.tagKey(t)]))) {
    s = s.replace(new RegExp(`<${escapeRegExp(tag)}\\b(?![^>]*aria-hidden\\s*=\\s*["']false["'])[^>]*>[\\s\\S]*?</${escapeRegExp(tag)}\\s*>`, 'gi'), ' ');
  }
  s = s.replace(/<([a-zA-Z][\w-]*)\b[^>]*\baria-hidden\s*=\s*["']true["'][^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  s = s.replace(/<([a-zA-Z][\w-]*)\b[^>]*\shidden(?=[\s>/])[^>]*>[\s\S]*?<\/\1\s*>/gi, ' '); // <span hidden>
  // 3. text inside an element that is only rendered under a condition is not a fixed part of the name
  let conditional = false;
  if (d.conditionalAttrs.length) {
    const attrs = d.conditionalAttrs.map(escapeRegExp).join('|');
    for (const m of s.matchAll(new RegExp(`<([a-zA-Z][\\w-]*)\\b[^>]*\\s(?:${attrs})(?=[\\s=>])[^>]*>([\\s\\S]*?)</\\1\\s*>`, 'gi'))) {
      if (m[2].replace(/<[^>]*>/g, '').trim()) conditional = true;
    }
  }
  // an image contributes its alt text; a bound alt is only known at runtime
  let boundAlt = false;
  s = s.replace(/<img\b[^>]*>/gi, (tag) => {
    if (d.bound('alt').some((name) => tag.toLowerCase().includes(` ${name}=`))) { boundAlt = true; return ' '; }
    const alt = /\salt\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    return ` ${alt?.[1] ?? alt?.[2] ?? ''} `;
  });
  // 4. drop the tags themselves (interpolations inside attributes disappear with them)
  s = s.replace(/<[^>]*>/g, ' ');
  const result: Text = { text: '', dynamic: conditional || boundAlt || (d.controlFlowBlocks && /@(if|switch|for)\b/.test(s)), keys: [], missingKeys: [] };
  s = s.replace(/\u0001(\d+)\u0001/g, (_m, n: string) => {
    const lit = d.literal(ctx, exprs[Number(n)]);
    if (!lit) { result.dynamic = true; return ' '; }
    result.keys.push(...lit.keys);
    result.missingKeys.push(...lit.missingKeys);
    return ` ${lit.text} `;
  });
  if (d.controlFlowBlocks) s = s.replace(/@(if|else|for|switch|case|default|empty)\b[^{]*\{|\}/g, ' ');
  result.text = s.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  return result;
}

/**
 * The value of an attribute written plainly (name="text") or bound ([name]="expr", :name="expr").
 * Undefined when the element does not have it.
 */
export function attributeText(ctx: ScanContext, d: Dialect, node: TemplateNode, name: string): Text | undefined {
  const plain = node.attrs.get(name);
  if (plain !== undefined) return textOf(ctx, d, plain);
  const boundName = d.bound(name).find((b) => node.attrs.has(b));
  return boundName === undefined ? undefined : d.literal(ctx, node.attrs.get(boundName) ?? '') ?? DYNAMIC_TEXT;
}

/** What the scanner knows about a placeholder, in the shape the core expects. */
export function placeholderOf(text: Text | undefined, hasTranslations: boolean): { text?: string; translationKey?: boolean } | undefined {
  if (!text) return undefined;
  if (text.dynamic || !text.text.trim()) return {};
  return { text: text.text.trim(), translationKey: text.keys.length > 0 && !hasTranslations };
}

export interface TemplateIndex { byId: Map<string, TemplateNode>; labelFor: Map<string, TemplateNode> }

export function indexTemplate(tpl: Template): TemplateIndex {
  const byId = new Map<string, TemplateNode>();
  const labelFor = new Map<string, TemplateNode>();
  for (const node of tpl.nodes) {
    const id = node.attrs.get('id');
    if (id && !byId.has(id)) byId.set(id, node);
    const target = node.tag === 'label' ? node.attrs.get('for') : undefined;
    if (target && !labelFor.has(target)) labelFor.set(target, node);
  }
  return { byId, labelFor };
}

/** Kinds that are named by a label, never by their own content (which is a value or a list of options). */
const LABELLED_KINDS = new Set(['input', 'select']);

export function resolveName(ctx: ScanContext, d: Dialect, tpl: Template, index: TemplateIndex, nodeIndex: number, kind: string): NameResult {
  const node = tpl.nodes[nodeIndex];
  const a = node.attrs;
  const candidates: Array<Text & { title?: boolean }> = [];
  const labelled = LABELLED_KINDS.has(kind) || node.tag === 'input';

  /** An attribute written plainly (name="text") or bound to an expression ([name]="expr", :name="expr"). */
  const attribute = (of: TemplateNode, name: string, title = false) => {
    const plain = of.attrs.get(name);
    if (plain !== undefined) candidates.push({ ...textOf(ctx, d, plain), title });
    const boundName = d.bound(name).find((b) => of.attrs.has(b));
    if (boundName !== undefined) candidates.push({ ...(d.literal(ctx, of.attrs.get(boundName) ?? '') ?? DYNAMIC_TEXT), title });
  };

  // aria-labelledby: resolvable when it points at fixed ids in the same template
  const labelledBy = a.get('aria-labelledby');
  if (labelledBy !== undefined) {
    const targets = labelledBy.includes('{{') ? [] : labelledBy.split(/\s+/).filter(Boolean).map((id) => index.byId.get(id));
    if (!targets.length || targets.some((t) => !t)) candidates.push(DYNAMIC_TEXT);
    else candidates.push(joinText(targets.map((t) => textOf(ctx, d, contentOf(tpl, t as TemplateNode)))));
  }
  if (hasAttr(a, ...d.bound('aria-labelledby'))) candidates.push(DYNAMIC_TEXT);

  attribute(node, 'aria-label');
  for (const name of d.nameAttrs(node)) attribute(node, name);

  // own content names the element, except for labelled controls and tables
  if (!labelled && kind !== 'table') {
    if (hasAttr(a, ...d.contentBindings)) candidates.push(DYNAMIC_TEXT);
    else if (node.contentEnd > node.contentStart) candidates.push(textOf(ctx, d, contentOf(tpl, node)));
  }

  if (labelled) {
    const fields = Object.entries(ctx.cfg.formFields).map(([tag, label]) => [d.tagKey(tag), label] as const);
    const labelOf = (n: TemplateNode) => fields.find(([key]) => key === d.tagKey(n.tag))?.[1];
    const field = findAncestor(tpl, nodeIndex, (n) => Boolean(labelOf(n)));
    if (field >= 0) {
      const spec = labelOf(tpl.nodes[field]) as string;
      if (spec.startsWith('@')) attribute(tpl.nodes[field], spec.slice(1).toLowerCase()); // the wrapper carries the label as an attribute
      else {
        const labelTag = escapeRegExp(spec);
        const m = new RegExp(`<${labelTag}\\b[^>]*>([\\s\\S]*?)</${labelTag}\\s*>`, 'i').exec(contentOf(tpl, tpl.nodes[field]));
        if (m) candidates.push(textOf(ctx, d, m[1]));
      }
      if (d.placeholderLabels) attribute(node, 'placeholder');
    }
    const id = a.get('id');
    const forLabel = id ? index.labelFor.get(id) : undefined;
    if (forLabel) candidates.push(textOf(ctx, d, contentOf(tpl, forLabel)));
    const wrap = findAncestor(tpl, nodeIndex, (n) => n.tag === 'label');
    if (wrap >= 0) {
      // the label's text without the options/value of the control it wraps
      candidates.push(textOf(ctx, d, contentOf(tpl, tpl.nodes[wrap]).replace(/<(select|mat-select|textarea)\b[\s\S]*?<\/\1\s*>/gi, ' ')));
    }
    if (node.tag === 'input' && ['submit', 'button', 'reset'].includes((a.get('type') ?? '').toLowerCase())) attribute(node, 'value');
  }

  // title is the last resort and needs runtime verification
  attribute(node, 'title', true);

  const chosen = candidates.find((c) => c.text || c.dynamic);
  return {
    label: (chosen?.text ?? '').slice(0, 80),
    kind: !chosen ? 'none' : chosen.dynamic ? 'dynamic' : 'static',
    fromTitle: Boolean(chosen?.title),
    keys: chosen?.keys ?? [],
    missingKeys: chosen?.missingKeys ?? [],
  };
}
