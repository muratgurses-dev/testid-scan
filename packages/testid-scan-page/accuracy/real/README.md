# Real-app referee run

The corpora in `accuracy/` are small apps written with known traps. This folder measures the same verdicts on real
open-source apps, where nobody has written the right answer down. The referee is the most certain evidence the page
offers:

- **data-tsrc** — React and Vue apps built with `testid-scan-page/vite`: every element carries the `file:line` it was
  written at (component tags carry the line of their use, when the component passes it on).
- **Angular component hosts** — any Angular build: the `<app-...>` element around an element names its template.

At every screen of a journey, `--verify` runs twice on the same page: once with that evidence (the referee) and once
without it, the way a plain production build is checked. React apps are served with source maps and checked a third
time, the way a production build with source maps is checked (data-tsrc ignored). The verdicts without evidence, and
with source maps, are scored against the referee, on the locators the referee can settle. A locator only counts on screens that show its component: the "Email" locator
of a login form also finds the register form's "Email" field on the register screen, which says nothing about the
login form.

## Result (testid-scan-page 0.9, 2026-10-15)

| | bulletproof-react | vue3-realworld | angular-ngrx-material-starter | conduit-react | conduit-angular |
|---|---:|---:|---:|---:|---:|
| framework | React 18 | Vue 3.5 | Angular 12 + Material 12 | React 19 | Angular 21 |
| referee evidence | data-tsrc | data-tsrc | Angular hosts | data-tsrc | Angular hosts |
| screens visited (steps failed) | 20 (1) | 10 (0) | 23 (5) | 13 (0) | 13 (0) |
| locators from testid-scan | 48 | 42 | 115 | 18 | 34 |
| settled by the referee | 37 | 42 | 74 | 18 | 34 |
| without evidence: verified correct, really right | **100%** (7 of 7) | **100%** (24 of 24) | **100%** (65 of 65) | no verdicts | **100%** (17 of 17) |
| without evidence: verified incorrect, really wrong | no verdicts | **100%** (7 of 7) | **100%** (4 of 4) | **100%** (4 of 4) | **100%** (3 of 3) |
| wrong locators caught without evidence | 0 of 4 | 7 of 9 | 4 of 4 | 4 of 7 | 3 of 5 |
| unable to verify, without evidence | 85.4% | 26.2% | 29.6% | 77.8% | 41.2% |
| unable to verify, with evidence | 20.8% | 0% | 13% | 0% | 0% |
| with source maps: verified correct, really right | **100%** (27 of 27) | | | **100%** (11 of 11) | |
| with source maps: verified incorrect, really wrong | **100%** (4 of 4) | | | **100%** (7 of 7) | |
| with source maps: wrong locators caught | 4 of 4 | | | 7 of 7 | |
| with source maps: unable to verify | 25% | | | 0% | |

Over the five apps: 113 "verified correct" and 18 "verified incorrect" verdicts without evidence, none contradicted by
the referee. The wrong locators missed without evidence were left "unable to verify", not called correct. The React
apps were also checked as production builds with source maps (component ownership from React's own data, data-tsrc
ignored): 38 "verified correct" and 11 "verified incorrect", none contradicted by the referee.

On bulletproof-react the source-map check also decided three locators the referee could not settle (a component use
whose data-tsrc-use mark is not passed on). Each was read by hand and is right: in one state the locator finds another
drawer's field or button while its own component is on the page. For one of them, create-comment's "Body" field, the
data-tsrc run had said "verified correct" by elimination; that led to the testid-scan 0.2.1 fix (JSX inside a function
passed as children is conditional). One "steps failed" on bulletproof-react ("cancel delete") varies between runs.

## Independent review (2026-10-15)

A reviewer who did not build the tools labelled the 90-item kit (`--kit 30`) without seeing the verdicts: 78 items
correct or incorrect, 12 "cannot tell". Scored with `score-labels.mjs`:

