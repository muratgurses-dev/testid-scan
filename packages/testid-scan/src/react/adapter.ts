/**
 * React: turns the JSX of a .tsx/.jsx file into candidates for the core.
 * JSX is ordinary code, so it is read with the TypeScript parser (syntax only, no type checking).
 */
import { createRequire } from 'node:module';
import type * as TS from 'typescript';
import type { ComponentSpec } from '../config.ts';
import { DYNAMIC_TEXT, joinText, translateKey } from '../i18n.ts';
import type { ScanContext, Text } from '../i18n.ts';
import { iconDescription, iconsOf } from '../html/names.ts';
import { entityKeyOf, makeTestId } from '../testid.ts';
import type { TestId } from '../testid.ts';
import { ROLE_KINDS } from '../types.ts';
import type { Branch, Candidate, Loop, NameResult } from '../types.ts';

let typescript: typeof TS | undefined;

function loadTypescript(): typeof TS {
  if (typescript) return typescript;
  let loaded: typeof TS;
  try {
    loaded = createRequire(import.meta.url)('typescript') as typeof TS;
  } catch {
    throw new Error('Reading JSX needs the "typescript" package (version 5). Run: npm install --save-dev typescript@5');
  }
  if (typeof loaded.createSourceFile !== 'function') {
    throw new Error(`Reading JSX needs TypeScript 5; found ${loaded.version}, which has no parser API. Run: npm install --save-dev typescript@5`);
  }
  typescript = loaded;
  return loaded;
}

type JsxEl = TS.JsxElement | TS.JsxSelfClosingElement;

interface El {
  node: JsxEl;
  /** Tag as written: button, Button, Menu.Item. */
  tag: string;
  /** Lowercase HTML tag for an intrinsic element ("button", also for motion.button); undefined for a component. */
  html?: string;
  attrs: Map<string, TS.JsxAttribute>;
  /** `{...props}` is spread onto the element, so it may get attributes the scanner cannot see. */
  spread: boolean;
  children: readonly TS.JsxChild[];
  parent: number;
  /** The element is passed to its parent through a prop, e.g. control={<Checkbox />}. */
  viaProp: boolean;
  loops: Loop[];
  owner?: string;
}

const EMPTY: Text = { text: '', dynamic: false, keys: [], missingKeys: [] };
const fixed = (text: string): Text => ({ text, dynamic: false, keys: [], missingKeys: [] });
const CLICK_PROPS = ['onClick', 'onKeyDown', 'onKeyUp', 'onKeyPress'];
/** Elements whose own content is a value or a list of options, not label text. */
const CONTROL_TAGS = new Set(['select', 'textarea', 'input', 'option']);
/** A `testid-scan: reviewed` comment (optionally followed by a fingerprint) directly before an element. */
const MARK = 'testid-scan:\\s*reviewed\\b(?:\\s+([0-9a-f]{8})\\b)?';
const REVIEWED = new RegExp(`(?:\\{\\s*/\\*\\s*${MARK}[^*]*\\*/\\s*\\}|/\\*\\s*${MARK}[^*]*\\*/|//\\s*${MARK}[^\\n]*\\n)\\s*\\(?\\s*$`);

