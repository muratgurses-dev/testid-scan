/** Types shared by the page scanner, the verifier and the reports. */

/** The same statuses as testid-scan, so the two reports read alike. */
export type Status = 'OK (test ID)' | 'OK (name)' | 'Needs test ID' | 'Missing name' | 'Fix test ID' | 'Manual review';

export interface PageFinding {
  rule: 'missing-name' | 'no-role' | 'duplicate-test-id';
  message: string;
}

/** One interactive element as the browser shows it. */
export interface PageElement {
  /** Short CSS path, to find the element in the browser's developer tools. */
  selector: string;
  /** The start tag as written in the page, shortened. */
  html: string;
  tag: string;
  /** ARIA role computed by the browser; empty when the element has no role a test can query. */
  role: string;
  /** Accessible name computed by the browser (what getByRole(..., { name }) matches). */
  name: string;
  testId?: string;
  /** How many visible elements the role + exact name matches on the page. 0 when there is no role or name. */
  nameMatches: number;
  /** How many elements carry the same test ID. */
  testIdMatches: number;
  status: Status;
  reason?: string;
  /** A locator that was run on the page and matched exactly this one element. */
  locator?: string;
  findings: PageFinding[];
}

export interface Counts {
  elements: number; okId: number; okName: number; needsId: number; missingName: number; fixId: number; review: number; todo: number;
}

export interface PageResult {
  url: string;
  /** Page title, to tell the pages apart in the report. */
  title: string;
  elements: PageElement[];
  totals: Counts;
}

export type VerifyOutcome = 'matched' | 'wrong target' | 'ambiguous' | 'not found' | 'not visited' | 'unreadable';

/**
 * Whether the one element a locator matched is the element of its source line.
 * exact     - the page says which template the element came from: Angular host elements (also in production builds),
 *             Vue development builds (each element knows its component's file)
 * region    - a guess: the other elements of the same file sit together in one part of the page; is this one in it?
 * unchecked - neither was possible (too few other elements of the file on the page)
 */
export interface TargetCheck {
  check: 'exact' | 'region' | 'unchecked';
  /** For exact checks: what told (data-tsrc names the source line; Angular hosts, Vue dev builds and React source maps name the file). */
  by?: 'source line' | 'angular host' | 'vue file' | 'react owner';
  /** False = it found another element. Undefined = not checked. */
  ok?: boolean;
  /** Angular selector or Vue file the element belongs to, when known. */
  owner?: string;
  reason: string;
}

/**
 * The answer that matters, decided only on evidence:
 * verified correct   - it finds exactly the element of its source line, shown by the page (the component the element
 *                      belongs to) or by elimination (see why)
 * verified incorrect - it finds several elements, another element, or nothing although its element must be there
 * unable to verify   - the evidence is not there either way; why says what would provide it
 */
export type Verdict = 'verified correct' | 'verified incorrect' | 'unable to verify';

/**
 * What a verdict rests on, strongest first.
 * source line         - data-tsrc on the element names its file and line (testid-scan-page/vite test builds)
 * component ownership - the page names the element's component: an Angular host, a Vue development build
 * elimination         - only one element on the page can be the element of its line (unconditional, its component
 *                       shown, no twin with the same role and name, hidden or not)
 * match count         - the locator matches several elements: wrong without knowing which is which
 * heuristic           - a guess (where the element sits on the page); never enough for a verdict
 * none                - nothing settles it; see why and remediation
 */
export type Evidence = 'source line' | 'component ownership' | 'elimination' | 'match count' | 'heuristic' | 'none';

/** One page a locator was run on. */
export interface LocatorOnPage {
  url: string;
  /** Which observed state of the app this was (0, 1, ...): evidence is never mixed between states. */
  state: number;
  /** The name of that state (a journey step), or its URL. */
  label: string;
  /** Matches, as an action would see them (getByRole leaves hidden elements out). */
  count: number;
  /** Matches including hidden elements: a hidden twin with the same role and name makes a single match unprovable. */
  withHidden: number;
  /** The component of its source file was shown on this page: the page said so (see fileShownKnown), or another locator that only its file has matched. */
  fileShown: boolean;
  /** Test builds with data-tsrc (testid-scan-page/vite): whether the element of its source line was on the page. */
  sourcePresent?: 'visible' | 'hidden' | 'absent';
  /** fileShown came from the page itself (data-tsrc, Vue development build, Angular hosts), not from other locators. */
  fileShownKnown?: boolean;
  /** For a single match: how its element was checked against the source line on this page. */
  target?: TargetCheck;
}

/** What happened to one locator recommended by testid-scan when it was run on the pages. */
export interface VerifiedLocator {
  file: string;
  line: number;
  locator: string;
  /** The scope testid-scan gave it (page-candidate, record-scoped, unknown). */
  scope: string;
  /** Highest number of matches on any page; -1 = the locator could not be read. */
  maxMatches: number;
  /** URLs where it matched at least one element. */
  seenOn: string[];
  /**
   * matched      - exactly one element on every page where it matched anything (see target for how sure that is)
   * wrong target - exactly one element, but not the one in its source line (see target.check for how sure)
   * ambiguous    - more than one element on at least one page
   * not found   - no match, although other locators from the same source file matched on a scanned page:
   *               the component was there, so the locator is wrong or the element is hidden in that state
   * not visited - no match, and nothing else from its file matched either: its screen was probably not scanned
   * unreadable  - not a plain locator call
   */
  result: VerifyOutcome;
  /** How the single element it matched was checked against its source line. */
  target?: TargetCheck;
  /** testid-scan: the tag written in the source (button, Button, mat-icon-button...). */
  tag?: string;
  /** testid-scan: angular, react or vue. */
  framework?: string;
  /** testid-scan: the element is shown only under a condition, or once per record in a list. */
  conditional?: boolean;
  repeated?: boolean;
  /** testid-scan: lines of the same element in the other arms of its if/else or switch. */
  alternatives?: number[];
  pages: LocatorOnPage[];
  verdict: Verdict;
  /** The evidence for the verdict, or what is missing. */
  why: string;
  /** The kind of evidence the verdict rests on. */
  evidence?: Evidence;
  /** What to change, for incorrect and unverified locators. */
  remediation?: string;
  error?: string;
}

export interface VerifySummary {
  locators: number;
  skipped: number;
  verifiedCorrect: number;
  verifiedIncorrect: number;
  unableToVerify: number;
  /** Share of locators with a verdict either way, in percent. */
  verifiedShare: number;
  /** "verdict: evidence" -> count. */
  evidence: Record<string, number>;
}

export interface VerifyResult {
  /** Locators that were run (record-scoped ones with <...> placeholders are skipped). */
  checked: VerifiedLocator[];
  skipped: number;
  summary?: VerifySummary;
}

export interface ScanPageResult {
  schemaVersion: 1;
  scannedOn: string;
  testIdAttribute: string;
  pages: PageResult[];
  totals: Counts;
  verify?: VerifyResult;
}