| | first round (0.6) | 0.7 and 0.8 |
|---|---:|---:|
| without evidence: verified correct, reviewer agrees | 98.1% (51 of 52) | **100%** (46 of 46) |
| without evidence: verified incorrect, reviewer agrees | 100% (6 of 6) | **100%** (6 of 6) |
| with evidence: verified correct, reviewer agrees | 98.5% (64 of 65) | **100%** (65 of 65) |
| with evidence: verified incorrect, reviewer agrees | 81.8% (9 of 11) | **100%** (9 of 9) |
| referee agrees with the reviewer | 95.9% (70 of 73) | **100%** (72 of 72) |

The reviewer was right in all three disagreements, and each was a bug:

1. **A locator proved on one screen, wrong on another.** The comment form's "Submit" found its own button on the
   comment drawer, and the edit form's "Submit" on the edit drawer, while the comment form's trigger was on screen.
   A single match must now be proved on every screen that shows its component.
2. **The referee read the wrong line.** The plugin wrote component uses into the same attribute as an element's own
   line, and a component that passes its props on overwrote it (`<table>` in bulletproof-react's table component,
   `data-testid="pagination"` in vue3-realworld). Uses now go to `data-tsrc-use`; `data-tsrc` is always the line an
   element was written at.
3. **testid-scan called a button unconditional that a component shows when it decides.** JSX passed as a prop
   (`submitButton={<Button>Submit</Button>}`) and Vue named-slot content are now marked conditional, so nothing is
   proved about them by elimination.

The fixes were checked against the same labels, so the second round is not independent of the first: a new kit, or
another reviewer, would be. The cost of the fixes: in bulletproof-react half of the locators stay unverified without
evidence (39.6% before), 16.7% with it; in 0.8, after states with the same URL stopped sharing evidence, 62.5%.

The labels came without a `review_type`, so the scorer reports them as "unspecified", not as independent human review.
Incorrect locators the tool verified incorrect (recall): 54.5% (6 of 11) without evidence, 81.8% (9 of 11) with it;
the rest stayed "unable to verify", none was called correct. Full output: `score-labels.mjs --out`.

