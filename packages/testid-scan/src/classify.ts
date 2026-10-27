/**
 * The framework-neutral part: given what an adapter found in one template, decide for each element
 * whether a test can locate it, and which naming rules its test ID breaks.
 */
import { createHash } from 'node:crypto';
import { uses as usesVariable, withoutReceiver } from './components.ts';
import type { Config } from './config.ts';
import { attributeName, nameLocator, quote } from './locator.ts';
import { namingViolations, typeSuffix } from './testid.ts';
import { NO_NAME, exclusive } from './types.ts';
import type { AccessibilityFinding, Candidate, Counts, ElementRecord, Framework, LocatorScope, NameResult, Status } from './types.ts';

/** Tags that are not in the DOM, so an attribute on them does not reach the page. */
const NOT_RENDERED = new Set(['ng-container', 'ng-template', 'template', 'Fragment', 'React.Fragment', '']);
const UNSCOPED_REPEAT = 'repeated element: scope the locator to a unique parent, or give the record a stable key';


/** Kinds a user clicks or types into. One of them inside a button or link is invalid nesting. */
const INTERACTIVE = new Set(['button', 'link', 'input', 'select', 'checkbox', 'radio', 'toggle', 'menu-item', 'tab']);
const NO_NESTING = new Set(['button', 'link', 'menu-item']);
/** Kinds that are announced by their name, so one without a name is an accessibility defect. */
const NAME_REQUIRED = new Set(['button', 'link', 'input', 'select', 'checkbox', 'radio', 'toggle', 'tab', 'menu-item', 'option']);
const OK_STATUSES = new Set<Status>(['OK (test ID)', 'OK (name)', 'OK (reviewed)']);

interface Draft {
  /** Index in the candidate list. */
  i: number;
  c: Candidate;
  kind: string;
  hasRole: boolean;
  name: NameResult;
  repeated: boolean;
  /** The element itself carries a record key. */
  keyed: boolean;
  /** A record key on the element or around it lets a test narrow down to one record first. */
  scopable: boolean;
  /** Tag of an interactive element found inside this button or link. */
  nests?: string;
  record: ElementRecord;
}

