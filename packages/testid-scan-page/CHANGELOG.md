# Changelog

Versions before 1.0 are betas: 0.9.0 is the first published to npm. Until 1.0, a minor version may change verdicts
(always toward fewer wrong ones) and the JSON may gain fields; options are not removed. JSON fields are only ever added, so reports of an
older version still read the same; the CLI options of 0.1 all still work.

## 0.9.0 — 2026-10-16 (first public release, beta)

React production builds with source maps can now be checked for certain, and two more real apps are measured.

### Added
- **Component ownership in React production builds with source maps** (Chromium). Production React keeps no owner on
  its elements and minifies component names, but every element's props object and every component's function remain.
  The outermost component whose output reaches an element's props created it; Chromium says where that component's
  function starts in the bundle, and the source map names the file. Chained (the creator, the creator of that
  component's element, ...), this tells whether a locator found the element of its source line:
  - an HTML element of file F: its creator is F's component;
  - a component used in F (`<Button>`): F used the library or project component that rendered it.
  A chain without F is another component's element, but only when a component of F is on the page (a file of helpers,
  such as table columns, creates its elements inside other files' components). Anything else says nothing. Files with a
  mounted component also count as shown on the page. Evidence: `component ownership`, `target.by: 'react owner'`.
  It is on by default with `exact`; `CheckOptions.react: false` turns it off. Without source maps nothing changes.
  New exports: `reactOwnership`, `judgeChain`, `decodeMappings`, `sourceAt`, `linkOf` (`src/react.ts`, no new
  dependency: source maps are decoded here). Tests: `test/react.test.ts`.
- Accuracy corpus: `react-shop (source maps)` variant. Real-app run: React apps are served with source maps and checked
  a third time that way, scored against the same data-tsrc referee; the kit key and `score-labels.mjs` score it too.
- Two more real apps: conduit-react (React 19, Vite 7) and conduit-angular (Angular 21, standalone components, `@if`
  blocks), with a shared fixed-data RealWorld API (`journeys/conduit-api.mjs`). The equivalence check covers
  conduit-react too (15 screens).

### Changed (with testid-scan 0.2.1)
- JSX inside a function passed as children counts as conditional, so it is no longer proved by elimination. The source
  map check found the case: on bulletproof-react a "Body" field of a closed drawer had been "verified correct" with
  data-tsrc, while the locator found another drawer's field. Cost: on bulletproof-react without evidence 85.4% of
  locators stay unverified (62.5% before), 20.8% with data-tsrc (16.7%).

## 0.8.0 — 2026-10-15

Reliability, reporting, scoring and CI. No new verification method.

### Fixed
- **Evidence from one app state was used in another state with the same URL.** "Its component is on the page" was
  inferred per URL, so a dialog opened and closed on one URL shared evidence. Each `checkOnPage` call is now one
  observed state (`pages[].state`, `pages[].label`), and inference never crosses states. Regression test:
  `test/state.test.ts` (fails without the fix). Cost: on bulletproof-react, without evidence, 62.5% of locators stay
  unverified (50% before); precision is unchanged at 100%.
- **Temporary attributes could stay on the page** when the in-page check threw half way. Both `data-testid-scan-verify`
  and `data-testid-scan-page` are now removed in a `finally`, without relying on `querySelectorAll`. Regression test
  in `test/state.test.ts` (fails without the fix).

### Added
- `evidence` on every verified locator: `source line`, `component ownership`, `elimination`, `match count`, `heuristic`,
  `none`. A verdict never rests on `heuristic`.
- `remediation` on incorrect and unverified locators: what to change, or what would settle it.
- `framework` on every verified locator (from testid-scan's `files[].framework`).
- `verify.summary` in the JSON: verdict counts, evidence breakdown, share verified.
- `--summary <file>`: the counts as a small JSON file for CI. `--min-verified <pct>`: exit 1 below that share.
- Markdown report: incorrect locators first (those testid-scan promised were unique at the top), then the reasons for
  "unable to verify", then the safe ones; each with framework, evidence, the states it was checked in with match
  counts, why, and what to do. The terminal output shows the remediation under each incorrect locator.
- `CheckOptions.state`: name the app state being checked (a journey step); reports show it.
- `accuracy/real/score-labels.mjs` rewritten: CSV validation (header, unknown and duplicate ids, allowed labels and
  review types; exit 2 on errors), missing and empty rows reported, several reviewer files at once with Cohen's kappa,
  `review_type` (human / ai-assisted / ai; anything else is reported as "unspecified", never as independent human
  review), per-framework scores, confusion matrix, false assurance and false alarm rates, recall of incorrect locators,
  coverage. "cannot tell" is never counted as right or wrong. `--out` and `--json`.
- Labelling kit: `reviewer` and `review_type` columns, instructions for both, `--kit-seed` for a new independent
  sample, framework in `label-key.json`.
- `accuracy/equivalence.mjs` (`npm run equivalence`): plain and instrumented builds of the same app must show the same
  accessibility tree, text, interactive elements and console errors on every screen, and the plain build must have no
  marks.
- `scripts/smoke.mjs` (`npm run smoke`): packs the package, installs the tarball with Playwright into an empty folder
  and runs the CLI and both entry points from there.
- `.github/workflows/ci.yml`: build (strict type check), tests and CLI smoke on Node 18/20/22, the clean-install smoke
  test, and an accuracy job (corpora, baseline, targets, equivalence) when `TESTID_SCAN_REPO` is set.

## 0.7.0 — 2026-10-15

Fixes for the three disagreements found by the first independent review (see `accuracy/real/README.md`).
- A single match must be proved in every state that shows its component, not in one.
- `testid-scan-page/vite` writes component uses to `data-tsrc-use`; `data-tsrc` is always the line an element was
  written at (a component passing its props on had overwritten it).
- With testid-scan 0.2: JSX passed as a prop and Vue named-slot content count as conditional.

## 0.6.0 — 2026-10-14
- `testid-scan-page/vite`: opt-in Vite plugin marking React and Vue elements with `data-tsrc="file:line"`.
- A locator is judged only on screens that show its component; a component counts as shown only through a locator no
  other file has (found on vue3-realworld: login, register and settings share field names).
- Real-app referee run (`accuracy/real/`) and blind labelling kit.

## 0.5.0 — 2026-10-14
- Three verdicts: verified correct, verified incorrect, unable to verify. Proof by elimination for unconditional
  elements; no verdict from a guess; `--fail-on-incorrect`. Precision targets written before measuring
  (`accuracy/targets.json`).

## 0.4.0 — 2026-10-14
- Target check: Angular hosts (also production), Vue development builds, region guess. `wrong target`,
  `--fail-on-wrong-target`, `--strict-target`.

## 0.3.0 — 2026-10-14
- Accuracy corpora for Angular and React next to Vue.

## 0.2.0 — 2026-10-14
- `--verify` outcomes split into matched / ambiguous / not found / not visited / unreadable; Vue accuracy corpus.

## 0.1.0 — 2026-10-14
- First prototype: scan a URL, run every locator, `--verify` testid-scan's locators.
