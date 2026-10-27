/** Types shared by the framework-neutral core and the framework adapters. */
import type { TestId } from './testid.ts';

export type Framework = 'angular' | 'react' | 'vue';

/** One repetition around an element: the names that stand for the record and for its position. */
export interface Loop {
  itemVars: string[];
  indexVars: string[];
  /** The one name the record is bound to (`let o of`, `(o) =>`, `o in items`); absent when it is destructured. */
  record?: string;
  /** The repetition comes from how another template uses this component; the variables are its inputs. */
  fromUsage?: boolean;
}

/**
 * One arm of an if/else chain or a switch around an element. Two elements in different arms of the same
 * group are never on the page together, so the same name in both is not a duplicate.
 */
export interface Branch {
  /** Identifies the if/else chain or switch within its template. */
  group: string;
  /** Which arm of it the element is in. */
  arm: number;
}

/** True when `a` and `b` sit in different arms of the same if/else chain or switch. */
export function exclusive(a: Branch[] | undefined, b: Branch[] | undefined): boolean {
  if (!a?.length || !b?.length) return false;
  return a.some((x) => b.some((y) => x.group === y.group && x.arm !== y.arm));
}

export type NameKind = 'static' | 'dynamic' | 'none';

/** Static approximation of an element's accessible name (what getByRole(..., { name }) matches). */
export interface NameResult {
  label: string;
  kind: NameKind;
  /** The name comes from the title attribute only. */
  fromTitle: boolean;
  /** Translation keys the name is built from. */
  keys: string[];
  /** Keys that are not in the i18n file (only filled when one was given). */
  missingKeys: string[];
  /** Extra explanation for the report, e.g. an assumption the adapter made. */
  hint?: string;
  /** No name was found, and the content holds only icons, which assistive technology does not read: `<mat-icon> "close"`. */
  icons?: string[];
}

export const NO_NAME: NameResult = { label: '', kind: 'none', fromTitle: false, keys: [], missingKeys: [] };

/**
 * What an adapter reports about one element of a template. Adapters list every element (not only the
 * interactive ones) so the core can look at what surrounds an element.
 */
export interface Candidate {
  /** 1-based line in the file. */
  line: number;
  tag: string;
  /** Index of the parent in the same list, -1 at the top. */
  parent: number;
  /** Every loop the element is rendered inside (outermost first). Empty = rendered once. */
  loops: Loop[];
  /** A `testid-scan: reviewed` comment stands directly before the element. */
  reviewed: boolean;
  /** The fingerprint written in that comment, if any. */
  reviewedFingerprint?: string;
  /** button, link, input, ... Undefined = not interactive (recorded only if it carries a test ID). */
  kind?: string;
  /** False = clickable, but with no role a test could query. */
  hasRole?: boolean;
  /** A custom component with a click handler: what it renders is not visible to the scanner. */
  roleUnknown?: boolean;
  isTable?: boolean;
  name?: NameResult;
  testId?: TestId;
  /** Name of a record-key attribute such as data-order-id, if the element has one. */
  entityKey?: string;
  /** The tag is a component (not a plain HTML element), so another template may define it. */
  component?: boolean;
  /** An alternative to something else (an else branch, a switch case, a route): not on the page together with its counterpart. */
  conditional?: boolean;
  /** Rendered only under a condition: an if/else or switch arm, *ngIf, an ng-template, v-if / v-show, a ternary, &&, after an early return. */
  rendersConditionally?: boolean;
  /** Every if/else or switch arm the element is rendered in (see `Branch`). */
  branches?: Branch[];
  /** React: the component function this element is written in. */
  owner?: string;
  /** On a component tag: the inputs bound to an expression, by name. */
  boundProps?: Record<string, string>;
  /** On a component tag: the props given as plain text (name="home"). */
  staticProps?: Record<string, string>;
  /** On a component tag of unknown kind: the name it would have if the component passes its content on. */
  usageName?: NameResult;
  /** The element hands on what its component is given: <slot>, <ng-content>, {children}. */
  passesContent?: boolean;
  /** The element's aria-label is one of its component's props (aria-label={label}): the name of that prop. */
  nameProp?: string;
  /** A use of a wrapper component of the project (set by the cross-file pass). */
  wrapped?: boolean;
  /** Represented by the places its component is used (see `wrapper components`), so not listed itself. */
  viaUsages?: boolean;
  /** Set by the cross-file pass when the element's component is rendered more than once. */
  repeatedBy?: string;
  /**
   * Present when a form control has a placeholder. `text` is filled when it is fixed text or a fixed
   * translation key (`translationKey`); a placeholder only known at runtime has no text.
   */
  placeholder?: { text?: string; translationKey?: boolean };
}