With 0.9 the kit key also holds the source-map verdicts of the React items, and the scorer scores them: 20 of 20
"verified correct" and 1 of 2 "verified incorrect" agree with the reviewer. The disagreement is update-discussion's
"Submit": right in the update drawer the kit's screenshot shows, but it finds create-comment's button in the comment
drawer, where its own component is on the page too. Under the rule adopted after the first review (fix 1 above) that is
incorrect, and the reviewer labelled the mirror-image item (create-comment's "Submit") incorrect for that reason. The
kit now has 138 items (the two new apps added 48, not yet labelled); the 90 labelled ids are unchanged.

## Limits

- Five apps, the screens of one scripted journey each; 5 journey steps failed on angular-ngrx-material-starter (its
  screens were not reached), which is from 2021. The two Conduit apps and vue3-realworld get fixed API data.
- One journey step failed on bulletproof-react (cancel delete).
- The referee settles 205 of 257 locators. The rest — mostly locators of screens not visited, and elements shown only
  under a condition that was not met — are not scored.
- bulletproof-react was installed without its yarn.lock (it points at a registry mirror that is not reachable here), so
  its dependency versions can differ slightly from the repository's.
- "Only one file has this locator" is judged from testid-scan's locators. An element of another file with the same
  role and name but no recommended locator of its own (a library component, a template testid-scan could not read)
  can still make a shared field look distinctive.
- The referee is the tools' own evidence, read by the person who built them. The labelling kit below is for someone else
  to check it.

## Running it

```bash
WORK=../real-apps        # anywhere
git clone https://github.com/alan2207/bulletproof-react $WORK/bulletproof-react                       # 9506629
git clone https://github.com/mutoe/vue3-realworld-example-app $WORK/vue3-realworld-example-app       # 741c215
git clone https://github.com/tomastrajan/angular-ngrx-material-starter $WORK/angular-ngrx-material-starter  # 3d95daa
git clone https://github.com/TonyMckes/conduit-realworld-example-app $WORK/conduit-realworld-example-app  # 5e127d8

# React: install, add the plugin through a wrapper config, build at the root path
cd $WORK/bulletproof-react/apps/react-vite && npm install --legacy-peer-deps && cp .env.example .env
cat > vite.testid.config.ts <<'EOF'
import { mergeConfig, type UserConfig } from 'vite';
import base from './vite.config';
import { testidSource } from 'testid-scan-page/vite';
export default mergeConfig(base as UserConfig, { plugins: [testidSource({ root: 'src' })] });
EOF
npx vite build --config vite.testid.config.ts --outDir dist-tsrc --base=/

# Vue: the same wrapper config
cd $WORK/vue3-realworld-example-app && npm install --legacy-peer-deps
# (write the same vite.testid.config.ts)
npx vite build --config vite.testid.config.ts --outDir dist-tsrc

# React 19 (Conduit): the same wrapper config (vite.testid.config.js), in frontend/
cd $WORK/conduit-realworld-example-app && npm install -w frontend --legacy-peer-deps && cd frontend   # 5e127d8
npx vite build --outDir dist-plain && npx vite build --config vite.testid.config.js --outDir dist-tsrc

# React apps are measured from a data-tsrc build with source maps: the referee reads data-tsrc, the third run the maps
# (in both React folders)
npx vite build --config vite.testid.config.ts --outDir dist-tsrc-maps --sourcemap --base=/     # .js for Conduit

# Angular 21 (Conduit): its theme is a git submodule; font inlining needs Google Fonts, so it is turned off
cd $WORK && git clone https://github.com/gothinkster/angular-realworld-example-app                  # dd99ed2
cd angular-realworld-example-app && git submodule update --init --depth 1 && npm install --legacy-peer-deps --ignore-scripts
for f in $(find node_modules -path '*/esbuild/install.js'); do node $f; done
# in angular.json, production: "optimization": { "scripts": true, "styles": { "minify": true, "inlineCritical": true }, "fonts": false }
npx ng build --configuration production

# Angular 12: an old build on a current Node
cd $WORK/angular-ngrx-material-starter && npm install --legacy-peer-deps
NODE_OPTIONS=--openssl-legacy-provider npx ng build --configuration production

# then, in testid-scan-page:
node accuracy/real/run-real.mjs --work $WORK [--app vue3-realworld] [--kit 30]
```

The journeys in `journeys/` walk each app (the Vue app's API is answered with fixed data). Reports go to
`results/real.md` and `results/real.json`.

## Labelling kit: an independent check

`--kit 30` also writes `results/label-kit/`: 30 random locators per app (all of them in an app with fewer), each with its source lines, the locator, and a
screenshot of the screen where the elements it found are outlined. The verdicts are not in the kit. The seed is fixed,
so the same set comes out every run; `--kit-seed <n>` draws a new sample, which is what a second, independent round
needs.

1. Give `results/label-kit/` (index.html, the screenshots, labels.csv) to someone who did not build the tools.
2. For each item they write `correct`, `incorrect` or `cannot tell` in `label`, their name in `reviewer`, and in
   `review_type` how they reviewed: `human` (by eye, no AI), `ai-assisted` (a person decided with an AI's help) or `ai`.
   Anything else is reported as "unspecified", never as independent human review.
3. Score it:

```bash
node accuracy/real/score-labels.mjs labels.csv [second-reviewer.csv ...] [--key results/label-key.json] [--out scoring.md] [--json scoring.json]
```

The scorer checks the CSV first (header, unknown or duplicate ids, allowed labels and review types; exit 2 on errors)
and lists missing and empty rows. It then reports, with and without evidence and per framework: precision of
"verified correct" and "verified incorrect", false assurance and false alarm rates, recall of incorrect locators,
the share left unverified, coverage, a confusion matrix, and agreement with the referee. "cannot tell" is never
counted as right or wrong. With two or more files it adds Cohen's kappa between reviewers.
