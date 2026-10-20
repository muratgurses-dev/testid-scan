/** Opens each URL in Chromium, scans it, and (optionally) runs testid-scan's locators on it. */
import type { Browser, BrowserContextOptions, Page } from 'playwright';
import { addCounts, scanLoadedPage } from './page.ts';
import { checkOnPage, finishVerify, locatorsToCheck } from './verify.ts';
import type { StaticScan } from './verify.ts';
import type { PageResult, ScanPageResult } from './types.ts';

export interface ScanPagesOptions {
  testIdAttribute?: string;
  /** Playwright storage state (cookies, local storage) of a logged-in session. */
  storageState?: string;
  /** Extra wait after the page has loaded, in milliseconds. */
  wait?: number;
  headed?: boolean;
  viewport?: { width: number; height: number };
  /** testid-scan's --json output: its recommended locators are run on every page. */
  staticScan?: StaticScan;
  /** Called after each page, for progress output. */
  onPage?: (page: PageResult) => void;
}

async function launch(headed: boolean): Promise<Browser> {
  let playwright: typeof import('playwright');
  try {
    playwright = await import('playwright');
  } catch {
    throw new Error('testid-scan-page needs Playwright. Run: npm install --save-dev playwright && npx playwright install chromium');
  }
  try {
    return await playwright.chromium.launch({ headless: !headed });
  } catch (error) {
    const message = (error as Error).message;
    if (/Executable doesn't exist|install/i.test(message)) throw new Error('Chromium for Playwright is not installed. Run: npx playwright install chromium');
    throw error;
  }
}

/** Wait until the page has loaded and its network has gone quiet (or a few seconds have passed). */
export async function settle(page: Page, wait = 0): Promise<void> {
  await page.waitForLoadState('load');
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
  if (wait > 0) await page.waitForTimeout(wait);
}

export async function scanPages(urls: string[], options: ScanPagesOptions = {}): Promise<ScanPageResult> {
  const testIdAttribute = options.testIdAttribute ?? 'data-testid';
  const browser = await launch(Boolean(options.headed));
  const toCheck = options.staticScan ? locatorsToCheck(options.staticScan) : undefined;
  const pages: PageResult[] = [];
  try {
    const playwright = await import('playwright');
    playwright.selectors.setTestIdAttribute(testIdAttribute);
    const contextOptions: BrowserContextOptions = { viewport: options.viewport ?? { width: 1280, height: 800 } };
    if (options.storageState) contextOptions.storageState = options.storageState;
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    for (const url of urls) {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (response && response.status() >= 400) throw new Error(`${url} answered ${response.status()}`);
      await settle(page, options.wait);
      if (toCheck) await checkOnPage(page, toCheck.items, toCheck.selectorsByFile); // before the scan marks elements
      const result = await scanLoadedPage(page, { testIdAttribute });
      pages.push(result);
      options.onPage?.(result);
    }
    await context.close();
  } finally {
    await browser.close();
  }
  return {
    schemaVersion: 1, scannedOn: new Date().toISOString().slice(0, 10), testIdAttribute,
    pages, totals: addCounts(pages.map((p) => p.totals)),
    verify: toCheck ? finishVerify(toCheck.items, toCheck.skipped) : undefined,
  };
}