export function reactCandidates(text: string, fileName: string, ctx: ScanContext): Candidate[] {
  const ts = loadTypescript();
  const { cfg } = ctx;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, /\.tsx$/i.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.JSX);
  const iconRe = cfg.iconNamePattern ? new RegExp(cfg.iconNamePattern) : undefined;

  // ---------- collect every JSX element, parents before children ----------

  const els: El[] = [];
  const indexOf = new Map<TS.Node, number>();

  const bindingNames = (param: TS.ParameterDeclaration | undefined): string[] => {
    const names: string[] = [];
    const collect = (name: TS.BindingName) => {
      if (ts.isIdentifier(name)) names.push(name.text);
      else for (const element of name.elements) if (ts.isBindingElement(element)) collect(element.name);
    };
    if (param) collect(param.name);
    return names;
  };

  /** Constants declared at the top of a loop callback are per-record values: const order = byId[id]. */
  const localsOf = (fn: TS.SignatureDeclaration): string[] => {
    const body = (fn as TS.FunctionLikeDeclaration).body;
    if (!body || !ts.isBlock(body)) return [];
    return body.statements.flatMap((st) => (ts.isVariableStatement(st)
      ? st.declarationList.declarations.flatMap((d) => bindingNames(d as unknown as TS.ParameterDeclaration))
      : []));
  };
  /** A function that renders one row or cell: its parameters are the record, apart from the ones named like an index. */
  const rendererLoop = (fn: TS.SignatureDeclaration): Loop => {
    const params = fn.parameters.flatMap((p) => bindingNames(p));
    const isIndex = (n: string) => /^(i|idx|index|rowIndex)$/.test(n);
    return { itemVars: [...params.filter((n) => !isIndex(n)), ...localsOf(fn)], indexVars: params.filter(isIndex) };
  };

  /** Loops around a node: callbacks of items.map(...), items.flatMap(...) and Array.from(..., fn). */
  const loopsAround = (node: TS.Node): Loop[] => {
    const loops: Loop[] = [];
    for (let fn: TS.Node = node; fn.parent; fn = fn.parent) {
      if (!(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn) || ts.isMethodDeclaration(fn) || ts.isFunctionDeclaration(fn))) continue;
      const parent = fn.parent;
      // items.map((item, i) => ...)
      if (ts.isCallExpression(parent) && parent.arguments.includes(fn as TS.Expression)) {
        const callee = parent.expression;
        const isLoop = (ts.isPropertyAccessExpression(callee) && ['map', 'flatMap'].includes(callee.name.text)) || callee.getText(sf) === 'Array.from';
        if (isLoop) {
          const first = fn.parameters[0];
          const record = first && ts.isIdentifier(first.name) ? first.name.text : undefined;
          loops.unshift({ itemVars: [...bindingNames(first), ...localsOf(fn)], indexVars: bindingNames(fn.parameters[1]), record });
        }
        continue;
      }
      // function rowRenderer({ index }) { ... } handed to a virtual list as rowRenderer={rowRenderer}
      const declared = ts.isFunctionDeclaration(fn) ? fn.name?.text : ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name) ? parent.name.text : undefined;
      if (declared && cfg.rowRenderProps.includes(declared)) { loops.unshift(rendererLoop(fn)); continue; }
      if (ts.isFunctionDeclaration(fn)) continue;
      // A cell renderer runs once per row: columns={[{ title: 'Name', cell: ({ row }) => <a>View</a> }]}
      const property = ts.isMethodDeclaration(fn) ? fn : ts.isPropertyAssignment(parent) && parent.initializer === fn ? parent : undefined;
      const inColumnList = property && ts.isObjectLiteralExpression(property.parent) && ts.isArrayLiteralExpression(property.parent.parent);
      // ... and so does a row renderer passed as a prop: <List renderItem={(item) => <li>...</li>} />
      const attribute = ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent) ? parent.parent : undefined;
      const name = inColumnList ? property.name.getText(sf) : attribute?.name.getText(sf);
      const names = inColumnList ? cfg.cellRenderers : attribute ? cfg.rowRenderProps : [];
      if (name && names.includes(name)) loops.unshift(rendererLoop(fn));
    }
    return loops;
  };

  /** PascalCase guess from the file name, for components that are anonymous default exports. */
  const fileComponent = (() => {
    const stem = fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
    return stem.toLowerCase() === 'index' ? undefined : stem.replace(/(^|[-_.])([a-zA-Z0-9])/g, (_m, _sep: string, ch: string) => ch.toUpperCase());
  })();

  /** The component an element is written in: the nearest enclosing function, class or constant with a capitalised name. */
  const ownerOf = (node: TS.Node): string | undefined => {
    for (let p: TS.Node | undefined = node.parent; p; p = p.parent) {
      if ((ts.isFunctionDeclaration(p) || ts.isClassDeclaration(p)) && p.name && /^[A-Z]/.test(p.name.text)) return p.name.text;
      if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) && /^[A-Z]/.test(p.name.text)) return p.name.text;
    }
    return fileComponent;
  };

  /** In the else arm of a ternary, inside an if, or in a route: an alternative to another branch, not an extra instance. */
  const isConditional = (node: TS.Node): boolean => {
    for (let child: TS.Node = node, p: TS.Node | undefined = node.parent; p && !ts.isSourceFile(p); child = p, p = p.parent) {
      if (ts.isConditionalExpression(p) && p.whenFalse === child) return true;
      if (ts.isIfStatement(p)) return true;
      if (ts.isJsxElement(p) && /^(Match|Case|Show|When)$|Route$/.test(p.openingElement.tagName.getText(sf).split('.').at(-1) ?? '')) return true;
      if ((ts.isFunctionDeclaration(p) || ts.isVariableDeclaration(p)) && p.name && ts.isIdentifier(p.name) && /^[A-Z]/.test(p.name.text)) return false;
    }
    return false;
  };

  /** An if without else whose then-part always returns: what follows it in the same block is its other arm. */
  const returnsEarly = (st: TS.Statement): st is TS.IfStatement => {
    if (!ts.isIfStatement(st) || st.elseStatement) return false;
    const then = st.thenStatement;
    return ts.isReturnStatement(then) || (ts.isBlock(then) && then.statements.length > 0 && ts.isReturnStatement(then.statements[then.statements.length - 1]));
  };

  /** The arms of ternaries, if/else statements and early returns the element is in (see Branch). */
  const branchesOf = (node: TS.Node): Branch[] => {
    const found: Branch[] = [];
    for (let child: TS.Node = node, p: TS.Node | undefined = node.parent; p && !ts.isSourceFile(p); child = p, p = p.parent) {
      if (ts.isConditionalExpression(p) && child !== p.condition) found.push({ group: `?@${p.pos}`, arm: child === p.whenTrue ? 0 : 1 });
      if (ts.isIfStatement(p) && child !== p.expression) {
        found.push({ group: `if@${p.pos}`, arm: child === p.thenStatement ? 0 : 1 });
        if (returnsEarly(p)) found.push({ group: `ret@${p.pos}`, arm: 0 });
      }
      if (ts.isBlock(p)) {
        const at = p.statements.indexOf(child as TS.Statement);
        for (let k = 0; k < at; k += 1) if (returnsEarly(p.statements[k])) found.push({ group: `ret@${p.statements[k].pos}`, arm: 1 });
      }
    }
    return found;
  };

  /** Shown only under a condition: an arm of a ternary or if, after an early return, or the right side of && / || / ??. */
  const rendersConditionally = (node: TS.Node): boolean => {
    if (branchesOf(node).length) return true;
    for (let child: TS.Node = node, p: TS.Node | undefined = node.parent; p && !ts.isSourceFile(p); child = p, p = p.parent) {
      if (ts.isBinaryExpression(p) && p.right === child && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(p.operatorToken.kind)) return true;
    }
    return false;
  };

  /** Passed to a component as a prop (submitButton={<Button />}) or inside a function as children: the component decides when, or whether, it is shown. */
  const hasViaPropAncestor = (el: El): boolean => {
    for (let e: El | undefined = el; e; e = e.parent >= 0 ? els[e.parent] : undefined) if (e.viaProp) return true;
    return false;
  };

  const visit = (node: TS.Node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const tag = opening.tagName.getText(sf);
      const last = tag.split('.').at(-1) ?? tag;
      const attrs = new Map<string, TS.JsxAttribute>();
      let spread = false;
      for (const prop of opening.attributes.properties) {
        if (ts.isJsxAttribute(prop)) attrs.set(prop.name.getText(sf), prop); else spread = true;
      }
      let parent = -1; let viaProp = false;
      for (let p: TS.Node | undefined = node.parent; p; p = p.parent) {
        if (ts.isJsxAttribute(p)) viaProp = true;
        // a function as children (<Form>{({ register }) => <Input />}</Form>): the component decides when to call it
        if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) && p.parent && ts.isJsxExpression(p.parent) && !ts.isJsxAttribute(p.parent.parent)) viaProp = true;
        const found = indexOf.get(p);
        if (found !== undefined) { parent = found; break; }
      }
      indexOf.set(node, els.length);
      els.push({
        node, tag, html: /^[a-z]/.test(last) ? last : undefined, attrs, spread,
        children: ts.isJsxElement(node) ? node.children : [], parent, viaProp, loops: loopsAround(node), owner: ownerOf(node),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  // ---------- reading values ----------

  const unwrap = (e: TS.Expression): TS.Expression => (ts.isParenthesizedExpression(e) ? unwrap(e.expression) : e);

  /** Text of an expression when it is known without running the code. */
  const evalText = (expression: TS.Expression): Text => {
    const e = unwrap(expression);
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isNumericLiteral(e)) return fixed(e.text);
    if (ts.isCallExpression(e) && cfg.translateFunctions.includes(e.expression.getText(sf))) {
      const [key, ...params] = e.arguments;
      // t('KEY', { name }) -> the text depends on runtime values
      if (key && !params.length && (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key))) return translateKey(ctx, key.text);
    }
    return DYNAMIC_TEXT;
  };

  /** Value of an attribute; undefined when the element does not have it. */
  const attrText = (attr: TS.JsxAttribute | undefined): Text | undefined => {
    if (!attr) return undefined;
    const init = attr.initializer;
    if (!init) return EMPTY; // <input disabled>
    if (ts.isStringLiteral(init)) return fixed(init.text);
    if (ts.isJsxExpression(init)) return init.expression ? evalText(init.expression) : EMPTY;
    return DYNAMIC_TEXT;
  };

  /** Props given as an expression, e.g. order={order}: what a parent hands to this component. */
  const boundPropsOf = (el: El): Record<string, string> => {
    const props: Record<string, string> = {};
    for (const [name, attr] of el.attrs) {
      const init = attr.initializer;
      if (name !== 'key' && name !== 'ref' && init && ts.isJsxExpression(init) && init.expression) props[name] = init.expression.getText(sf);
    }
    return props;
  };

  const placeholderOf = (t: Text | undefined): { text?: string; translationKey?: boolean } | undefined => {
    if (!t) return undefined;
    if (t.dynamic || !t.text.trim()) return {};
    return { text: t.text.trim(), translationKey: t.keys.length > 0 && !ctx.i18n };
  };

  const isTrue = (attr: TS.JsxAttribute | undefined): boolean => {
    if (!attr) return false;
    const init = attr.initializer;
    if (!init) return true;
    if (ts.isStringLiteral(init)) return init.text === 'true';
    return ts.isJsxExpression(init) && init.expression?.kind === ts.SyntaxKind.TrueKeyword;
  };

  const specOf = (el: El): ComponentSpec | undefined => {
    if (el.html || !Object.hasOwn(cfg.components, el.tag)) return undefined;
    const spec = cfg.components[el.tag];
    if (!spec) return undefined; // "" removes a default
    return typeof spec === 'string' ? { kind: spec, nameProps: ['label'] } : { nameProps: ['label'], ...spec };
  };

  const isIcon = (el: El): boolean => cfg.iconTags.includes(el.tag.toLowerCase()) || (!el.html && Boolean(iconRe?.test(el.tag.split('.').at(-1) ?? '')));

  /**
   * The text a list of JSX children renders. Components whose output is unknown are collected in
   * `assumed`: they are taken to render no text (the usual case is an icon).
   */
  const childrenText = (children: readonly TS.JsxChild[], assumed: string[]): Text => {
    const parts: Text[] = [];
    for (const child of children) {
      if (ts.isJsxText(child)) { if (!child.containsOnlyTriviaWhiteSpaces) parts.push(fixed(child.text)); }
      else if (ts.isJsxExpression(child)) { if (child.expression) parts.push(evalText(child.expression)); }
      else if (ts.isJsxFragment(child)) parts.push(childrenText(child.children, assumed));
      else parts.push(elementText(els[indexOf.get(child) as number], assumed));
    }
    return joinText(parts);
  };

  const elementText = (el: El, assumed: string[]): Text => {
    if (isTrue(el.attrs.get('aria-hidden')) || el.attrs.has('hidden')) return EMPTY;
    if (isIcon(el)) return { ...EMPTY, icons: [iconDescription(el.tag, el.children.length ? childrenText(el.children, []).text : '')] };
    if (el.html === 'img') return attrText(el.attrs.get('alt')) ?? EMPTY;
    if (!el.html && Object.hasOwn(cfg.translateComponents, el.tag)) {
      const key = attrText(el.attrs.get(cfg.translateComponents[el.tag]));
      return key && !key.dynamic && key.text ? translateKey(ctx, key.text) : DYNAMIC_TEXT;
    }
    const kind = specOf(el)?.kind;
    if ((el.html && CONTROL_TAGS.has(el.html)) || kind === 'select' || kind === 'input') return EMPTY;
    const label = attrText(el.attrs.get('aria-label'));
    if (label && (label.text || label.dynamic)) return label;
    if (el.children.length) return childrenText(el.children, assumed);
    if (!el.html) assumed.push(el.tag);
    return EMPTY;
  };

  // ---------- kind, name, test ID ----------

  const kindOf = (el: El): { kind: string; hasRole: boolean; roleUnknown?: boolean } | undefined => {
    const withRole = (kind: string) => ({ kind, hasRole: true });
    const role = (attrText(el.attrs.get('role'))?.text ?? '').trim().toLowerCase();
    if (Object.hasOwn(ROLE_KINDS, role)) return withRole(ROLE_KINDS[role]);
    const clickable = CLICK_PROPS.some((p) => el.attrs.has(p));
    if (!el.html) {
      const spec = specOf(el);
      // a toggle has no element children: <Switch><Route /></Switch> is react-router's, not a control
      const wrapsElements = spec?.kind === 'toggle' && el.children.some((child) => ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child));
      if (spec && !wrapsElements) return withRole(spec.kind);
      if (wrapsElements) return undefined;
      return clickable ? { kind: 'button', hasRole: false, roleUnknown: true } : undefined;
    }
    if (el.html === 'button') return withRole('button');
    if (el.html === 'a' && el.attrs.has('href')) return withRole('link');
    if (el.html === 'input') {
      const type = (attrText(el.attrs.get('type'))?.text ?? '').toLowerCase();
      if (type === 'hidden') return undefined;
      if (type === 'checkbox' || type === 'radio') return withRole(type);
      return withRole(['submit', 'button', 'reset', 'image'].includes(type) ? 'button' : 'input');
    }
    if (el.html === 'select') return withRole('select');
    if (el.html === 'textarea') return withRole('input');
    if (el.html === 'table') return withRole('table');
    if (el.html === 'tr' && el.loops.length) return withRole('row');
    if (el.attrs.has('contentEditable')) return withRole('input');
    // A non-semantic element (div, span, <a> without href...) made clickable: no role for getByRole to find.
    return clickable ? { kind: 'button', hasRole: false } : undefined;
  };

  const byId = new Map<string, El>();
  const labelFor = new Map<string, El>();
  for (const el of els) {
    const id = attrText(el.attrs.get('id'));
    if (id && !id.dynamic && id.text && !byId.has(id.text)) byId.set(id.text, el);
    const target = el.html === 'label' ? attrText(el.attrs.get('htmlFor')) : undefined;
    if (target && !target.dynamic && target.text && !labelFor.has(target.text)) labelFor.set(target.text, el);
  }
  const ancestor = (el: El, test: (a: El) => boolean): El | undefined => {
    for (let p = el.parent; p >= 0; p = els[p].parent) if (test(els[p])) return els[p];
    return undefined;
  };

  const nameOf = (el: El, kind: string): NameResult => {
    const candidates: Array<Text & { title?: boolean }> = [];
    const assumed: string[] = [];
    const push = (t: Text | undefined, title = false) => { if (t) candidates.push({ ...t, title }); };
    const labelled = kind === 'input' || kind === 'select' || el.html === 'input';

    const labelledBy = attrText(el.attrs.get('aria-labelledby'));
    if (labelledBy) {
      const targets = labelledBy.dynamic ? [] : labelledBy.text.split(/\s+/).filter(Boolean).map((id) => byId.get(id));
      if (!targets.length || targets.some((t) => !t)) push(DYNAMIC_TEXT);
      else push(joinText(targets.map((t) => childrenText((t as El).children, assumed))));
    }
    push(attrText(el.attrs.get('aria-label')));
    for (const prop of specOf(el)?.nameProps ?? []) push(attrText(el.attrs.get(prop)));

    // own content names the element, except for labelled controls and tables
    if (!labelled && kind !== 'table' && el.children.length) push(childrenText(el.children, assumed));

    if (labelled) {
      const field = ancestor(el, (a) => Object.hasOwn(cfg.formFields, a.tag));
      if (field) {
        const label = els.find((l) => l.tag === cfg.formFields[field.tag] && ancestor(l, (a) => a === field));
        if (label) push(childrenText(label.children, assumed));
      }
      const id = attrText(el.attrs.get('id'));
      const forLabel = id && !id.dynamic ? labelFor.get(id.text) : undefined;
      if (forLabel) push(childrenText(forLabel.children, assumed));
      const wrap = ancestor(el, (a) => a.html === 'label');
      if (wrap) push(childrenText(wrap.children, assumed)); // controls inside the label contribute no text
      if (kind === 'button') push(attrText(el.attrs.get('value'))); // <input type="submit" value="Save">
    }
    // <FormControlLabel control={<Checkbox />} label="Remember me" />
    if (el.viaProp && el.parent >= 0) push(attrText(els[el.parent].attrs.get('label')));

    // title is the last resort and needs runtime verification
    push(attrText(el.attrs.get('title')), true);

    const chosen = candidates.find((c) => c.text || c.dynamic);
    if (!chosen && el.spread && kind !== 'table') {
      return { label: '', kind: 'dynamic', fromTitle: false, keys: [], missingKeys: [], hint: 'props are spread onto the element, the name may come from them' };
    }
    return {
      label: (chosen?.text ?? '').slice(0, 80),
      kind: !chosen ? 'none' : chosen.dynamic ? 'dynamic' : 'static',
      fromTitle: Boolean(chosen?.title),
      keys: chosen?.keys ?? [],
      missingKeys: chosen?.missingKeys ?? [],
      hint: !chosen && assumed.length ? `${[...new Set(assumed)].map((a) => `<${a} />`).join(', ')} assumed to render no text` : undefined,
      ...iconsOf(chosen, candidates),
    };
  };

  /** "orders-row-" + order.id, `orders-row-${order.id}` or a plain string. */
  const testIdFrom = (expression: TS.Expression): TestId => {
    let text = '';
    let pattern = '';
    const exprs: string[] = [];
    const fixedPart = (part: string) => { text += part; pattern += part; };
    const runtimePart = (e: TS.Expression) => { exprs.push(e.getText(sf)); pattern += `<${e.getText(sf)}>`; };
    const walk = (node: TS.Expression) => {
      const e = unwrap(node);
      if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) fixedPart(e.text);
      else if (ts.isTemplateExpression(e)) {
        fixedPart(e.head.text);
        for (const span of e.templateSpans) { runtimePart(span.expression); fixedPart(span.literal.text); }
      } else if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) { walk(e.left); walk(e.right); }
      else runtimePart(e);
    };
    walk(expression);
    return makeTestId(expression.getText(sf), text, exprs, pattern);
  };

  const testIdOf = (el: El): TestId | undefined => {
    const attr = [...el.attrs].find(([name]) => name.toLowerCase() === cfg.testIdAttribute)?.[1];
    if (!attr) return undefined;
    const init = attr.initializer;
    if (init && ts.isStringLiteral(init)) return makeTestId(init.text, init.text, []);
    if (init && ts.isJsxExpression(init) && init.expression) return testIdFrom(init.expression);
    return makeTestId('', '', []); // attribute without a value
  };

  /** {children} or {props.children} somewhere inside, or props spread onto an element without content of its own. */
  const passesContent = (el: El): boolean => {
    if (el.spread && !el.children.length) return true;
    let found = false;
    const look = (node: TS.Node) => {
      if (ts.isJsxExpression(node) && node.expression && /^(props\.)?children$/.test(node.expression.getText(sf))) found = true;
      else if (!found) ts.forEachChild(node, look);
    };
    el.children.forEach(look);
    return found;
  };
  const namePropOf = (el: El): string | undefined => {
    const init = el.attrs.get('aria-label')?.initializer;
    return init && ts.isJsxExpression(init) && init.expression ? /^(?:props\.)?([A-Za-z_$][\w$]*)$/.exec(init.expression.getText(sf))?.[1] : undefined;
  };
  const staticPropsOf = (el: El): Record<string, string> => {
    const props: Record<string, string> = {};
    for (const [name, attr] of el.attrs) if (attr.initializer && ts.isStringLiteral(attr.initializer)) props[name] = attr.initializer.text;
    return props;
  };

  return els.map((el) => {
    const kind = kindOf(el);
    const testId = testIdOf(el);
    const marker = REVIEWED.exec(text.slice(Math.max(0, el.node.getStart(sf) - 300), el.node.getStart(sf)));
    return {
      line: sf.getLineAndCharacterOfPosition(el.node.getStart(sf)).line + 1,
      tag: el.tag, parent: el.parent, loops: el.loops,
      reviewed: Boolean(marker), reviewedFingerprint: marker?.[1] ?? marker?.[2] ?? marker?.[3],
      kind: kind?.kind, hasRole: kind?.hasRole, roleUnknown: kind?.roleUnknown,
      isTable: el.html === 'table' || specOf(el)?.kind === 'table',
      name: kind || testId ? nameOf(el, kind?.kind ?? 'other') : undefined,
      testId, entityKey: entityKeyOf(el.attrs.keys(), cfg.testIdAttribute),
      placeholder: placeholderOf(attrText(el.attrs.get('placeholder'))),
      staticProps: el.html ? undefined : staticPropsOf(el), usageName: !el.html && !kind ? nameOf(el, 'button') : undefined,
      passesContent: passesContent(el), nameProp: namePropOf(el),
      component: !el.html, owner: el.owner, conditional: el.html ? undefined : isConditional(el.node), branches: branchesOf(el.node), rendersConditionally: rendersConditionally(el.node) || hasViaPropAncestor(el), boundProps: el.html ? undefined : boundPropsOf(el),
    };
  });
}
