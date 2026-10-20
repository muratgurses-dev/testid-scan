/**
 * Looks across files: a component that another template renders in a loop, or more than once, repeats
 * everything inside it. Each file on its own cannot show that, so it is worked out once all files are read.
 */
import type { Candidate, Framework, NameResult } from './types.ts';

/** One template: a .vue file, an Angular template, or the JSX of a React file. */
export interface Unit {
  file: string;
  framework: Framework;
  candidates: Candidate[];
  /** Names under which other templates use this one (Vue: the file name; Angular: its selectors). React uses `Candidate.owner`. */
  owners: string[];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Does any expression use one of these variables (as a variable, not as a property name)? */
export function uses(exprs: string[], vars: string[], ignoreCase = false): boolean {
  return vars.some((v) => exprs.some((e) => new RegExp(`(^|[^\\w$.])${escapeRegExp(v)}(?![\\w$])`, ignoreCase ? 'i' : '').test(e)));
}

/** props.order.id and this.order.id read the same input as order.id */
export const withoutReceiver = (expr: string) => expr.replace(/\b(?:props|this)\s*\.\s*/g, '');

/** One spelling per component name: Vue treats my-row and MyRow alike, Angular selectors are lowercase, JSX is exact. */
const KEY: Record<Framework, (name: string) => string> = {
  angular: (name) => name.toLowerCase(),
  vue: (name) => name.toLowerCase().replace(/-/g, ''),
  react: (name) => name.split('.').at(-1) ?? name,
};

interface Usage { key: string; unit: Unit; c: Candidate; owners: string[] }

/** Kinds a project typically wraps in a component of its own: <AppLink>, <MyButton>. */
const WRAPPABLE = new Set(['button', 'link', 'menu-item', 'tab']);

/**
 * Wrapper components: a component that renders exactly one button or link and shows inside it whatever it is
 * given (<slot>, <ng-content>, {children}), or names it from a prop. Each place it is used is then that
 * button or link, named by what the usage passes in. Without this, a project that draws all its links
 * through its own <AppLink> would have none of them listed.
 */
function applyWrappers(units: Unit[], usages: Usage[], ownersOf: (unit: Unit, c: Candidate) => string[]): void {
  const prop = (unit: Unit, name: string) => (unit.framework === 'react' ? name : name.toLowerCase().replace(/-/g, ''));
  const resolved = new Set<string>();
  for (let changed = true, round = 0; changed && round < 4; round += 1) {
    changed = false;
    // the single interactive element of each component, if it has exactly one
    const inner = new Map<string, { unit: Unit; c: Candidate } | null>();
    for (const unit of units) {
      unit.candidates.forEach((c) => {
        if (!c.kind || c.kind === 'spinner') return;
        const insideAnother = (() => { for (let p = c.parent; p >= 0; p = unit.candidates[p].parent) if (unit.candidates[p].kind && WRAPPABLE.has(unit.candidates[p].kind as string)) return true; return false; })();
        if (insideAnother) return;
        for (const owner of ownersOf(unit, c)) {
          const fits = WRAPPABLE.has(c.kind as string) && c.hasRole !== false && !c.loops.length && (c.passesContent || c.nameProp);
          inner.set(owner, inner.has(owner) || !fits ? null : { unit, c });
        }
      });
    }
    for (const usage of usages) {
      const found = inner.get(usage.key);
      if (!found || (usage.c.kind && !usage.c.roleUnknown) || resolved.has(`${usage.unit.file}|${usage.c.line}|${usage.c.tag}|${usage.unit.candidates.indexOf(usage.c)}`)) continue;
      const w = found.c;
      const via = `rendered by <${usage.c.tag}> in ${found.unit.file}`;
      let name: NameResult | undefined;
      // Vue hands attributes written on the component down to its root element, where they win over its own
      const ownLabel = usage.unit.framework === 'vue' && [...Object.keys(usage.c.staticProps ?? {}), ...Object.keys(usage.c.boundProps ?? {})].includes('arialabel');
      if (ownLabel) name = usage.c.usageName;
      else if (w.nameProp) {
        const key = prop(usage.unit, w.nameProp);
        const fixed = Object.entries(usage.c.staticProps ?? {}).find(([n]) => prop(usage.unit, n) === key);
        const bound = Object.keys(usage.c.boundProps ?? {}).some((n) => prop(usage.unit, n) === key);
        if (fixed && fixed[1].trim()) name = { label: fixed[1].trim().slice(0, 80), kind: 'static', fromTitle: false, keys: [], missingKeys: [] };
        else if (bound) name = { label: '', kind: 'dynamic', fromTitle: false, keys: [], missingKeys: [] };
      }
      if (!name && w.passesContent) name = usage.c.usageName;
      // fixed text of its own next to the passed content is part of the name too: only the browser shows the whole
      if (name && name.kind === 'static' && !w.nameProp && w.name?.kind === 'static' && w.name.label) name = { ...name, kind: 'dynamic' };
      name ??= { label: '', kind: 'none', fromTitle: false, keys: [], missingKeys: [] };
      usage.c.kind = w.kind;
      usage.c.hasRole = true;
      usage.c.wrapped = true;
      usage.c.roleUnknown = false;
      usage.c.name = { ...name, hint: name.hint ? `${name.hint}; ${via}` : via };
      if (!w.testId) w.viaUsages = true; // listed where it is used instead
      resolved.add(`${usage.unit.file}|${usage.c.line}|${usage.c.tag}|${usage.unit.candidates.indexOf(usage.c)}`);
      changed = true;
    }
  }
}

interface Repeat { itemVars: Set<string>; indexVars: Set<string>; reason: string }

export function applyComponentUsage(units: Unit[]): void {
  const id = (unit: Unit, name: string) => `${unit.framework}|${KEY[unit.framework](name)}`;
  const ownersOf = (unit: Unit, c: Candidate) => (unit.framework === 'react' ? (c.owner ? [id(unit, c.owner)] : []) : unit.owners.map((o) => id(unit, o)));

  // where each component is defined; a name defined in two files cannot be told apart, so it is left alone
  const definedIn = new Map<string, Set<string>>();
  const define = (key: string, file: string) => { if (!definedIn.has(key)) definedIn.set(key, new Set()); (definedIn.get(key) as Set<string>).add(file); };
  for (const unit of units) {
    for (const owner of unit.owners) define(id(unit, owner), unit.file);
    for (const c of unit.candidates) if (unit.framework === 'react' && c.owner) define(id(unit, c.owner), unit.file);
  }
  const known = (key: string) => definedIn.get(key)?.size === 1;

  const usages: Usage[] = [];
  for (const unit of units) {
    for (const c of unit.candidates) {
      if (!c.component) continue;
      const key = id(unit, c.tag);
      const owners = ownersOf(unit, c);
      if (known(key) && !owners.includes(key)) usages.push({ key, unit, c, owners });
    }
  }

  applyWrappers(units, usages, ownersOf);

  const repeats = new Map<string, Repeat>();
  const mark = (key: string, reason: string): boolean => {
    if (repeats.has(key)) return false;
    repeats.set(key, { itemVars: new Set(), indexVars: new Set(), reason });
    return true;
  };

  // a component that appears twice in one parent is rendered twice
  const perParent = new Map<string, Usage[]>();
  for (const usage of usages) {
    if (usage.c.conditional) continue; // alternatives (routes, if/else branches) are not two instances
    const where = `${usage.unit.file}|${usage.owners.join(',')}|${usage.key}`;
    perParent.set(where, [...(perParent.get(where) ?? []), usage]);
  }
  for (const group of perParent.values()) {
    if (group.length > 1) mark(group[0].key, `<${group[0].c.tag}> is used ${group.length} times in ${group[0].unit.file}`);
  }

  // a component in a loop, or inside a component that is itself repeated; repeat until nothing changes
  for (let changed = true, round = 0; changed && round < 12; round += 1) {
    changed = false;
    for (const usage of usages) {
      const outer = usage.owners.map((o) => repeats.get(o)).find(Boolean);
      const ownLoop = usage.c.loops.at(-1);
      if (!outer && !ownLoop) continue;
      const reason = ownLoop
        ? `<${usage.c.tag}> is rendered in a loop in ${usage.unit.file}:${usage.c.line}`
        : `<${usage.c.tag}> is used in ${usage.unit.file}:${usage.c.line}, inside a component that is rendered more than once`;
      if (mark(usage.key, reason)) changed = true;
      const repeat = repeats.get(usage.key) as Repeat;
      // which inputs carry the record: <order-row [order]="o"> inside *ngFor="let o of orders"
      const items = ownLoop ? ownLoop.itemVars : [...(outer as Repeat).itemVars];
      const indexes = ownLoop ? ownLoop.indexVars : [...(outer as Repeat).indexVars];
      for (const [prop, expr] of Object.entries(usage.c.boundProps ?? {})) {
        const value = [withoutReceiver(expr)];
        if (uses(value, items, !ownLoop) && !repeat.itemVars.has(prop)) { repeat.itemVars.add(prop); changed = true; }
        else if (!repeat.itemVars.has(prop) && uses(value, indexes, !ownLoop) && !repeat.indexVars.has(prop)) { repeat.indexVars.add(prop); changed = true; }
      }
    }
  }

  for (const unit of units) {
    for (const c of unit.candidates) {
      const repeat = ownersOf(unit, c).map((o) => repeats.get(o)).find(Boolean);
      if (!repeat) continue;
      c.loops = [{ itemVars: [...repeat.itemVars], indexVars: [...repeat.indexVars], fromUsage: true }, ...c.loops];
      c.repeatedBy = repeat.reason;
    }
  }
}

/** Components that show the routed page inside them: what stands next to one of these is on every page. */
const OUTLETS = new Set(['routerview', 'routeroutlet', 'outlet', 'nuxtpage']);

/**
 * Names that are not unique on the page although they are unique in their file: the same role and name in
 * another component that is drawn at the same time. Two components are taken to be on the page together when
 * one contains the other, when a third contains both, or when one of them belongs to the frame around the
 * routed pages (the component with the router outlet and what it always shows).
 * Returns, for each element concerned, where the other one is.
 */
export function namesSharedOnPage(units: Unit[]): Map<Candidate, string> {
  const id = (unit: Unit, name: string) => `${unit.framework}|${KEY[unit.framework](name)}`;
  // a name defined in two files (index.vue, a second Row) cannot be told apart: such a file stands for itself
  const files = new Map<string, Set<string>>();
  const ownerKeys = (unit: Unit, c: Candidate) => (unit.framework === 'react' ? (c.owner ? [id(unit, c.owner)] : []) : unit.owners.map((o) => id(unit, o)));
  for (const unit of units) for (const c of unit.candidates) for (const key of ownerKeys(unit, c)) files.set(key, (files.get(key) ?? new Set()).add(unit.file));
  const keysOf = (unit: Unit, c: Candidate): string[] => {
    const keys = ownerKeys(unit, c).filter((key) => files.get(key)?.size === 1);
    return keys.length ? keys : [`${unit.framework}|file:${unit.file}`];
  };
  const members = new Map<string, Array<{ unit: Unit; c: Candidate }>>();
  for (const unit of units) for (const c of unit.candidates) for (const key of keysOf(unit, c)) members.set(key, [...(members.get(key) ?? []), { unit, c }]);

  // what each component always draws: its children that are not one of several alternatives
  const children = new Map<string, Set<string>>();
  const frames = new Set<string>();
  for (const [key, list] of members) {
    for (const { unit, c } of list) {
      if (!c.component || c.conditional) continue;
      // a tag the configuration knows (el-button) is a library component, even if a file of the project has the same name
      if (c.kind && !c.wrapped) continue;
      if (OUTLETS.has(c.tag.toLowerCase().replace(/-/g, ''))) frames.add(key);
      const child = id(unit, c.tag);
      if (files.get(child)?.size === 1 && child !== key) children.set(key, (children.get(key) ?? new Set()).add(child));
    }
  }
  const inside = new Map<string, Set<string>>();
  const insideOf = (key: string): Set<string> => {
    const known = inside.get(key);
    if (known) return known;
    const all = new Set([key]);
    inside.set(key, all); // set first: a component that contains itself must not loop
    for (const child of children.get(key) ?? []) for (const k of insideOf(child)) all.add(k);
    return all;
  };
  const together = new Map<string, Set<string>>();
  const everyPage = new Set<string>();
  for (const key of members.keys()) {
    const all = insideOf(key);
    if (frames.has(key)) for (const k of all) everyPage.add(k);
    for (const k of all) together.set(k, new Set([...(together.get(k) ?? []), ...all]));
  }

  const named = (c: Candidate) => Boolean(c.kind && c.hasRole !== false && !c.roleUnknown && !c.viaUsages && c.name?.kind === 'static' && c.name.label);
  const nameKey = (c: Candidate) => `${c.kind}|${(c.name as NameResult).label.toLowerCase()}`;
  const names = new Map<string, Map<string, { unit: Unit; c: Candidate }>>();
  for (const [key, list] of members) {
    const map = new Map<string, { unit: Unit; c: Candidate }>();
    for (const m of list) if (named(m.c) && !map.has(nameKey(m.c))) map.set(nameKey(m.c), m);
    names.set(key, map);
  }
  const framework = (key: string) => key.split('|')[0];
  const result = new Map<Candidate, string>();
  for (const [key, list] of members) {
    const others = everyPage.has(key)
      ? [...members.keys()].filter((k) => framework(k) === framework(key))
      : [...new Set([...(together.get(key) ?? []), ...[...everyPage].filter((k) => framework(k) === framework(key))])];
    for (const { unit, c } of list) {
      if (!named(c) || c.loops.length || result.has(c)) continue;
      for (const other of others) {
        if (other === key) continue;
        const hit = names.get(other)?.get(nameKey(c));
        if (hit && hit.unit.file !== unit.file) { result.set(c, `${hit.unit.file}:${hit.c.line}`); break; }
      }
    }
  }
  return result;
}
