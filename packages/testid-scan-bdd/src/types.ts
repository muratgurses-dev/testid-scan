/**
 * The part of a testid-scan-page `--json` result this package reads. Only fields that testid-scan-page documents are
 * used; anything else in the file is ignored.
 */
export interface PageScan {
  schemaVersion: 1;
  scannedOn: string;
  testIdAttribute: string;
  pages: ScannedPage[];
}

export interface ScannedPage {
  url: string;
  title: string;
  elements: ScannedElement[];
}

export interface ScannedElement {
  /** ARIA role computed by the browser; empty when the element has no role a test can query. */
  role: string;
  /** Accessible name computed by the browser. */
  name: string;
  testId?: string;
  status: 'OK (test ID)' | 'OK (name)' | 'OK (reviewed)' | 'Needs test ID' | 'Missing name' | 'Fix test ID' | 'Manual review';
  reason?: string;
  /** A locator that was run on the page and matched exactly this one element. */
  locator?: string;
}

/** One sentence a person can write in a scenario. */
export interface CatalogStep {
  /** The Gherkin line, e.g. `When I click the "Save" button`. */
  text: string;
  /** How the step finds the element: by role and name, by test ID, or inside one record. */
  how: string;
  /** Records the step was seen in, for steps inside a list item or table row: "Lamp", "Desk". */
  examples?: string[];
}

/** What a scenario can do on one page, and what it cannot do yet. */
export interface CatalogPage {
  /** The page as a step names it, relative to the base URL: "#/cart", "orders?tab=open". */
  path: string;
  title: string;
  steps: CatalogStep[];
  /** Elements no step can find yet, with the reason from the scan: "button "Compare": needs test ID: ...". */
  unavailable: Array<{ element: string; reason: string }>;
}

export interface Generated {
  /** The step definitions for playwright-bdd (TypeScript). */
  steps: string;
  /** The catalog as Markdown. */
  catalog: string;
  pages: CatalogPage[];
  /** Elements found by their test ID, by `role:name` as a step writes them. */
  testIds: Record<string, string>;
}