export function classify(candidates: Candidate[], file: string, cfg: Config, sharedOnPage?: Map<Candidate, string>, framework?: Framework): ElementRecord[] {
  // A test ID has to change with the innermost loop: one built only from an outer record repeats for every inner item.
  // (when the innermost repetition comes from another template, the "variables" are this component's inputs)
  const uses = (exprs: string[], vars: string[], c?: Candidate) => usesVariable(exprs.map(withoutReceiver), vars, Boolean(c?.loops.at(-1)?.fromUsage));
  const itemVars = (c: Candidate) => c.loops.at(-1)?.itemVars ?? [];
  const indexVars = (c: Candidate) => c.loops.at(-1)?.indexVars ?? [];
  const outerVars = (c: Candidate) => c.loops.slice(0, -1).flatMap((l) => [...l.itemVars, ...l.indexVars]);
  const findAncestor = (index: number, test: (c: Candidate, i: number) => boolean): number => {
    let p = candidates[index].parent;
    while (p >= 0) {
      if (test(candidates[p], p)) return p;
      p = candidates[p].parent;
    }
    return -1;
  };

  // "keyed": the element identifies its record, by a data-<entity>-id attribute or by a test ID built from the record
  const keyed = candidates.map((c) => c.entityKey !== undefined || (c.testId?.kind === 'dynamic' && uses(c.testId.exprs, itemVars(c), c)));

  // In a table the row is often not an ancestor of its cells' content (Angular Material declares cells per column),
  // so a keyed row makes everything in that table scopable.
  const tablesWithKeyedRow = new Map<number, number>(); // table -> its keyed row
  candidates.forEach((c, i) => {
    if (c.kind === 'row' && keyed[i]) {
      const table = findAncestor(i, (a) => Boolean(a.isTable));
      if (table >= 0 && !tablesWithKeyedRow.has(table)) tablesWithKeyedRow.set(table, i);
    }
  });
  const scopable = (i: number) => keyed[i]
    || findAncestor(i, (a, p) => a.loops.length > 0 && keyed[p]) >= 0
    || findAncestor(i, (a, p) => Boolean(a.isTable) && tablesWithKeyedRow.has(p)) >= 0;

  // buttons and links that contain another interactive element
  const nests = new Map<number, string>();
  candidates.forEach((c, i) => {
    if (!c.kind || !INTERACTIVE.has(c.kind)) return;
    const outer = findAncestor(i, (a) => Boolean(a.kind && NO_NESTING.has(a.kind) && a.hasRole !== false));
    if (outer >= 0 && !nests.has(outer)) nests.set(outer, c.tag);
  });

  const drafts: Draft[] = [];
  candidates.forEach((c, i) => {
    const repeated = c.loops.length > 0;
    // Any element carrying a test ID is recorded, so naming rules are checked on containers too.
    const kind = c.kind ?? (c.testId ? 'other' : undefined);
    if (!kind || c.viaUsages) return;
    if (kind === 'row' && !repeated && !c.testId) return; // a single fixed row (a header row) is not a record
    const name = c.name ?? NO_NAME;
    drafts.push({
      i, c, kind, hasRole: c.hasRole ?? true, name, repeated, keyed: Boolean(keyed[i]), scopable: repeated && scopable(i), nests: nests.get(i),
      record: {
        file, line: c.line, tag: c.tag, kind,
        label: name.label, nameKind: name.kind, translationKeys: name.keys, repeated, conditional: Boolean(c.rendersConditionally),
        testId: c.testId?.raw, testIdKind: c.testId?.kind, status: 'Manual review', violations: [],
        locatorScope: 'unknown', accessibilityFindings: [],
      },
    });
  });

  // names and fixed IDs that occur more than once in this template
  const nameKey = (d: Draft) => `${d.repeated ? 'loop' : 'once'}|${d.kind}|${d.name.label.toLowerCase()}`;
  // Elements in different arms of one if/else or switch are never on the page together: not duplicates of each other.
  const group = (map: Map<string, Draft[]>, key: string, d: Draft) => map.set(key, [...(map.get(key) ?? []), d]);
  const clashes = (map: Map<string, Draft[]>, key: string, d: Draft) => (map.get(key) ?? []).some((o) => o !== d && !exclusive(o.c.branches, d.c.branches));
  const inOtherArm = (map: Map<string, Draft[]>, key: string, d: Draft) => (map.get(key) ?? []).some((o) => o !== d && exclusive(o.c.branches, d.c.branches));
  const nameGroups = new Map<string, Draft[]>();
  const idGroups = new Map<string, Draft[]>();
  for (const d of drafts) {
    if (d.hasRole && d.name.kind === 'static') group(nameGroups, nameKey(d), d);
    const tid = d.c.testId;
    if (tid?.kind === 'static' && tid.raw) group(idGroups, tid.raw, d);
  }
  // A form field without a label can still be found by its placeholder (Playwright also uses it as the name).
  // Only for text fields: a select component draws its placeholder as ordinary text, not as an attribute.
  const placeholderText = (d: Draft) => (d.name.kind === 'none' && d.kind === 'input' ? d.c.placeholder?.text : undefined);
  const placeholderKey = (d: Draft) => `${d.repeated ? 'loop' : 'once'}|${(placeholderText(d) ?? '').toLowerCase()}`;
  const placeholderGroups = new Map<string, Draft[]>();
  for (const d of drafts) if (placeholderText(d)) group(placeholderGroups, placeholderKey(d), d);
  const kindSuffixes = new Set(Object.values(cfg.suffixesByKind).flat());
  const tableCount = drafts.filter((d) => d.kind === 'table').length;

  const violationsOf = (d: Draft): string[] => {
    const tid = d.c.testId;
    if (!tid) return [];
    if (tid.kind === 'static' && !tid.raw.trim()) return ['empty test ID'];
    if (tid.kind === 'opaque') return [];
    const v = namingViolations(tid.skeleton, cfg);
    const suffix = typeSuffix(tid.skeleton, cfg.suffixes);
    const fitting = cfg.suffixesByKind[d.kind];
    // only a suffix that names another kind is a mismatch; a project's own suffixes ("-btn") are left alone
    if (cfg.requireTypeSuffix && cfg.checkSuffixMatchesKind && d.hasRole && !d.c.roleUnknown && fitting && suffix && !fitting.includes(suffix) && kindSuffixes.has(suffix)) {
      v.push(`suffix "-${suffix}" does not fit a ${d.kind} (use ${fitting.map((s) => `-${s}`).join(', ')})`);
    }
    if (tid.kind === 'static') {
      if (clashes(idGroups, tid.raw, d)) v.push('duplicate in template');
      if (d.repeated && !d.scopable) v.push('same test ID on every repeated element (build the ID from the record, or add data-<entity>-id to it or its row)');
    }
    return v;
  };

  const withHint = (reason: string, name: NameResult) => (name.hint ? `${reason} (${name.hint})` : reason);

  const statusOf = (d: Draft): [Status, string?] => {
    const { name } = d;
    const tid = d.c.testId;
    const exprs = tid?.exprs ?? [];
    if (tid?.kind === 'opaque') return ['Manual review', 'fully dynamic test ID: naming and uniqueness cannot be checked statically'];
    if (tid?.kind === 'dynamic') {
      if (!d.repeated) return ['Manual review', 'dynamic test ID: verify its runtime value'];
      if (uses(exprs, itemVars(d.c), d.c)) return ['OK (test ID)', `built from ${exprs.join(', ')}: unique as long as that value is unique`];
      if (uses(exprs, indexVars(d.c), d.c)) return ['Manual review', 'index-based test ID: it changes when the order of the list changes'];
      if (uses(exprs, outerVars(d.c))) return ['Manual review', 'test ID is built from the outer loop only: it repeats for every item of the inner loop'];
      return ['Manual review', 'dynamic test ID does not use the loop record: it probably repeats'];
    }
    if (tid && tid.raw.trim()) return d.repeated && d.scopable ? ['OK (test ID)', 'repeated: narrow down to its record first, then use the test ID'] : ['OK (test ID)'];
    if (cfg.strict) return ['Needs test ID', 'strict: every element needs a test ID'];
    if (d.c.roleUnknown) return ['Manual review', `<${d.c.tag}> is a component with a click handler: the scanner cannot see what it renders (map it under "components" in the config, or give it a test ID)`];
    if (!d.hasRole) return ['Needs test ID', `clickable <${d.c.tag}> has no role: use <button> / <a href>, or add role + tabindex, or add a test ID`];
    if (d.kind === 'spinner' && name.kind === 'none') return ['Needs test ID', 'progress indicator without a name'];
    if (d.kind === 'row') {
      return d.keyed ? ['OK (test ID)', 'located by its record key attribute'] : ['Needs test ID', 'repeated record (add data-<entity>-id or a test ID built from the record)'];
    }
    if (name.kind === 'none') {
      if (d.kind === 'table') return tableCount <= 1 ? ['OK (name)', 'single table: getByRole(\'table\')'] : ['Needs test ID', 'more than one table in the template (add aria-label or a test ID)'];
      if (d.kind === 'message') return ['Needs test ID', 'no role or name'];
      if (d.kind === 'select' && d.c.placeholder) return ['Manual review', 'no label, only a placeholder: check in the browser how this select is announced'];
      if (d.kind === 'input' && d.c.placeholder) {
        const text = placeholderText(d);
        if (!text) return ['Manual review', 'no label, and the placeholder is set at runtime: verify its value'];
        const twice = clashes(placeholderGroups, placeholderKey(d), d);
        if (d.repeated) {
          if (twice) return ['Needs test ID', `placeholder "${text}" appears more than once in the repeated block`];
          if (d.scopable) return ['OK (name)', 'found by its placeholder (it has no label); repeated: narrow down to its record first'];
          return ['Manual review', UNSCOPED_REPEAT];
        }
        if (twice) return ['Needs test ID', `placeholder "${text}" appears more than once`];
        return ['OK (name)', 'found by its placeholder; it has no label (see Accessibility findings)'];
      }
      return ['Missing name', withHint('no accessible name (add visible text, a label or aria-label)', name)];
    }
    if (name.kind === 'dynamic') return ['Manual review', withHint('dynamic accessible name: verify value and uniqueness at runtime', name)];
    if (name.missingKeys.length) return ['Manual review', `translation key not found in the i18n file: ${name.missingKeys.join(', ')}`];
    if (name.fromTitle) return ['Manual review', 'title-based name: verify the computed accessible name'];
    if (d.nests) return ['Manual review', `contains another interactive element (<${d.nests}>): invalid nesting, its text becomes part of this name and clicks are ambiguous`];
    const duplicate = clashes(nameGroups, nameKey(d), d);
    if (d.repeated) {
      if (duplicate) return ['Needs test ID', `name "${name.label}" appears more than once in the repeated block`];
      if (d.scopable) return ['OK (name)', 'repeated: narrow down to its record first, then use the role and name'];
      return ['Manual review', UNSCOPED_REPEAT];
    }
    if (/^skip (to|forwards|backwards)\b/i.test(name.label)) return ['OK (name)', 'skip link'];
    if (duplicate) return ['Needs test ID', `name "${name.label}" appears more than once`];
    const elsewhere = sharedOnPage?.get(d.c);
    if (elsewhere) return ['Manual review', `name "${name.label}" is also used in ${elsewhere}, which can be on the page at the same time: narrow the locator to a part of the page, or add a test ID`];
    if (inOtherArm(nameGroups, nameKey(d), d)) return ['OK (name)', 'the same name is in another branch of an if/else or switch: only one of them is on the page at a time'];
    return ['OK (name)'];
  };

  // ---------- accessibility findings: what the source shows, whatever the locator status is ----------

  const findingsOf = (d: Draft): AccessibilityFinding[] => {
    const findings: AccessibilityFinding[] = [];
    const { name } = d;
    if (!d.hasRole && !d.c.roleUnknown) {
      findings.push({ rule: 'no-role', certainty: 'confirmed', message: `clickable <${d.c.tag}> has no role: assistive technology does not announce it as a control` });
    } else if (NAME_REQUIRED.has(d.kind) && !d.c.roleUnknown) {
      if (name.kind === 'none' && d.c.placeholder) {
        findings.push({ rule: 'placeholder-only', certainty: 'confirmed', message: 'has a placeholder but no label: the placeholder disappears on input and is not a substitute for a label' });
      } else if (name.kind === 'none') {
        // an unknown child component may render text after all
        findings.push({ rule: 'missing-name', certainty: name.hint ? 'needs-review' : 'confirmed', message: withHint('no accessible name', name) });
      } else if (name.fromTitle) {
        findings.push({ rule: 'title-only', certainty: 'needs-review', message: 'named only by its title attribute' });
      }
    }
    if (d.nests) findings.push({ rule: 'nested-interactive', certainty: 'confirmed', message: `contains another interactive element (<${d.nests}>)` });
    return findings;
  };

  // ---------- recommended locator and its scope ----------

  /** The record an element sits in (itself, an enclosing keyed element, or the keyed row of its table), or -1. */
  const recordOf = (i: number): number => {
    if (keyed[i] && candidates[i].loops.length) return i;
    const around = findAncestor(i, (a, p) => a.loops.length > 0 && Boolean(keyed[p]));
    if (around >= 0) return around;
    const table = findAncestor(i, (a, p) => Boolean(a.isTable) && tablesWithKeyedRow.has(p));
    return table >= 0 ? tablesWithKeyedRow.get(table) as number : -1;
  };
  /**
   * The element a record key would go on so a test can narrow down to one record: the repeated row of the table the
   * element is in (Angular Material declares cells per column, so a cell is not the record), else the element that
   * starts the innermost loop. -1 when that is not in this template or not in the DOM.
   */
  const recordHost = (i: number): number => {
    const c = candidates[i];
    const loop = c.loops.at(-1);
    if (!loop || loop.fromUsage) return -1;
    const table = findAncestor(i, (a) => Boolean(a.isTable));
    if (table >= 0) {
      const row = candidates.findIndex((r, j) => r.kind === 'row' && r.loops.length > 0 && findAncestor(j, (a) => Boolean(a.isTable)) === table);
      if (row >= 0) return row;
    }
    let host = i;
    while (candidates[host].parent >= 0 && candidates[candidates[host].parent].loops.length === c.loops.length) host = candidates[host].parent;
    return NOT_RENDERED.has(candidates[host].tag) ? -1 : host;
  };
  /** Where and how to add the record key, e.g. `[attr.data-<entity>-id]="o.id" on the <tr> at line 5`. */
  const recordKeyHint = (i: number): string | undefined => {
    const host = recordHost(i);
    if (host < 0) return undefined;
    const value = `${candidates[host].loops.at(-1)?.record ?? '<record>'}.id`;
    const attribute = framework === 'vue' ? `:data-<entity>-id="${value}"`
      : framework === 'react' ? `data-<entity>-id={${value}}`
      : `[attr.data-<entity>-id]="${value}"`;
    return `e.g. ${attribute} on the <${candidates[host].tag}> at line ${candidates[host].line}`;
  };
  const keyedByTestId = (c: Candidate) => c.testId?.kind === 'dynamic' && uses(c.testId.exprs, itemVars(c), c);
  const recordLocator = (i: number): string => {
    const c = candidates[i];
    if (c.testId && keyedByTestId(c)) return `getByTestId(${quote(c.testId.pattern)})`;
    return `locator(${quote(`[${attributeName(c.entityKey ?? '')}="<value>"]`)})`;
  };

  const locate = (d: Draft): { locator?: string; note?: string; scope: LocatorScope } => {
    const { c, name, record } = d;
    const tid = c.testId;
    const notes: string[] = [];
    let own: string | undefined;
    if (tid?.kind === 'opaque') own = undefined;
    else if (tid && tid.raw.trim()) own = `getByTestId(${quote(tid.pattern)})`;
    else if (!d.hasRole || c.roleUnknown) own = undefined;
    else if (name.kind === 'static' && name.label) {
      own = nameLocator(d.kind, c.tag, name.label);
      if (own && name.keys.length && !cfg.i18nFile) notes.push('the name is a translation key: use the translated text');
    } else if (name.kind === 'none' && d.kind === 'table' && record.status === 'OK (name)') own = 'getByRole(\'table\')';
    else if (name.kind === 'none' && c.placeholder?.text && d.kind === 'input') {
      own = `getByPlaceholder(${quote(c.placeholder.text)}, { exact: true })`;
      notes.push('located by its placeholder; the field has no label');
      if (c.placeholder.translationKey) notes.push('the placeholder is a translation key: use the translated text');
    }
    // a name that is not unique is not a locator
    if (own && !tid && (record.status === 'Needs test ID')) own = undefined;

    const record_ = d.repeated ? recordOf(d.i) : -1;
    const selfKeyed = record_ === d.i;
    let locator: string | undefined;
    if (selfKeyed) locator = `page.${keyedByTestId(c) ? own : recordLocator(d.i)}`;
    else if (own) locator = record_ >= 0 ? `page.${recordLocator(record_)}.${own}` : `page.${own}`;
    if (!locator) return { scope: 'unknown' };

    if (locator.includes('<')) notes.push('replace <...> with the value of the record you want');
    if (d.repeated && record_ < 0) notes.push('repeated: on its own this matches every record');
    if (record.status === 'Fix test ID') notes.push('fix the test ID first');
    if (record.status === 'Manual review' || record.status === 'OK (reviewed)') notes.push('review required: see the reason');

    // a badly named ID still finds its element; a duplicated one does not single it out
    const ambiguousId = record.violations.some((v) => v.startsWith('duplicate') || v.startsWith('same test ID') || v === 'empty test ID');
    let scope: LocatorScope = 'unknown';
    if (d.repeated) scope = selfKeyed ? 'page-candidate' : record_ >= 0 ? 'record-scoped' : 'unknown';
    else if (OK_STATUSES.has(record.status) || (record.status === 'Fix test ID' && !ambiguousId)) scope = 'page-candidate';
    return { locator, note: notes.length ? notes.join('; ') : undefined, scope };
  };

  for (const d of drafts) {
    const others = [
      ...(d.hasRole && d.name.kind === 'static' ? nameGroups.get(nameKey(d)) ?? [] : []),
      ...(d.c.testId?.kind === 'static' && d.c.testId.raw ? idGroups.get(d.c.testId.raw) ?? [] : []),
    ].filter((o) => o !== d && exclusive(o.c.branches, d.c.branches));
    if (others.length) d.record.alternatives = [...new Set(others.map((o) => o.c.line))].sort((a, b) => a - b);
    d.record.violations = violationsOf(d);
    [d.record.status, d.record.reason] = statusOf(d);
    // Present is not the same as usable: a duplicate or badly named test ID is work to do, not a result.
    if (d.record.status === 'OK (test ID)' && d.record.violations.length) {
      d.record.status = 'Fix test ID';
      d.record.reason = d.record.violations.join('; ');
    }
    // getByRole matches a name as a case-insensitive substring unless told otherwise, so "Save" also finds "Save draft".
    if (d.record.status === 'OK (name)' && d.name.kind === 'static' && d.name.label) {
      const mine = d.name.label.toLowerCase();
      const longer = drafts.find((o) => o !== d && o.hasRole && o.kind === d.kind && o.repeated === d.repeated
        && o.name.kind === 'static' && o.name.label.toLowerCase() !== mine && o.name.label.toLowerCase().includes(mine));
      if (longer) {
        const note = `use { name: '${d.name.label}', exact: true }: the name is also part of "${longer.name.label}"`;
        d.record.reason = d.record.reason ? `${d.record.reason}; ${note}` : note;
      }
    }
    const ownReason = d.record.reason ?? '';
    // Point at where the record key would go. Added after the fingerprint text, which stays as it was, so reviewed
    // markers stay valid and moving code (the line number) does not invalidate them.
    if (ownReason === UNSCOPED_REPEAT) {
      const hint = recordKeyHint(d.i);
      if (hint) d.record.reason = `${ownReason} (${hint})`;
    }
    // say where the repetition comes from when it is not visible in this file
    if (d.c.repeatedBy && !OK_STATUSES.has(d.record.status) && d.record.status !== 'Missing name') d.record.reason = `${d.record.reason} [${d.c.repeatedBy}]`;
    d.record.accessibilityFindings = findingsOf(d);
    if (d.record.status !== 'Manual review') continue;
    // What a reviewer looked at. The line number is left out, so moving the element does not change it.
    const r = d.record;
    const fingerprint = createHash('sha1').update([r.tag, r.kind, r.label, r.nameKind, r.testId ?? '', ownReason].join('|')).digest('hex').slice(0, 8);
    r.fingerprint = fingerprint;
    // A reviewed marker acknowledges a Manual review item. It never hides a to-do or a violation.
    if (!d.c.reviewed) continue;
    if (d.c.reviewedFingerprint && d.c.reviewedFingerprint !== fingerprint) {
      r.reason = `reviewed marker is out of date (the element changed since ${d.c.reviewedFingerprint}; review again, then write ${fingerprint}): ${r.reason}`;
      continue;
    }
    r.status = 'OK (reviewed)';
    r.reason = `acknowledged by a reviewed marker${d.c.reviewedFingerprint ? '' : ` without a fingerprint (add ${fingerprint} to detect later changes)`}, not verified by the scanner: ${r.reason}`;
  }
  // once every status is final
  for (const d of drafts) {
    const found = locate(d);
    if (d.record.status === 'Needs test ID' && !d.repeated && !d.c.testId && d.name.kind === 'static') {
      const slug = d.name.label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').slice(0, 4).join('-');
      const suffix = (cfg.suffixesByKind[d.kind] ?? [d.kind])[0];
      if (slug) d.record.suggestedTestId = [cfg.prefixes[0], slug === suffix ? '' : slug, suffix].filter(Boolean).join('-');
    }
    if (found.locator) d.record.recommendedLocator = found.locator;
    if (found.note) d.record.locatorNote = found.note;
    d.record.locatorScope = found.scope;
  }
  // the same suggestion twice would only create a duplicate ID: those need a person to tell them apart
  const suggested = new Map<string, number>();
  for (const d of drafts) if (d.record.suggestedTestId) suggested.set(d.record.suggestedTestId, (suggested.get(d.record.suggestedTestId) ?? 0) + 1);
  for (const d of drafts) if (d.record.suggestedTestId && ((suggested.get(d.record.suggestedTestId) ?? 0) > 1 || idGroups.has(d.record.suggestedTestId))) delete d.record.suggestedTestId;
  return drafts.map((d) => d.record);
}

export function countElements(elements: ElementRecord[]): Counts {
  const c: Counts = { elements: 0, okId: 0, okName: 0, reviewed: 0, needsId: 0, missingName: 0, fixId: 0, todo: 0, violations: 0, review: 0, a11y: 0 };
  for (const e of elements) {
    c.elements += 1;
    if (e.status === 'OK (test ID)') c.okId += 1;
    if (e.status === 'OK (name)') c.okName += 1;
    if (e.status === 'OK (reviewed)') c.reviewed += 1;
    if (e.status === 'Needs test ID') c.needsId += 1;
    if (e.status === 'Missing name') c.missingName += 1;
    if (e.status === 'Fix test ID') c.fixId += 1;
    if (e.status === 'Manual review') c.review += 1;
    if (e.violations.length) c.violations += 1;
    if (e.accessibilityFindings.some((f) => f.certainty === 'confirmed')) c.a11y += 1;
  }
  c.todo = c.needsId + c.missingName + c.fixId;
  return c;
}
