# testid-scan-page

> **Beta.** The page scan and `--verify` are measured on three small apps with known traps and on five real
> open-source apps (see "How accurate is it?"), but they have few users yet. The React source-map check
> ("React production builds with source maps") is **experimental**: it reads React's internal data. Reports and
> issues are welcome.

**Prototype.** The companion of [testid-scan](../testid-scan): testid-scan reads your source files; this one opens
the running page in Chromium and checks the same question there: **can a Playwright test find each element, and is
the locator unique?**

- Works on any web page, whatever it is built with. No source code needed.
- Uses the role and accessible name the browser itself computes, so it sees names set from code and elements hidden
  by CSS, which a source scanner cannot.
- Every locator it lists was **run on the page** and matched exactly one element.
- `--verify` runs the locators testid-scan recommended for your source on the running pages, so the static report
  gets checked against reality.
- Read-only: it marks elements with a temporary attribute while it scans and removes it afterwards.

## Quick start

```bash
npm install --save-dev testid-scan-page playwright
npx playwright install chromium
npx testid-scan-page http://localhost:4200/orders
```

```
http://localhost:4200/orders
  Needs test ID  link "Home": name "Home" matches 2 elements on the page  [header > a:nth-of-type(1)]
  Missing name   button (no name): button without an accessible name: getByRole cannot tell it apart  [header > button]
  Fix test ID    link "Details": test ID "product-details-link" is on 3 visible elements; repeated (3 on the page): unique inside its list item  [a[data-testid="product-details-link"]]
  Manual review  <div>: looks clickable (pointer cursor) but has no role: check whether it is a control  [main > div]

6 to do · 1 to review · 6 ok · 1 page
Report: /work/app/testid-page.md
```

The report lists, page by page, what to fix and every locator that works, ready to paste into a test.

## Together with testid-scan

```bash
npx testid-scan src --json scan.json
npx testid-scan-page http://localhost:4200/ http://localhost:4200/orders --verify scan.json
```

Each recommended locator from `scan.json` is run on every page and reported as:

| Result | Meaning |
|---|---|
| matched | exactly one element on every page where it matched, and as far as can be checked the element of its source line |
| wrong target | exactly one element, but another one than the element of its source line (see below) |
| ambiguous, expected to be unique | testid-scan said `page-candidate`, but the page has more than one: the static report was wrong here |
| ambiguous, as testid-scan said | testid-scan had already listed it as repeated or to review |
| not found | nothing, although other locators from the same source file matched on a scanned page: the locator is wrong (a translation key instead of the text, a name set from code), or the element is hidden in that state |
| not visited | nothing, and nothing else from its file either: its screen was probably not scanned, add the URL |
| unreadable | not a plain locator call |

### Three answers: verified correct, verified incorrect, unable to verify

Every locator from `scan.json` ends with one verdict, given only on evidence:

| Verdict | Evidence |
|---|---|
| **verified correct** | it matches exactly one element, and either the page says which component that element belongs to (see the target check), or it must be the element of its line by elimination: testid-scan says the element is shown unconditionally, its component is on the page, and no other element, visible or hidden, has that role and name |
| **verified incorrect** | it matches several elements; or the page says the one element belongs to another component; or it matches nothing although its component is on the page and shows the element unconditionally (a wrong name, such as a translation key) |
| **unable to verify** | anything else, with the reason, which also says what would settle it: its screen was not scanned (add the URL), the element is shown only under a condition, a hidden element has the same name, the component could only be guessed (likely wrong) |

A guess never verifies: the region check can make a locator *likely wrong*, which stays "unable to verify". JSON from a
testid-scan that does not yet say whether elements are conditional is never used to prove or condemn a locator.
`--fail-on-incorrect` fails the run while a locator is verified incorrect.

Each verified locator in the JSON also says what the verdict rests on and what to do:

