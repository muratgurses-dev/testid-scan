# Contributing

Issues and pull requests are welcome. The most useful reports are a short snippet of the template or component, the
locator a tool recommended, and what it found on the page.

## Setup

```bash
cd packages/testid-scan && npm install && npm test
cd ../testid-scan-page && npm install && npx playwright install chromium && npm test
cd ../testid-scan-bdd && npm install && npm test && npm run e2e
```

Node 18 or later. Each package has its own `package-lock.json`; there are no workspaces, so run commands inside the
package you change.

## What a change needs

- A test that fails without the change (`test/*.test.ts`).
- `npm run build` passes: it is the strict type check.
- For anything that changes what testid-scan reports or what `--verify` decides: `npm run accuracy` in
  `packages/testid-scan-page` (it builds the corpora and uses `../testid-scan`). It fails when a metric gets worse than
  `accuracy/baseline.json`, or when verdict precision drops below `accuracy/targets.json`. Update the baseline
  (`--update-baseline`) only when the change is meant to move a number, and say why in the pull request.
- A line in the package's `CHANGELOG.md`.

## The rule for `--verify`

A verdict is given only on evidence. When in doubt, a locator stays "unable to verify": a wrong "verified correct"
is the worst outcome, because a test would act on the wrong element and nobody would know. A change that verifies more
locators by guessing will not be merged.

## Labelling

`packages/testid-scan-page/accuracy/real/README.md` explains the blind labelling kit. A labelled kit from someone who
did not write the tools, with `review_type` set to `human`, is a valuable contribution on its own.
