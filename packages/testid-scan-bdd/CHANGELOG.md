# Changelog

## 0.1.0 — Unreleased

First version.

- `testid-scan-bdd <scan.json>` reads a testid-scan-page `--json` result and writes step definitions for
  playwright-bdd (`steps/testid-scan.steps.ts`) and a catalog of the steps a scenario can use on each scanned page
  (`testid-steps.md`), with the elements no step can find yet and why.
- Steps find elements by role and accessible name, by test ID where that is the only way, and inside one list item
  or table row for repeated elements; every locator runs in Playwright's strict mode.
- `generate()` and `readScan()` for use from code.
- Checked end to end: the generated steps run a feature file in Chromium with playwright-bdd (`npm run e2e`), and
  fail with a strict mode violation on an element the catalog lists as not available.