| Field | Values |
|---|---|
| `evidence` | `source line` (data-tsrc), `component ownership` (Angular host, Vue dev file), `elimination`, `match count` (several matches), `heuristic` (the region guess; never enough for a verdict), `none` |
| `remediation` | for incorrect and unverified locators: what to change (a test ID, a row scope, the real name), or what would settle it (the URL of its screen, a state that shows the element, a build with data-tsrc) |
| `framework`, `pages[]` | the framework of its file, and every state it was checked in, with the match count there |

`verify.summary` counts the verdicts, the evidence and the share verified. The Markdown report lists incorrect
locators first, those testid-scan promised were unique at the top, then the reasons for "unable to verify", then the
safe ones.

For CI: `--summary counts.json` writes those counts as a small file, and `--min-verified 60` fails the run while fewer
than 60% of the locators have a verdict either way, so a build that quietly stops giving evidence shows up.

### Is it the right element? The target check

A locator that finds exactly one element can still find the wrong one: another component with the same role and name,
while the element of its source line is not on the page. A test using it clicks the wrong thing. For every single match,
`--verify` checks the element against its source line, in the most certain way the page allows:

| Check | When | How |
|---|---|---|
| exact | Angular, also production builds | the component host around the element (`<app-toast>`) names its template; with component styles the `_ngcontent` stamp does, even for elements moved to `<body>`. Needs the JSON of testid-scan 0.2 or later (it lists each template's selectors) |
| exact | Vue development builds | each element knows the file of the component that rendered it |
| exact | React production builds with source maps (Chromium) | the component that created the element, found through React's own data on the page, and its file from the source map (see below) |
| region | anything else (React, Vue production) | a guess: an element shares some part of the page with at least one other element of its file; one that meets them only at `<body>` lives elsewhere |
| unchecked | | no other element of its file was found on the page to compare with |

A `wrong target` from an exact check is certain; from the region guess it is *likely*, and wrong for a dialog of the
file that is moved to `<body>` alone (a one-button banner, for example). The report and the terminal say which.
`--fail-on-wrong-target` fails on certain ones; add `--strict-target` to count likely ones too.

Locators with `<...>` (record-scoped, a value to fill in) are skipped. testid-scan tells you *where* in the source a
problem is; this tells you whether the locator really works.

## How accurate is it? The accuracy run

`accuracy/` holds three small shops built as a test of the two scanners, one per framework: `angular-shop`
(Angular 19), `react-shop` (React 18) and `vue-shop` (Vue 3). Every interactive element carries `data-gt="<id>"`, a
hand-written ground-truth id that neither scanner reads. Each app contains the same deliberate traps: the same name in
two components on the page, an if/else pair, a name set from code, a translation key, a duplicate hidden by CSS, a
button that is only rendered later, a screen the run does not visit, a toast created from code whose "Close" button
another component's locator finds, and two dialogs of the home screen moved to `<body>` (one with two buttons, one with
a single button) to measure false "wrong target" reports. Each also has traps of its own framework: Angular's `*ngIf ... else
<ng-template>` and one `ng-template` stamped out twice with `ngTemplateOutlet`; React's JSX helper handed to `.map`
by name.

```bash
npm run build                      # this package
(cd ../testid-scan && npm run build)
for d in accuracy/*-shop; do (cd $d && npm install); done
npm run accuracy                   # or: node accuracy/run.mjs --scanner <testid-scan/dist/cli.js> [--corpus vue-shop]
```

For each locator testid-scan recommends, the run knows which element it should find (the `data-gt` on its source line)
and asks the browser which one it really found. It writes `accuracy/results/accuracy.md` and fails when a metric of any
corpus, or of the total, is worse than `accuracy/baseline.json` (`--update-baseline` saves a new one).

Before measuring the verdicts, `accuracy/targets.json` set the bar: verified correct must be right in at least 99% of
cases and verified incorrect in at least 95%. The run fails below it.

| Metric | Angular | React | React (source maps) | Vue | Vue (dev build) | Total | Meaning |
|---|---:|---:|---:|---:|---:|---:|---|
| verifiedCorrectPrecision | 100% | 100% | 100% | 100% | 100% | 100% | verified correct, and really correct (15, 6, 10, 6, 13 locators; 27 in total) |
| falseAssurance | 0 | 0 | 0 | 0 | 0 | 0 | verified correct, but wrong |
| verifiedIncorrectPrecision | 100% | 100% | 100% | 100% | 100% | 100% | verified incorrect, and really wrong (8, 7, 8, 6, 7; 21 in total) |
| falseAlarmVerify | 0 | 0 | 0 | 0 | 0 | 0 | verified incorrect, but right |
| wrongLocatorsCaught | 100% | 87.5% | 100% | 85.7% | 100% | 91.3% | wrong locators that were verified incorrect |
| unableShare | 11.5% | 45.8% | 25% | 47.8% | 13% | 34.2% | locators left unverified |
| claimPrecision | 83.3% | 85.7% | 85.7% | 86.7% | 86.7% | 85.1% | testid-scan: page-candidate locators that found exactly their element |
| coverage | 100% | 100% | 100% | 100% | 100% | 100% | testid-scan: visible elements it reported at all |
| falseAlarms | 1 | 1 | 1 | 1 | 1 | 3 | testid-scan: "Needs test ID" for a name that is unique on the page |

Where exact information exists (Angular, a Vue development build, data-tsrc) about one locator in eight stays
unverified: an unvisited screen, or a button that is only shown later; a React build with source maps leaves one in
four. In React and a Vue production build without them it is four to five in ten:
elements shown under a condition cannot be proved by elimination, and the toast's "Close" is only *likely* wrong. That
is the price of never guessing; a build that tells which file rendered each element closes most of the gap.

The `conditional` mark in testid-scan's JSON matters: with a testid-scan that does not write it, the coupon button
(shown later) would come out verified incorrect in every corpus and verified-incorrect precision would drop to 87%,
below the bar. With such JSON the tool now refuses to prove or condemn and leaves 74% unverified instead.

The total adds up the production build of each corpus; `vue-shop (dev)`, `react-shop (source maps)` and the data-tsrc
builds are the same apps built differently, measured separately to show the exact checks.

What testid-scan's misses are:

| Miss | Where | Why |
|---|---|---|
| ambiguous claim | Angular | an `ng-template` rendered twice with `ngTemplateOutlet`: the source has one button, the page two |
| ambiguous claim | React | `products.map(renderCompare)`: a helper passed by name is not seen as a loop (a known limit) |
| wrong target | Angular, Vue | the toast is created from code, so testid-scan cannot know its "Close" is on the page. `--verify` catches it: for certain in Angular and in the Vue dev build, as likely in Vue production. In React the toast is rendered with JSX in `main.jsx`, so testid-scan sees both "Close" buttons and makes no claim; `--verify` still catches the panel's locator as likely wrong |
| missing visible | all | the translation key: without `--i18n` testid-scan only knows `home.subscribe`, not "Subscribe" |
| false alarm | all | two "Menu" buttons, one hidden by CSS: CSS is not read |
| not found, wrongly | all | the coupon button is not rendered yet; `--verify` calls it "not found" because other locators of its file matched |
| false wrong target | React, Vue production | the one-button banner moved to `<body>`: the region guess has nothing of its file near it |

Before the target check, `--verify` reported all three wrong targets as "matched". With testid-scan before its if/else
fix (testid-scan 0.1), the run gives fewer claims, more false alarms and fails the baseline in all three corpora. That is
what the run is for: a change that makes either tool less accurate shows up as a number.

Three small apps written to contain known traps are not a benchmark of real projects: the numbers say how the tools
behave on these traps, not how often the traps occur. Add real apps as corpora to make them mean more.

### React production builds with source maps

A React production build keeps no record of which component created an element, and its component names are
minified. Two things survive: every element's props object, and every component's function. The outermost component
whose output reaches an element's props created it (also when the element was passed on as children); Chromium says
where that component's function starts in the bundle, and the source map names its file. When the build serves its
source maps (`build.sourcemap: true` in Vite, `devtool: 'source-map'` in webpack), `--verify` uses this automatically:

- an HTML element of file F must have been created by F's component;
- a component used in F (`<Button>`) must have been rendered by the component F used.

A locator that finds an element created elsewhere is verified incorrect, but only when a component of its own file is
on the page; files with a mounted component also count as shown. An element created while another component calls a
function of F (a render prop) says nothing. No source maps, or another browser than Chromium: nothing changes.
`CheckOptions.react: false` turns it off. On the real apps below this verified 100% of what it decided and left 25% and
0% unverified, against 85.4% and 77.8% without it.

## Test builds that tell: testid-scan-page/vite

A React or Vue test build can tell for certain which source line each element came from:

```ts
// vite.config.ts
import { testidSource } from 'testid-scan-page/vite';
export default defineConfig({ plugins: [process.env.E2E ? testidSource({ root: 'src' }) : null, react()] });
```

Every HTML element gets `data-tsrc="<file>:<line>"`, the line it was written at, and every component tag
`data-tsrc-use` with the line of its use (it reaches the page when the component passes its props on),
with `root` the folder you give testid-scan. `--verify` then checks a single match against its source line, and a
locator that finds nothing against whether the element of its line is on the page at all. In the corpora this leaves
about one locator in eight unverified in React and Vue, against four in ten without it.

## Real apps

`accuracy/real/` runs the verdicts on five real open-source apps (two React, one Vue, two Angular), with the page's own
evidence (data-tsrc, Angular hosts) as referee for the verdicts given without it: 113 "verified correct" and 18
"verified incorrect" without evidence, none contradicted by the referee. The React apps are also checked as production
builds with source maps: 38 "verified correct" and 11 "verified incorrect", none contradicted either. A reviewer
labelled a blind sample of 90 locators; after fixing the three bugs the review found, every verified verdict without
and with data-tsrc agrees with the reviewer, and the source-map verdicts on its React items disagree once (a locator
right in the screen the reviewer saw and wrong in another; see `accuracy/real/README.md`). The labels did not say how
they were made, so they count as "unspecified", not as independent human review. See `accuracy/real/README.md` (how to
run it, the labelling kit, `score-labels.mjs`) and `accuracy/HISTORY.md` (every version's numbers).

Without evidence, React stays the weak spot: most of its form fields sit inside components that decide whether to show
them, which static analysis cannot see through, so on bulletproof-react 85.4% of locators remain unverified. Source maps
(25%) or data-tsrc (20.8%) settle most of them.

## Does instrumenting change the app?

`npm run equivalence` (`accuracy/equivalence.mjs [--work <real apps>]`) builds nothing itself; it opens the plain and
the data-tsrc build of each app side by side and requires, on every screen, the same accessibility tree, the same text,
the same number of interactive elements and no new console errors, and no marks at all in the plain build. On the two
corpora and the three real React and Vue apps all 15 screens were identical.

## Statuses

The same names as testid-scan:

| Status | On the page |
|---|---|
| OK (name) | `getByRole(role, { name, exact: true })` matched only this element, on the page or inside its table row or list item |
| OK (test ID) | the test ID is on this element only |
| Needs test ID | the name is shared with other elements, or the element has no role a test can query |
| Missing name | it has a role but no accessible name |
| Fix test ID | its test ID is empty or on more than one visible element |
| Manual review | it only looks clickable (pointer cursor), or the browser's name does not find it |

## Options

| Option | Meaning |
|---|---|
| `--out <file>` | Markdown report (default `testid-page.md`) |
| `--json <file>` | also write the full result as JSON |
| `--attr <name>` | test ID attribute (default `data-testid`) |
| `--storage-state <file>` | a logged-in session; create one with `npx playwright codegen --save-storage=auth.json <url>` |
| `--verify <file>` | testid-scan `--json` output to run on the pages |
| `--wait <ms>` | extra wait after each page has loaded |
| `--viewport <WxH>` | window size (default `1280x800`); try `390x844` for the phone layout |
| `--headed` | show the browser |
| `--format <name>` | `text` (default) or `quiet` (one line of counts) |
| `--fail-on-todo` | exit 1 while To do > 0 |
| `--fail-on-ambiguous` | exit 1 while a `--verify` locator expected to be unique matches more than one element |
| `--fail-on-wrong-target` | exit 1 while a `--verify` locator certainly finds another element than its source line's |
| `--strict-target` | with `--fail-on-wrong-target`, also count likely wrong targets (region guess) |
| `--fail-on-incorrect` | exit 1 while a `--verify` locator is verified incorrect |
| `--min-verified <pct>` | exit 1 while fewer than `<pct>`% of the `--verify` locators have a verdict either way |
| `--summary <file>` | write the `--verify` counts (verdicts, evidence, share verified) as JSON |

Exit codes: `0` ok, `1` a gate failed, `2` wrong usage, unreachable page or no browser.

## Screens behind clicks: use it inside a Playwright test

The command line sees each URL as it is right after loading. For a dialog, a second tab or a state after login,
drive the page yourself and scan it where you are:

```ts
import { test } from '@playwright/test';
import { scanLoadedPage } from 'testid-scan-page';

test('locators on the order dialog', async ({ page }) => {
  await page.goto('/orders');
  await page.getByRole('button', { name: 'Add order' }).click();
  const result = await scanLoadedPage(page, { testIdAttribute: 'data-testid' });
  console.log(result.totals);
});
```

To verify testid-scan's locators across such states, call `checkOnPage` once per state and name it. Each call is
one observed state: evidence from one state is never used for another, even on the same URL (a dialog opened and
closed again).

```ts
import { locatorsToCheck, checkOnPage, finishVerify } from 'testid-scan-page';

const { items, skipped, selectorsByFile } = locatorsToCheck(scanJson);
await checkOnPage(page, items, selectorsByFile, { state: 'orders' });
await page.getByRole('button', { name: 'Add order' }).click();
await checkOnPage(page, items, selectorsByFile, { state: 'orders: add dialog' });
const verify = finishVerify(items, skipped);
console.log(verify.summary);
```

## Limits

- **Only what is on the screen.** Closed dialogs, collapsed menus, empty lists, other users' views and error states
  are not seen unless you bring the page there (see above).
- **No file and line.** It points to the element with a CSS path; testid-scan is the one that knows the source file.
- **Main frame only.** Elements inside iframes and inside shadow DOM are not listed yet.
- **Clickable without a role** is guessed from the pointer cursor, `onclick` and `tabindex`. Click handlers added
  from JavaScript are not visible, so a clickable `<div>` without a hand cursor is missed.
- **Row scoping** uses the first cell (table) or first line (list item) as the row's text. When that text is not
  unique, the element stays `Needs test ID`.
- **React source maps** must be reachable from the page (a `sourceMappingURL` comment; "hidden" source maps are not
  read). They tell the file of a component, not the line: two elements of one file with the same role and name are told
  apart by the locator's match count, not by this. Tried on React 18 and 19; it reads React's internal data, which a
  future React version may change (then it says nothing, it does not guess).
- Chromium only.

## Development

```bash
npm install
npx playwright install chromium
npm test              # strict type check + unit tests
npm run smoke         # pack, install the tarball into an empty folder, run the CLI and both entry points
npm run accuracy      # corpora against accuracy/baseline.json and accuracy/targets.json (needs testid-scan next to it)
npm run equivalence   # plain vs. data-tsrc builds
```

The repository's CI (`.github/workflows/ci.yml` at the root) runs the build, tests and a CLI smoke test on Node 18,
20 and 22, the clean-install smoke test, and the accuracy and equivalence checks against `../testid-scan` from the
same repository.

## License

MIT
