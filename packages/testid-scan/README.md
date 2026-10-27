# testid-scan

Reads your **Angular templates**, **React components** and **Vue single-file components** and tells you, element by element, whether a UI
test can already find it by **role and accessible name**, or whether it needs a **test ID** or a **name**
first.

It follows the locator advice of Playwright and Testing Library: use `getByRole` where the element has a
role and a unique name, and add `data-testid` only where that is not possible.

- Read-only. It never changes a source file.
- Does not need your project to build or run.
- Angular Material, the common React component names (`Button`, `TextField`, `IconButton`, ...) and the
  usual Vue libraries (Vuetify, Element Plus, Quasar, Vue Router) are known out of the box; other
  libraries are added through a config file.
- Static analysis. It reads source files, not the running application. See [Limits](#limits).

**How it differs from lint rules.** ESLint plugins such as `jsx-a11y`, `angular-eslint`'s template rules and
`eslint-plugin-testing-library` check rules inside one framework. testid-scan works the same way across Angular,
React and Vue, and for every interactive element it answers the question a test author has: *which Playwright
locator finds this element, and is it unique?* It also enforces a test ID naming policy and lets an existing
project start from a baseline, so CI fails only on new findings.

## Quick start

```bash
npx testid-scan src
```

You get a list of what to fix, by file and line, and a report in `testid-status.md`:

```
src/app/orders/order-list.component.html
     3  Missing name   button (no name): no accessible name (add visible text, a label or aria-label)
     9  Fix test ID    link orders-open-link: same test ID on every repeated element (build the ID from the record, or add data-<entity>-id to it or its row)
    12  Needs test ID  button "Select": clickable <div> has no role: use <button> / <a href>, or add role + tabindex, or add a test ID (suggestion: select-button)

3 to do · 1 to review · 3 ok · 1 test ID violations · 1 file
```

Add `--locators` to see the recommended Playwright locator of every element. To use it in CI on a project that
already has findings, save them once and fail only on new ones:

```bash
npx testid-scan src --baseline testid-baseline.json --update-baseline   # once, commit the file
npx testid-scan src --baseline testid-baseline.json --format github --fail-on-todo   # in CI
```

The rest of this page is reference: [statuses](#what-the-statuses-mean), [locators](#recommended-locators),
[config](#config-file), [CI](#in-ci) and [limits](#limits).

## Install

```bash
npm install --save-dev testid-scan
```

Requires Node 18 or newer. The only dependency is `typescript`, used as the parser for React's JSX.

## Use

```bash
npx testid-scan src
```

This prints what is left to do, by file and line, and writes the full report to `testid-status.md`:

```
src/orders/order-list.component.html
    42  Needs test ID  button "Edit": name "Edit" appears more than once in the repeated block
    57  Missing name   button (no name): no accessible name (add visible text, a label or aria-label)

2 to do · 5 to review · 118 ok · 0 test ID violations · 42 files
Report: /work/app/testid-status.md
```

Elements that are fine are counted, not listed. The report in `testid-status.md` goes file by file: what to do
(with the fix, and a suggested test ID where one fits), what to check in the browser, and which elements are OK,
with accessibility notes next to the element they belong to. Files with nothing to do share one line; the totals
and a short guide to the statuses come last:

```markdown
## app/orders/order-list.component.html (4 to do, 1 to review)

**To do (4)**

- L10 `<div>` "Select": clickable `<div>` has no role: use `<button>` / `<a href>`, or add role + tabindex, or add a test ID · suggested test ID: `select-button`
- L11, L12 `<button>` "Delete": name "Delete" appears more than once · give each one its own test ID
- L13 `<button>`: no accessible name (add visible text, a label or aria-label)

**To review in the browser (1)**

- L7 `<button>` "Open": repeated element: scope the locator to a unique parent, or give the record a stable key · locator: `page.getByRole('button', { name: 'Open', exact: true })` (repeated: on its own this matches every record) · fingerprint `079cb9c2`

**OK (4):** L2 `<input>` placeholder "Search orders", L3 `<button>` "Refresh", L4 `<table>`, L14 `<button>` "Export"

- L2 `<input>` placeholder "Search orders": accessibility: has a placeholder but no label: the placeholder disappears on input and is not a substitute for a label
```

`--detailed` gives the layout of 1.0 instead: one section per status for the whole scan (to-dos grouped by the
work they need, violations, manual review, accessibility findings), every section shown even when empty, and the
counts per folder and file.

The framework is taken from the nearest `package.json` (`@angular/core`, `react` or `vue`). If it names
none of them, all kinds of files are scanned.

| Option | Meaning |
|---|---|
| `--out <file>` | Markdown report (default `testid-status.md`) |
| `--json <file>` | also write the full result as JSON |
| `--locators` | list the recommended locator of every element in the report |
| `--detailed` | Markdown report in the full layout: one section per status for the whole scan |
| `--config <file>` | config file (default: `testid-scan.config.json` in the current folder, if present) |
| `--framework <name>` | `angular`, `react`, `vue` or `auto` (default) |
| `--prefixes <a,b>` | allowed first word(s) of a test ID |
| `--attr <name>` | test ID attribute (default `data-testid`) |
| `--i18n <file>` | translation JSON; translated keys are resolved to their text |
| `--strict` | require a test ID on every element |
| `--require-suffix` | require test IDs to be `<context>-<type>` and end in a known type (`orders-save-button`) |
| `--baseline <file>` | compare with a saved baseline: only findings that are not in it are listed and fail the gates |
| `--update-baseline` | write the current findings to the `--baseline` file |
| `--format <name>` | terminal output: `text` (default), `github` (annotations for GitHub Actions) or `quiet` (one line of `key=value` counts) |
| `--all-html` | Angular: scan every `*.html` file, not only component templates |
| `--no-inline` | Angular: do not scan inline templates in `*.ts` files |
| `--fail-on-todo` | exit 1 while To do > 0 or Violations > 0 |
| `--fail-on-review` | exit 1 while Manual review > 0 |

Exit codes: `0` ok, `1` a `--fail-on-*` gate failed, `2` wrong usage or unreadable input.

### Which files are read

| | Read | Left out |
|---|---|---|
| Angular | `*.component.html`, any `.html` named by a component's `templateUrl`, inline `template:` strings in `*.ts` | other `*.html` (listed in the report; `--all-html` includes them) |
| React | `*.tsx`, `*.jsx` (add `.js` with `reactExtensions`) | `*.test.*`, `*.spec.*`, `*.stories.*`, files without JSX |
| Vue | the `<template>` block of `*.vue` | Pug templates, external `src=` templates, render functions (listed in the report) |

`node_modules`, `dist`, `build`, `coverage`, `__tests__` and similar folders are skipped (`ignoreDirs`).

## What the statuses mean

| Status | Meaning | What to do |
|---|---|---|
| OK (name) | Has a role and a fixed name that is unique in its file. | Use `getByRole(role, { name, exact: true })`. |
| OK (test ID) | Has a test ID that follows the rules (or, for a row, a record key attribute). | Use `getByTestId(...)`. |
| Needs test ID | No role, no usable name, or the name is not unique. | Add a test ID, or fix the markup (`<button>` instead of a clickable `<div>`). |
| Missing name | Has a role but no accessible name and nothing else to go by, e.g. an icon-only button. | Add visible text, a label or `aria-label`. This is also an accessibility defect. |
| Fix test ID | Has a test ID, but it breaks a rule: duplicated, the same on every repeated record, or badly named. | Fix the ID. The reason lists what is wrong. |
| Manual review | The scanner cannot decide from the source: dynamic name, dynamic test ID, repeated element, `title`-only name, unknown clickable component, a button or link that contains another interactive element. | Check in the browser, then fix it or mark it reviewed. |
| OK (reviewed) | A Manual review item that someone acknowledged with a marker. | Nothing. It is counted separately because the scanner did not verify it. |

**To do** = Needs test ID + Missing name + Fix test ID.

`getByRole` matches a name as a case-insensitive substring by default, so `{ name: 'Save' }` also finds a
"Save draft" button. The scanner compares whole names; when one name is part of another in the same file,
the reason says to use `exact: true`.

Every element has exactly one status. An element is only OK when the scanner found nothing wrong with it
in the source; that is still a prediction, not a check in the browser.

**Violations** counts every test ID that breaks a rule. Most of them are the "Fix test ID" elements; the
rest are badly named dynamic IDs that are under Manual review for another reason.

## Recommended locators

Every element gets a Playwright locator when one can be written from the source:

```ts
page.getByRole('button', { name: 'Delete', exact: true });
page.getByLabel('Email', { exact: true });
page.getByTestId('orders-save-button');
page.getByTestId('orders-row-<order.id>').getByRole('button', { name: 'Delete', exact: true });
```

- An element with a usable test ID is located by it; otherwise by role and name. Form controls go by label,
  because their role depends on the input type (a number field is a `spinbutton`, a password field has none).
- Names are always matched with `exact: true`.
- `<order.id>` marks a value that only exists at runtime. Nothing is invented for it.
- `locatorNote` says what to know first: "review required", "fix the test ID first", "the name is a
  translation key", "located by its placeholder".
- With a test ID attribute other than `data-testid`, set `testIdAttribute` in your Playwright config, or
  `getByTestId` will not find anything.

A recommendation is written from the source and has never been run. It is not proof that the locator
matches exactly one element on the page.

In JSON every element has `recommendedLocator` (when there is one), `locatorNote` and `locatorScope`. The
Markdown report shows locators next to Manual review items; `--locators` adds the full list.

### Locator scope

| `locatorScope` | Meaning |
|---|---|
| `page-candidate` | Expected to match one element. Checked within its own file only, not on the rendered page. |
| `record-scoped` | Only meaningful inside one record (a row, a list item). The locator starts at the record. |
| `unknown` | No locator could be recommended, or its reach cannot be told from the source. |

A fixed test ID inside a keyed row keeps its status, OK (test ID), and is `record-scoped`: the same ID
exists once per row, so the locator is chained to the row.

## Accessibility findings

Reported next to the status, not instead of it. A button with a valid test ID and no name is OK (test ID)
for a test, and still unusable with a screen reader; it appears in both places.

| Rule | Meaning |
|---|---|
| `missing-name` | An interactive element has no accessible name. |
| `placeholder-only` | A form field has a placeholder but no label. A test can find a text field with `getByPlaceholder`, so its status is OK (name); a user loses the hint as soon as they type, so it is listed here. A select with only a placeholder goes to Manual review. |
| `no-role` | A clickable `<div>` or `<span>`: assistive technology does not announce it as a control. |
| `nested-interactive` | A button or link contains another button, link or field. |
| `title-only` | Named only by its `title` attribute. |

Each finding is `confirmed` (visible in the source) or `needs-review` (rests on an assumption, for example
that an unknown React component renders no text). An element whose name is set at runtime gets no finding:
unknown is not the same as missing.

Findings are counted as "A11y findings" (elements with at least one confirmed finding). They are not part
of To do and do not affect `--fail-on-todo`. This is a by-product of the name analysis, not an accessibility
audit: it does not look at contrast, focus order, ARIA misuse or anything outside the elements it scans.

### Naming rules for test IDs

Always checked:

- kebab-case (`orders-save`, not `ordersSave` or `Orders_Save`)
- starts with an allowed prefix, when `prefixes` is set
- no repeated word (`orders-orders-button`)
- not used twice in one file
- inside a loop, not the same fixed ID on every record

Only with `"requireTypeSuffix": true` (or `--require-suffix`), for teams that name IDs `<context>-<type>`:

- at least two words, for example `orders-save-button`
- ends with an allowed type suffix (`button`, `input`, `table`, `dialog`, ... see `suffixes`)
- the suffix fits the element: a button named `orders-save-table` is reported

For a dynamic ID such as `'orders-row-' + order.id`, the fixed part (`orders-row`) is checked.

### Repeated elements

Anything inside a loop is rendered once per record, so a fixed name or ID is not unique on the page.
Loops are `*ngFor`, `@for`, table cells and virtual scroll in Angular, `.map()` / `.flatMap()` /
`Array.from()` callbacks, cell renderers in a column list (`columns={[{ cell: ... }]}`) and row render
props (`renderItem`) in React, and `v-for` in Vue. The scanner accepts either of these:

```html
<!-- Angular: the test ID is built from the record -->
<tr mat-row *matRowDef="let row; columns: cols" [attr.data-testid]="'orders-row-' + row.id"></tr>

<!-- or the record carries a key attribute (data-<entity>-id / data-<entity>-key) -->
<li *ngFor="let order of orders" [attr.data-order-id]="order.id"> ... </li>
```

```tsx
// React
{orders.map((order) => (
  <tr key={order.id} data-testid={`orders-row-${order.id}`}> ... </tr>
))}
```

```html
<!-- Vue -->
<tr v-for="order in orders" :key="order.id" :data-testid="`orders-row-${order.id}`"> ... </tr>
```

Elements inside such a record are then OK, because a test can narrow down to the record first:

```ts
page.getByTestId('orders-row-42').getByRole('button', { name: 'Delete' });
```

An ID built from the loop index is sent to Manual review, because it changes when the list is reordered.
In nested loops the ID has to use the record of the innermost loop: one built only from the outer record
repeats for every inner item and goes to Manual review too.

### Components used more than once

A file on its own does not show that its component is rendered ten times. After reading every file the
scanner looks at how components use each other:

- a component rendered inside a loop in another file (`<OrderRow v-for>`, `orders.map(o => <OrderRow />)`,
  `<app-order-row *ngFor>`) repeats everything inside it;
- so does a component used twice in one parent, and any component nested inside a repeated one;
- an input that carries the record (`:order="order"`, `[order]="order"`, `order={order}`) counts as the
  record inside the component, so `orders-row-${order.id}` there is a keyed ID.

Components are matched by name: the file name in Vue, the selector in Angular, the function name in React.
A name defined in two files is left alone. Alternatives are not counted as two instances: `v-if` with its
`v-else`, the two arms of a ternary, switch cases, routes. Two separate `v-if` or `*ngIf` usages are
counted, even if their conditions happen to exclude each other. Switch the whole pass off with
`"followComponents": false`.

An ID built from `order.id` is accepted on the assumption that the value is unique. The scanner cannot
check that; the reason says so.
The `key` of React and Vue does not count: it is not rendered into the page.

### Wrapper components

Many projects draw their buttons and links through a component of their own:

```vue
<!-- AppLink.vue -->
<RouterLink :aria-label="props.name" :to="props"><slot /></RouterLink>
```

A component counts as a wrapper when it renders exactly one button, link, menu item or tab and either shows
inside it what it is given (`<slot>`, `<ng-content>`, `{children}`) or names it from one of its props
(`aria-label` bound to a prop). Every place the wrapper is used is then listed as that button or link, in the
file where it is used, named by what is passed in. The element inside the wrapper is not listed a second
time, unless it carries a test ID.

The reason of such a record says `rendered by <AppLink> in ...`. A component with two or more controls is
not a wrapper; its controls are listed in its own file as before. Switched off together with
`"followComponents": false`.

### The same name in two components

A name can be unique in its file and still occur twice on the page: a "Home" link in the top bar and another
in the footer. After reading all files the scanner looks for the same role and name in another component
that can be drawn at the same time, and reports such an element as `Manual review` instead of `OK (name)`,
with the place of the other one in the reason.

Two components count as drawn together when one contains the other, when a third contains both, or when one
of them belongs to the frame around the routed pages (the component with `<router-outlet>`, `<RouterView>`
or `<Outlet>` and what it always shows). Alternatives are left out: else branches, switch cases, routes.
Two pages reached by different routes are not compared.

This is read from the source, so it errs in both directions: two `v-if` blocks that never show together are
still compared, and components put on the page from code (dialogs opened by a service) are not seen.
Switched off together with `"followComponents": false`.

### The same name in an if/else or a switch

Within one file, the same role and name in two arms of one if/else chain or switch is not a duplicate: only
one arm is on the page at a time, so the locator still finds one element. Such elements are `OK (name)`, with
a reason that says so. The same applies to a fixed test ID used in both arms.

| Framework | Seen as alternatives |
|---|---|
| Angular | `@if` / `@else if` / `@else`, `@switch` / `@case` / `@default`, `*ngIf="x; else other"` with `<ng-template #other>`, `*ngSwitchCase` / `*ngSwitchDefault` under one `[ngSwitch]` |
| Vue | a `v-if` / `v-else-if` / `v-else` chain of sibling elements |
| React | the two sides of `a ? <X/> : <Y/>`, `if` / `else`, and an `if` that returns early with what follows it |

Not seen as alternatives: two separate `@if` or `v-if` blocks, `a && <X/>` next to `!a && <Y/>`, and
conditions that exclude each other only by their meaning. Those are still reported as duplicates.

### Marking a Manual review item as checked

Put this comment directly before the element:

```html
<!-- Angular and Vue -->
<!-- testid-scan: reviewed -->
<button>{{ dynamicLabel }}</button>
```

```tsx
{/* React */}
{/* testid-scan: reviewed */}
<button>{dynamicLabel}</button>
```

The marker only moves a Manual review item to OK (reviewed). It never hides Needs test ID, Missing name,
Fix test ID or a violation. It records that a person looked at the element; the scanner still has not
verified it.

**Noticing later changes.** Every Manual review item in the report has a fingerprint: a short hash of its
tag, kind, name, test ID and the reason it needs review. Put it in the comment:

```html
<!-- testid-scan: reviewed 3fa9c1d2 -->
```

When the element changes in one of those respects, the fingerprint no longer matches and the item goes back
to Manual review, with the new fingerprint in the reason. Moving the element or changing its classes does
not affect it. A marker without a fingerprint keeps working, but cannot go out of date.

## React specifics

- **HTML elements** get their role from the tag, as in the browser.
- **Components** are only understood when the scanner knows what they are. A default list covers the
  conventional names (`Button`, `IconButton`, `Link`, `TextField`, `Select`, `Checkbox`, `Switch`,
  `MenuItem`, `Tab`, `Table`, `TableRow`, ...). Add your own in the config:

  ```json
  { "components": { "PrimaryButton": "button", "FormInput": { "kind": "input", "nameProps": ["label"] } } }
  ```

- **An unknown component with `onClick`** goes to Manual review: it may render a button or a div.
- **Icons**: `<svg>`, components named `...Icon`, and any self-closing component whose output is unknown
  are taken to render no text. So `<button><Trash2 /></button>` is reported as Missing name, and the reason
  names the assumption. Change the pattern with `iconNamePattern`.
- **Spread props** (`<button {...props} />`): the name may come from them, so an otherwise nameless element
  goes to Manual review instead of Missing name.

## Vue specifics

- **HTML elements** get their role from the tag. A tag written in lowercase without a hyphen is HTML;
  anything else is a component.
- **Components** are matched whether written `v-btn` or `VBtn`. Defaults cover Vue Router, Vuetify, Element
  Plus and Quasar; add your own under `components` (the same key as for React).
- **An unknown component with `@click`** goes to Manual review.
- **Conditional and bound content**: text inside a child with `v-if` / `v-else` / `v-show`, and content set
  with `v-text` / `v-html`, make the name dynamic.
- A label can come from a wrapper's attribute: `<el-form-item label="Country">` names the control inside
  it (`formFields`, written as `"el-form-item": "@label"`).

## Translations

A fixed key is treated as a fixed name and shown by its key:

```html
{{ 'ORDERS.SAVE' | translate }}        <!-- Angular -->
```
```tsx
{t('orders.save')}  <Trans i18nKey="orders.save" />   // React
```
```html
{{ $t('orders.save') }}                <!-- Vue -->
```

Pass the translation file to check the real text:

```bash
npx testid-scan src --i18n src/assets/i18n/en.json
```

With a translation file, the scanner also reports keys that are missing from it and two different keys that
resolve to the same text in one file. A translation with parameters (`t('orders.delete', { id })`) is
dynamic and goes to Manual review.

Pipe, function and component names are set with `translatePipes`, `translateFunctions` and
`translateComponents`.

## Config file

Create `testid-scan.config.json` next to where you run the command (or pass `--config`). All keys are
optional. A complete example is in `testid-scan.config.example.json`.

| Key | Default | Meaning |
|---|---|---|
| `framework` | `auto` | `angular`, `react`, `vue` or `auto`. |
| `testIdAttribute` | `data-testid` | Attribute that holds the test ID. |
| `prefixes` | `[]` (any) | Allowed first words of a test ID. |
| `requireTypeSuffix` | `false` | Require `<context>-<type>` IDs that end in one of `suffixes`. A team convention, so off by default. |
| `suffixes` | `button`, `link`, `input`, ... | Allowed last words, used with `requireTypeSuffix`. |
| `suffixesByKind` | see `src/config.ts` | Which suffixes fit which kind of element. |
| `checkSuffixMatchesKind` | `true` | Report a suffix that belongs to another kind of element. |
| `i18nFile` | none | Translation JSON file. |
| `iconTags` | `mat-icon`, `svg`, `v-icon`, `el-icon`, `q-icon`, ... | Tags that are decorative icons and never part of a name. |
| `placeholderAsLabel` | `auto` | Angular Material before 15 renders a field's placeholder as its label. `auto` reads the version from `package.json`; `always` / `never` override it. |
| `formFields` | `mat-form-field` / `mat-label`, `FormControl` / `InputLabel`, `el-form-item` / `@label` | Form field wrapper and the tag (or `@attribute`) that holds its label. |
| `ignoreDirs` | `node_modules`, `dist`, `build`, ... | Folders that are skipped. |
| `followComponents` | `true` | Look across files for components rendered in a loop or more than once. |
| `strict` | `false` | Same as `--strict`. |
| **Angular** | | |
| `elements` | Angular Material tags | Tag name to kind. |
| `attributes` | Angular Material attributes | Attribute name to kind, e.g. `{ "pButton": "button" }`. |
| `translatePipes` | `translate`, `transloco`, `i18n` | Pipes that translate a fixed key. |
| `repeatDirectives` | `*ngFor`, `*matRowDef`, `*matCellDef`, ... | Structural directives that repeat their host. |
| `allHtml`, `inlineTemplates` | `false`, `true` | Same as `--all-html` and `--no-inline`. |
| **React and Vue** | | |
| `components` | conventional names | Component name to kind, or `{ kind, nameProps }`. `nameProps` defaults to `["label"]`. Case-sensitive in React; `v-btn` and `VBtn` are the same entry in Vue. |
| `translateFunctions` | `t`, `$t`, `i18n.t`, `i18next.t` | Functions that translate a fixed key. |
| **React** | | |
| `translateComponents` | `Trans` / `i18nKey`, `FormattedMessage` / `id` | Translation components and the prop holding the key. |
| `iconNamePattern` | `Icon$` | Components matching this regular expression are icons. |
| `reactExtensions` | `.tsx`, `.jsx` | File extensions that contain JSX. |
| `cellRenderers` | `cell`, `Cell`, `render`, `renderCell`, ... | Property names of cell renderers in a column list. |
| `rowRenderProps` | `renderItem`, `renderRow`, `itemContent`, ... | Props that take a function rendering one row or item. |

Lists replace the default. Maps (`elements`, `attributes`, `components`, `formFields`, `suffixesByKind`,
`translateComponents`) are merged into the default; set an entry to `""` to remove it.

Kinds are: `button`, `link`, `input`, `select`, `option`, `checkbox`, `radio`, `toggle`, `tab`, `step`,
`header`, `heading`, `table`, `row`, `menu-item`, `message`, `spinner`. `input` and `select` are named by
their label; the others by their content.

## In CI

```yaml
- run: npx testid-scan src --fail-on-todo
```

`--fail-on-todo` fails on missing test IDs, missing names and naming violations. `--fail-on-review` is a
separate, stricter gate for unresolved Manual review items. Start with the first; add the second when the
review list is empty.

### Starting on an existing project: the baseline

A project that has never been scanned starts with a long list, and nobody wants a red build on day one.
Save today's findings once and commit the file:

```bash
npx testid-scan src --baseline testid-baseline.json --update-baseline
```

From then on the gate fails only on findings that are not in the baseline:

```yaml
- run: npx testid-scan src --baseline testid-baseline.json --fail-on-todo
```

The report and the terminal show what is new and how many old findings are gone. A finding is recognised by
its file, element, name, test ID and status, not by its line, so moving code does not make it new. Run
`--update-baseline` again after fixing things, so that fixed findings cannot come back unnoticed.

### GitHub Actions

`--format github` prints each to-do (and each item to review, as a notice) as an annotation, so it shows up
next to its line in the pull request:

```yaml
- run: npx testid-scan src --baseline testid-baseline.json --format github --fail-on-todo
```

### Reading the output from a script

Use `--json`: the result carries `schemaVersion` (now `1`), which is raised when a field is renamed or
removed. `--format quiet` prints one line of `key=value` counts.

For Angular templates, `files[].selectors` lists the element selectors of the component each template belongs to
(`app-home`). testid-scan-page uses it to tell, on the running page, which template an element came from.

`elements[].conditional` is true when an element is shown only under a condition: an if/else or switch arm, `*ngIf`,
an `ng-template`, `v-if` / `v-show`, a ternary, `&&`, after an early return, JSX passed to a component as a prop
or inside a function passed as children (`<Form>{({ register }) => <Input />}</Form>`), or Vue named-slot content. An element like that can be absent from
a page without anything being wrong, which testid-scan-page needs to know before it calls a locator incorrect.

## From code

```ts
import { writeFileSync } from 'node:fs';
import { scan, scanTemplate, scanJsx, scanVue, renderMarkdown, renderText, createBaseline, compareWithBaseline } from 'testid-scan';

const result = scan('src', { prefixes: ['orders'] });
console.log(result.totals.todo);
writeFileSync('report.md', renderMarkdown(result, { locators: true }));   // { detailed: true } for the 1.0 layout

for (const e of result.elements) {
  e.recommendedLocator;      // "page.getByRole('button', { name: 'Save', exact: true })"
  e.locatorScope;            // 'page-candidate' | 'record-scoped' | 'unknown'
  e.accessibilityFindings;   // [{ rule: 'missing-name', certainty: 'confirmed', message: '...' }]
}

// a single Angular template, React source or Vue single-file component
scanTemplate('<button><mat-icon>add</mat-icon></button>')[0].status;        // 'Missing name'
scanJsx('export const A = () => <button><AddIcon /></button>;')[0].status;  // 'Missing name'
scanVue('<template><v-btn icon="mdi-plus" /></template>')[0].status;         // 'Missing name'
```

## Limits

The scanner reads source files. It does not run your application, so:

- **It cannot prove a locator is unique on a page.** It checks one file at a time. Two components rendered
  together can still share a name. The same fixed test ID in two files is listed in the report, but not
  counted as a violation.
- **Names are approximated.** The order is `aria-labelledby`, `aria-label`, content or label, `title`.
  `aria-hidden="true"` and the `hidden` attribute are respected; CSS (`display: none`), `aria-describedby`
  and names set from code are not seen.
- **Components are followed by name only.** Usage in a loop or twice in one parent is seen (see
  "Components used more than once"). Not seen: components imported under another name, components that
  two different pages happen to render together, and anything passed around as a value. A React component
  passes `data-testid` on only if it is written to; the scanner assumes it does.
- **React**: helper functions that return JSX and are called inside `.map()` are not seen as repeated.
  `styled.button` and other wrappers are components to the scanner and need a `components` entry.
- **Vue**: Pug templates, render functions and JSX inside Vue projects are not read. Scoped slots that
  repeat their content (a data table's `#item` slot) are not seen as loops.
- **Angular and Vue** templates are read with a small built-in parser, not the framework's compiler. Unusual markup can
  be misread; a literal `<` followed by a letter in plain text is the known case. Inline templates are
  scanned when they are a plain string; one containing `${...}` is listed under "Not scanned".
- **Elements that are not interactive** (plain text, images, headings) are reported only when they carry a
  test ID.

## Adding another framework

The core (`src/classify.ts`, `src/testid.ts`, `src/report.ts`) knows nothing about any framework. An
adapter turns one source file into a list of `Candidate` objects (`src/types.ts`): tag, line, parent,
surrounding loops, kind, accessible name, test ID. `src/vue/adapter.ts` is the shortest example: it reuses
the template reader in `src/html/` and only describes what is Vue-specific.

## Development

```bash
npm install
npm test          # compiles the tests, then runs them; works on every supported Node version
npm run test:src  # runs the TypeScript sources directly, without compiling; needs Node 22.18+
npm run build     # compiles to dist/
```

CI (`.github/workflows/ci.yml`) builds and tests on Node 18, 20, 22 and 24.

## License

MIT