/** ARIA role -> kind, for an explicit role="..." attribute. */
export const ROLE_KINDS: Record<string, string> = {
  button: 'button', link: 'link', checkbox: 'checkbox', radio: 'radio', tab: 'tab',
  menuitem: 'menu-item', switch: 'toggle', combobox: 'select', option: 'option', textbox: 'input', row: 'row',
};

export type Status = 'OK (test ID)' | 'OK (name)' | 'OK (reviewed)' | 'Needs test ID' | 'Missing name' | 'Fix test ID' | 'Manual review';

/**
 * How far a recommended locator is meant to reach.
 * page-candidate - expected to match one element; checked within its own file only, not on the rendered page
 * record-scoped  - only meaningful inside one record (a row, a list item): narrow down to the record first
 * unknown        - no locator could be recommended, or its reach cannot be told from the source
 */
export type LocatorScope = 'page-candidate' | 'record-scoped' | 'unknown';

/** An accessibility problem seen in the source. Independent of `status`: an element with a valid test ID can have one. */
export interface AccessibilityFinding {
  rule: 'missing-name' | 'placeholder-only' | 'no-role' | 'nested-interactive' | 'title-only';
  /** confirmed = visible in the source; needs-review = rests on an assumption the scanner had to make. */
  certainty: 'confirmed' | 'needs-review';
  message: string;
}

export interface ElementRecord {
  /** Path relative to the scanned folder, with forward slashes. */
  file: string;
  line: number;
  tag: string;
  /** button, link, input, select, row, ... or "other" for an element that only carries a test ID. */
  kind: string;
  /** The accessible name found statically (translated text when an i18n file was given, otherwise the key). */
  label: string;
  nameKind: NameKind;
  translationKeys: string[];
  /** Rendered once per record (inside a loop, a table cell, ...). */
  repeated: boolean;
  /**
   * Rendered only under a condition (if/else, *ngIf, @if, @switch, ng-template, v-if, v-show, ternary, &&, after an
   * early return). Such an element can be legitimately absent from a page, so a browser check that does not find it
   * cannot call its locator wrong.
   */
  conditional?: boolean;
  /**
   * Lines of the same element in the other arms of its if/else or switch (same role and name, or same fixed test ID).
   * The locator is meant to find whichever of them is shown.
   */
  alternatives?: number[];
  testId?: string;
  testIdKind?: TestId['kind'];
  status: Status;
  reason?: string;
  /** Broken test ID rules. Never cleared by a reviewed marker. A test ID with violations is "Fix test ID", not OK. */
  violations: string[];
  /**
   * A Playwright locator built from the source, e.g. page.getByRole('button', { name: 'Save', exact: true }).
   * <...> marks a value only known at runtime. A suggestion, never run against a page. Absent when none can be built.
   */
  recommendedLocator?: string;
  /** What to know before using the recommended locator. */
  locatorNote?: string;
  locatorScope: LocatorScope;
  /** For a Needs test ID item that is rendered once and has a fixed name: an ID built from that name. A starting point, not a rule. */
  suggestedTestId?: string;
  accessibilityFindings: AccessibilityFinding[];
  /**
   * For Manual review and OK (reviewed) items: a short hash of what a reviewer looks at (tag, kind, name,
   * test ID, reason). Written into the reviewed comment, it lets the scanner notice a later change.
   */
  fingerprint?: string;
}

export interface Counts {
  elements: number; okId: number; okName: number; reviewed: number;
  needsId: number; missingName: number; fixId: number; todo: number; violations: number; review: number;
  /** Elements with at least one confirmed accessibility finding. Not part of To do. */
  a11y: number;
}

export interface FileResult {
  file: string; folder: string; framework: Framework; elements: ElementRecord[];
  /** Angular: the element selectors of the component(s) this template belongs to (app-home). Lets a browser tool tell which template an element came from. */
  selectors?: string[];
}

export interface ScanResult {
  /** Version of this JSON shape. Raised when a field is renamed or removed, not when one is added. */
  schemaVersion: 1;
  /** The folder as given by the caller. */
  source: string;
  /** YYYY-MM-DD */
  scannedOn: string;
  frameworks: Framework[];
  /** Where `frameworks` came from: the framework option, the nearest package.json, or all three because no package.json names one. */
  frameworkSource?: 'option' | 'package.json' | 'default';
  strict: boolean;
  files: FileResult[];
  elements: ElementRecord[];
  totals: Counts;
  /** The same fixed test ID used in more than one file: a collision only if those files render together. */
  sharedTestIds: Array<{ testId: string; locations: string[] }>;
  notScanned: {
    /** *.html files outside the scan pattern (use allHtml to include them). */
    otherHtml: string[];
    /** Templates the scanner found but could not read safely (an inline template built from variables, a Pug template, ...). */
    unreadable: Array<{ file: string; reason: string }>;
  };
}
