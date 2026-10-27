import type { PageScan } from './types.ts';

/**
 * Check that a parsed JSON file is a testid-scan-page result this version can read, and say what to do when it is not.
 * Throws an Error with a message for the person running the command.
 */
export function readScan(json: unknown): PageScan {
  const data = json as Partial<PageScan> & { files?: unknown; elements?: unknown };
  if (!data || typeof data !== 'object') throw new Error('The file is not a JSON object.');
  if (!Array.isArray(data.pages)) {
    if (Array.isArray(data.files) && Array.isArray(data.elements)) {
      throw new Error('This is a testid-scan result (a scan of source files). This version reads testid-scan-page results: '
        + 'scan the running pages with `npx testid-scan-page <url> ... --json scan.json`.');
    }
    throw new Error('Not a testid-scan-page result: it has no "pages". Create one with `npx testid-scan-page <url> ... --json scan.json`.');
  }
  if (data.schemaVersion !== 1) throw new Error(`Unknown schemaVersion ${String(data.schemaVersion)}; this version reads schemaVersion 1.`);
  return data as PageScan;
}
