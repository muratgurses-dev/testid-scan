/**
 * Vite plugin for test builds: writes data-tsrc="<file>:<line>" on every HTML element written in a React (JSX/TSX)
 * or Vue single-file component, so testid-scan-page --verify can tell for certain which source line an element
 * on the page came from. File paths are relative to `root`, the folder you give testid-scan.
 *
 *   // vite.config.ts
 *   import { testidSource } from 'testid-scan-page/vite';
 *   export default defineConfig({ plugins: [process.env.E2E ? testidSource({ root: 'src' }) : null, react()] });
 *
 * HTML elements get data-tsrc with their own line. Component tags get data-tsrc-use with the line where they are used:
 * a component that passes its props on to its element (React's {...props}, Vue's attribute fall-through) then shows
 * the line of its use, which is the line testid-scan reports for it. The two are separate attributes so that a passed
 * on use never hides the line an element was written at. Use it for test builds; it adds an attribute to
 * every element.
 */
import { createRequire } from 'node:module';
import { relative, resolve } from 'node:path';
import type * as TS from 'typescript';

export interface SourcePluginOptions {
  /** The folder testid-scan scans, relative to the Vite root (default: src). */
  root?: string;
  /** Attribute to write (default: data-tsrc). */
  attribute?: string;
  /** Also mark component tags with the line of their use (default: true). */
  components?: boolean;
}

/** A plain HTML tag: lowercase, no hyphen, no dot (not a component, a custom element or motion.div). */
export const isHtmlTag = (tag: string) => /^[a-z][a-z0-9]*$/.test(tag);

/** Tags that render no element of their own or take no attributes: never marked. */
const SKIP = new Set(['fragment', 'react.fragment', 'suspense', 'react.suspense', 'strictmode', 'profiler', 'transition', 'transitiongroup', 'keepalive', 'teleport', 'component', 'slot', 'template', 'routerview']);
const skipped = (tag: string) => SKIP.has(tag.toLowerCase().replace(/-/g, '')) || /\.(Provider|Consumer)$/.test(tag);

type Insertion = { at: number; text: string };
const apply = (code: string, insertions: Insertion[]) => {
  let out = code;
  for (const { at, text } of [...insertions].sort((a, b) => b.at - a.at)) out = out.slice(0, at) + text + out.slice(at);
  return out;
};

/** Mark the HTML elements of a JSX or TSX source. */
export function markJsx(code: string, file: string, rel: string, attribute: string, ts: typeof TS, components = true): string {
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.JSX);
  const insertions: Insertion[] = [];
  const visit = (node: TS.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sf);
      const name = isHtmlTag(tag) ? attribute : `${attribute}-use`;
      const has = node.attributes.properties.some((p) => ts.isJsxAttribute(p) && p.name.getText(sf) === name);
      if ((isHtmlTag(tag) || (components && !skipped(tag))) && !has) {
        // the line of the whole element, as testid-scan records it
        const line = sf.getLineAndCharacterOfPosition((ts.isJsxOpeningElement(node) ? node.parent : node).getStart(sf)).line + 1;
        insertions.push({ at: node.tagName.end, text: ` ${name}="${rel}:${line}"` });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return apply(code, insertions);
}

interface VueNode { type: number; tag?: string; tagType?: number; loc: { start: { offset: number; line: number } }; children?: VueNode[]; props?: Array<{ name: string }> }

/** Mark the HTML elements of a Vue single-file component's template (an HTML template; Pug is left alone). */
export function markVue(code: string, file: string, rel: string, attribute: string, compiler: { parse: (src: string, o: { filename: string }) => { descriptor: { template: { lang?: string; ast?: VueNode } | null } } }, components = true): string {
  const template = compiler.parse(code, { filename: file }).descriptor.template;
  if (!template?.ast || (template.lang && template.lang !== 'html')) return code;
  const insertions: Insertion[] = [];
  const visit = (node: VueNode) => {
    // type 1 = element; tagType 0 = a plain element (1 component, 2 slot, 3 template)
    const plain = node.tagType === 0 && node.tag && isHtmlTag(node.tag);
    const component = components && node.tagType === 1 && node.tag && !skipped(node.tag);
    const name = plain ? attribute : `${attribute}-use`;
    if (node.type === 1 && (plain || component) && !node.props?.some((p) => p.name === name)) {
      insertions.push({ at: node.loc.start.offset + 1 + node.tag!.length, text: ` ${name}="${rel}:${node.loc.start.line}"` });
    }
    for (const child of node.children ?? []) visit(child);
  };
  for (const child of template.ast.children ?? []) visit(child);
  return apply(code, insertions);
}

export function testidSource(options: SourcePluginOptions = {}) {
  const attribute = options.attribute ?? 'data-tsrc';
  let root = '';
  const load = <T>(from: string, name: string): T | undefined => {
    for (const base of [from, `${process.cwd()}/`, import.meta.url]) {
      try { return createRequire(base)(name) as T; } catch { /* try the next place */ }
    }
    return undefined;
  };
  return {
    name: 'testid-scan-source',
    enforce: 'pre' as const,
    configResolved(config: { root: string }) { root = resolve(config.root, options.root ?? 'src'); },
    transform(code: string, id: string) {
      if (id.includes('?') || id.includes('/node_modules/') || id.includes('\0')) return undefined;
      const file = resolve(id);
      if (!file.startsWith(root)) return undefined;
      const rel = relative(root, file).replace(/\\/g, '/');
      if (file.endsWith('.vue')) {
        const compiler = load<Parameters<typeof markVue>[4]>(file, 'vue/compiler-sfc');
        if (!compiler) { console.warn('testid-scan-source: vue/compiler-sfc not found, .vue files are not marked'); return undefined; }
        return { code: markVue(code, file, rel, attribute, compiler, options.components ?? true), map: null };
      }
      if (/\.[jt]sx$/.test(file)) {
        const ts = load<typeof TS>(file, 'typescript');
        if (!ts) { console.warn('testid-scan-source: the typescript package is needed to mark JSX'); return undefined; }
        return { code: markJsx(code, file, rel, attribute, ts, options.components ?? true), map: null };
      }
      return undefined;
    },
  };
}

export default testidSource;
