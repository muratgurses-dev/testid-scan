# testid-scan-bdd

> **Beta (0.x).** Tested on a fixture page in Chromium with playwright-bdd; few users yet. Reports and issues are welcome.

Write Gherkin scenarios for your web app **without the source code**, with steps you know will find their element.

testid-scan-bdd reads a [testid-scan-page](../testid-scan-page) scan of your running pages and writes two files:

- **A catalog of the steps you can write on each page**, ready to copy into a `.feature` file. Every step in it
  found exactly one element when its page was scanned.
- **Step definitions for [playwright-bdd](https://github.com/vitalets/playwright-bdd)** that find each element
  the way the scan did: by role and accessible name, by test ID where that is the only way, and inside one list
  item or table row for repeated elements.

Elements no step can find yet are listed too, with the reason, so the person writing scenarios knows what to ask
the developers for.

## Quick start

```bash
npm install --save-dev @playwright/test playwright-bdd testid-scan-page testid-scan-bdd
npx playwright install chromium

npx testid-scan-page http://localhost:4200/ http://localhost:4200/cart --json scan.json
npx testid-scan-bdd scan.json
```

```
2 pages · 22 steps · 3 found by test ID · 4 not available yet
Steps: /work/app/steps/testid-scan.steps.ts
Catalog: /work/app/testid-steps.md
```

`testid-steps.md`:

```markdown
## cart

- `Given I am on the "cart" page`
- `When I click the "Remove" button in the "<item>" item` (by role and name, inside one list item, for example "Lamp", "Desk")
- `When I fill the "Gift note" field with "<text>"` (by role and name)
- `When I click the "delete all" button` (by test ID delete-all-button)
- `When I click the "Checkout" button` (by role and name)

**Not available yet.** No step can find these: fix them first (the testid-scan-page report says how), scan again and regenerate.

- button "Compare": Needs test ID: name "Compare" matches 2 elements on the page
```

A scenario written from it:

```gherkin
Feature: Cart

  Scenario: Remove an item
    Given I am on the "cart" page
    When I click the "Remove" button in the "Lamp" item
    Then I do not see the "Lamp" item
    And I see the "Checkout" button
```

`playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';

const testDir = defineBddConfig({ features: 'features/*.feature', steps: 'steps/*.ts' });

export default defineConfig({ testDir, use: { baseURL: 'http://localhost:4200/' } });
```

```bash
npx bddgen && npx playwright test
```

The page in `Given I am on the "<page>" page` is relative to `baseURL`: `"cart"`, `"#/cart"` or `"/"`, as the
catalog writes it.

## The steps

The step definitions are the same for every scan, so regenerating never breaks a feature file that uses them.
What a scan adds is the list of elements that can only be found by their test ID.

| Step | Finds |
|---|---|
| `Given I am on the "<page>" page` | opens the page |
| `When I click the "<name>" button` (also `link`, `tab`, `menu item`) | the element with this role and exact accessible name, or its test ID |
| `When I click the "<name>" button in the "<text>" item` (also `row`) | the same, inside the one list item or table row whose text contains `<text>` |
| `When I fill the "<name>" field with "<value>"` (also `in the "<text>" row`) | a text box or search box |
| `When I check the "<name>" checkbox`, `When I uncheck ...` | a checkbox |
| `When I choose the "<name>" option` | a radio button |
| `When I select "<option>" in the "<name>" dropdown` | a native `<select>` (role combobox) |
| `Then I see the "<name>" button` / `Then I do not see ...` (any kind above, also `item`, `row`) | visible / hidden or gone |
| `Then I see the text "<text>"` | any visible text |
| `Then the "<name>" checkbox is checked` / `is not checked` | its state |

**Names come from the page**, the way a screen reader announces them. An element found by test ID is written with
its accessible name when that name is unique among the elements found by test ID; otherwise with its test ID read
as words: `delete-selected-button` becomes `"delete selected"`.

**A step never acts on the wrong element.** Every locator runs in Playwright's strict mode: when a step matches
more than one element (two "Compare" buttons, or two items whose text contains "Lamp"), it fails with
`strict mode violation ... resolved to 2 elements` instead of clicking one of them.

## Limits

- A scan sees each page as it is right after loading. Elements of a dialog, a menu or a second step are in the
  catalog only if that state was scanned: drive the page there and use testid-scan-page's `scanLoadedPage()`
  inside a Playwright test. The step definitions themselves work in any state.
- `in the "<text>" item` matches the list item or row whose text **contains** `<text>`. Use text that is unique
  among the records (an order number, a full product name).
- Steps inside a record exist for buttons, links, tabs, menu items and fields. A checkbox or dropdown repeated in
  every record is listed under "Not available yet".
- `select` works with native `<select>`. A custom dropdown (Angular Material, MUI) is a button and a list of
  options: write `When I click the "<name>" button` and then click the option.
- Reads testid-scan-page results (`schemaVersion: 1`). A testid-scan result (a scan of source files) is not
  supported yet.

## Options

| Option | Meaning |
|---|---|
| `--steps <file>` | step definitions (default `steps/testid-scan.steps.ts`) |
| `--catalog <file>` | Markdown catalog of the steps per page (default `testid-steps.md`) |
| `--help`, `--version` | |

Exit codes: `0` ok, `2` wrong usage or unreadable input.

## From code

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { generate, readScan } from 'testid-scan-bdd';

const { steps, catalog, pages, testIds } = generate(readScan(JSON.parse(readFileSync('scan.json', 'utf8'))));
writeFileSync('steps/testid-scan.steps.ts', steps);
for (const page of pages) console.log(page.path, page.steps.length, page.unavailable.length);
```

## Development

```bash
npm install && npm test        # unit and command line tests
npm run e2e                    # the generated steps in Chromium with playwright-bdd (Node 20+)
npm run smoke                  # install the packed tarball into a clean folder and run it
node scripts/update-fixture.mjs  # rescan test/fixtures/shop.html with ../testid-scan-page after changing it
```

## License

[MIT](LICENSE)
