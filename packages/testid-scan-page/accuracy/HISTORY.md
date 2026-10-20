# Accuracy, before and after

Every number here was measured by the scripts in this folder; none is estimated. The corpora are small apps written
with known traps, so their numbers say how the tools behave on those traps, not how often the traps occur in real code.

## testid-scan (static): accuracy corpora, three frameworks

| | before the if/else fix (testid-scan 0.1) | now (testid-scan 0.2) |
|---|---:|---:|
| page-candidate locators that found exactly their element | 76.7% | 85.1% |
| false alarms ("Needs test ID" for a name unique on the page) | 10 | 3 |

## testid-scan-page --verify: accuracy corpora

| | 0.2 (counts only) | 0.4 (target check) | 0.5 and later (three verdicts) |
|---|---|---|---|
| wrong targets reported as matched | 3 of 3 | 0 of 3 | 0 |
| verified correct, really correct | — | — | 100% (27 of 27 in production builds) |
| verified incorrect, really wrong | — | — | 100% (21 of 21) |
| unable to verify, production builds | — | — | 34.2% |
| unable to verify, with data-tsrc / Angular / Vue dev | — | — | 11.5–13% |

## testid-scan-page --verify: real apps, scored by the referee (the page's own evidence)

Columns up to 0.8 are the first three apps (bulletproof-react, vue3-realworld, angular-ngrx-material-starter); 0.9 adds
conduit-react (React 19) and conduit-angular (Angular 21). The per-app rows give the first three apps in every column.

| | 0.6 first run | 0.6 after fixes | 0.7 | 0.8 | 0.9 (now, five apps) |
|---|---:|---:|---:|---:|---:|
| without evidence: verified correct, really right | 70.8% on vue3-realworld (17 of 24) | 100% (118 of 118) | 100% (111 of 111) | 100% (107 of 107) | 100% (113 of 113) |
| without evidence: verified incorrect, really wrong | 100% | 100% (11 of 11) | 100% (11 of 11) | 100% (11 of 11) | 100% (18 of 18) |
| unable without evidence: bulletproof-react / vue3-realworld / ngrx-starter | — | 39.6% / 26.2% / 29.6% | 50% / 26.2% / 29.6% | 62.5% / 26.2% / 29.6% | 85.4% / 26.2% / 29.6% |
| unable with evidence: bulletproof-react / vue3-realworld / ngrx-starter | — | 12.5% / 0% / 13% | 16.7% / 0% / 13% | 16.7% / 0% / 13% | 20.8% / 0% / 13% |
| React production build with source maps: verified correct / incorrect, really so | — | — | — | — | 100% (38 of 38) / 100% (11 of 11) |
| unable with source maps: bulletproof-react / conduit-react | — | — | — | — | 25% / 0% |

The rise of "unable" for React without evidence is the price of three fixes that removed false assurance: a single
match must be proved in every state that shows its component (0.7), states with the same URL no longer share evidence
(0.8), and JSX inside a function passed as children is no longer proved by elimination (0.9, found by the source-map
check). Source maps (0.9) bring it back down without guessing.

## Independent review of a blind sample (90 locators, 78 labelled correct or incorrect)

The labels came without a `review_type`; the scorer reports them as "unspecified", not as independent human review.

| | first round (0.6) | 0.7 and 0.8 | 0.9 |
|---|---:|---:|---:|
| without evidence: verified correct, reviewer agrees | 98.1% (51 of 52) | 100% (46 of 46) | 100% (38 of 38) |
| without evidence: verified incorrect, reviewer agrees | 100% (6 of 6) | 100% (6 of 6) | 100% (6 of 6) |
| with evidence: verified correct, reviewer agrees | 98.5% (64 of 65) | 100% (65 of 65) | 100% (65 of 65) |
| with evidence: verified incorrect, reviewer agrees | 81.8% (9 of 11) | 100% (9 of 9) | 100% (9 of 9) |
| incorrect locators verified incorrect (recall), with evidence | — | 81.8% (9 of 11) | 81.8% (9 of 11) |
| React with source maps (the labelled bulletproof-react items): verified correct / incorrect, reviewer agrees | — | — | 100% (20 of 20) / 50% (1 of 2) |
| referee agrees with the reviewer | 95.9% (70 of 73) | 100% (72 of 72) | 100% (72 of 72) |

The one source-map disagreement: update-discussion's "Submit" locator finds its own button in the update drawer (the
screen the kit showed the reviewer) and create-comment's button in the comment drawer, where update-discussion's
component is on the page too. By the rule adopted after the first review (a single match must be right in every state
that shows its component) it is incorrect; the reviewer labelled the mirror-image item, create-comment's "Submit",
incorrect for the same reason.

The fixes after the first round were checked against the same labels, so the later column is not independent of it.
A new sample (`run-real.mjs --kit 30 --kit-seed <n>`) labelled by someone else would be.
