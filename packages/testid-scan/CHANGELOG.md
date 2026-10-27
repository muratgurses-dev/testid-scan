# Changelog

Versions before 1.0 were prototypes and were not published to npm. The JSON keeps `schemaVersion: 1`: fields are only
ever added. CLI options are unchanged.

## Unreleased

### Fixed
- **The Markdown report showed a repeated element's locator under Manual review without its note.** For a button in an
  `*ngFor` row with no record key, `page.getByRole('button', { name: 'Open', exact: true })` read as if it were unique,
  while on its own it matches every row (a strict-mode error in Playwright). The line now carries the locator note
  ("repeated: on its own this matches every record"), as the `--locators` section and the JSON already did. JSON and
  statuses are unchanged. Regression test in `test/output.test.ts`.

### Changed
- **A repeated element that cannot be scoped now says where its record key goes.** The reason "give the record a
  stable key" gets an example in the framework's own syntax, on the element that starts the loop:
  `(e.g. [attr.data-<entity>-id]="o.id" on the <tr> at line 5)`, `data-<entity>-id={item.id}` in React,
  `:data-<entity>-id="item.id"` in Vue. In a table the key goes on the repeated row (in Angular Material, the
  `*matRowDef` row, not the `*matCellDef` cell). A destructured record gets `<record>.id`; a loop on `<ng-container>`,
  `<ng-template>` or `<template>` gets no example, since an attribute there does not reach the DOM. The hint is not
  part of the fingerprint, so reviewed markers stay valid and moving code does not invalidate them. Statuses and
  locators are unchanged. The JSON schema is unchanged. Tests in `test/locators.test.ts`.

## 1.0.1 — 2026-10-21

- Package links (repository, homepage, issues) now point to github.com/muratgurses-dev/testid-scan. No change in behaviour.

## 1.0.0 — 2026-10-16

First public release, as open source (MIT). No change in behaviour since 0.2.1. From here on the version follows
semantic versioning: the JSON keeps `schemaVersion: 1` and only gains fields; CLI options are only added; a change that
breaks either is a new major version.

## 0.2.1 — 2026-10-15

### Fixed
- **JSX inside a function passed as children was called unconditional** (`<Form>{({ register }) => <Textarea />}</Form>`).
  The component decides when, and whether, it calls that function, as with JSX passed as a prop; such elements are now
  `conditional`. Found by testid-scan-page's React source-map check on bulletproof-react: a "Body" field inside a
  closed drawer had been taken as present, so another drawer's "Body" field was taken for it. Functions handed to
  `.map` are loops, not this case, and are unchanged. Regression test in `test/branches.test.ts`.

## 0.2.0 — 2026-10-15

### Fixed
- **The same name in two arms of one if/else or switch was reported as a duplicate** ("Needs test ID") in Angular
  (`@if/@else`, `*ngIf; else`, `@switch`, `*ngSwitchCase`), Vue (`v-if/v-else`) and React (ternary, if/else, early
  return). Only one arm is on the page at a time; such elements are now `OK (name)`, with a reason. Measured on the
  accuracy corpora: 10 false alarms before, 3 after.
- Report wording: "1 file", "1 element".

### Added (JSON, additive)
- `files[].selectors`: the element selectors of the component each Angular template belongs to.
- `elements[].conditional`: shown only under a condition — an if/else or switch arm, `*ngIf`, an `ng-template`,
  `v-if`/`v-show`, a ternary, `&&`, after an early return, JSX passed as a prop (`submitButton={<Button />}`), Vue
  named-slot content.
- `elements[].alternatives`: lines of the same element in the other arms of its if/else or switch.

These three let testid-scan-page tell which template an element came from, and avoid calling a locator wrong when
its element is simply not shown.

### Also
- README: Quick start, how it differs from lint rules, the if/else section.
- `scripts/smoke.mjs` (`npm run smoke`) and a CI step: pack, install the tarball into an empty folder, run the CLI on a
  small Angular, React and Vue project and use the API.

## 0.1.0
- First version: Angular, React and Vue scanning, statuses, recommended locators, baseline, CI gates, GitHub output.
