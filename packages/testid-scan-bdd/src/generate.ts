/**
 * From a page scan to Gherkin: a catalog of the steps a scenario can use on each page, and the step definitions
 * behind them. The step definitions are the same for every scan; what a scan adds is the list of elements that can
 * only be found by their test ID, and the catalog.
 */
import type { CatalogPage, CatalogStep, Generated, PageScan, ScannedElement } from './types.ts';

/** How a scenario names each kind of element, and the ARIA roles that kind stands for. */
export const NOUNS: Record<string, string[]> = {
  button: ['button'],
  link: ['link'],
  tab: ['tab'],
  'menu item': ['menuitem'],
  field: ['textbox', 'searchbox'],
  checkbox: ['checkbox'],
  option: ['radio'],
  dropdown: ['combobox'],
};
/** Records a step can narrow down to: a list item or a table row, by the text in it. */
export const RECORDS: Record<string, string> = { item: 'listitem', row: 'row' };

/** Kinds of element that have a step inside a record ("When I click the "Remove" button in the "Lamp" item"). */
const RECORD_STEPS = new Set(['button', 'link', 'tab', 'menu item', 'field']);
const NOUN_OF_ROLE = new Map(Object.entries(NOUNS).flatMap(([noun, roles]) => roles.map((role) => [role, noun] as const)));
const RECORD_OF_ROLE = new Map(Object.entries(RECORDS).map(([noun, role]) => [role, noun] as const));
const OK = new Set(['OK (name)', 'OK (test ID)', 'OK (reviewed)']);

/** "#/cart" for http://host/#/cart: the page relative to the site root, as `page.goto` takes it with a baseURL. */
export function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname.replace(/^\//, '')}${u.search}${u.hash}` || '/';
  } catch {
    return url;
  }
}

/** The text of a single-quoted JavaScript string literal, as testid-scan-page writes them. */
const unquote = (literal: string) => literal.replace(/\\n/g, '\n').replace(/\\(['\\])/g, '$1');

/** page.getByRole('listitem').filter({ hasText: 'Lamp' }).getByRole(...): the record a locator narrows down to. */
export function recordOf(locator: string): { role: string; text: string } | undefined {
  const m = /^page\.getByRole\('(listitem|row)'\)\.filter\(\{ hasText: '((?:[^'\\]|\\.)*)' \}\)\./.exec(locator);
  return m ? { role: m[1], text: unquote(m[2]) } : undefined;
}

/** "delete selected" for delete-selected-button: a test ID read as words, without the kind at its end. */
export function testIdWords(testId: string): string {
  return testId.replace(/[-_](button|btn|link|input|field|select|checkbox|tab|item)$/i, '').replace(/[-_]+/g, ' ').trim();
}

function sentence(noun: string, name: string, record?: { noun: string; text: string }): string {
  const within = record ? ` in the "${record.text}" ${record.noun}` : '';
  if (noun === 'field') return `When I fill the "${name}" field${within} with "<text>"`;
  if (noun === 'dropdown') return `When I select "<option>" in the "${name}" dropdown`;
  if (noun === 'checkbox') return `When I check the "${name}" checkbox`;
  if (noun === 'option') return `When I choose the "${name}" option`;
  return `When I click the "${name}" ${noun}${within}`;
}

/**
 * The name a step uses for an element that is found by its test ID: its accessible name when that is the same
 * element everywhere it was seen, otherwise the test ID read as words ("delete selected").
 */
function testIdNames(scan: PageScan): Map<ScannedElement, string> {
  const byTestId = scan.pages.flatMap((p) => p.elements).filter((e) => OK.has(e.status) && e.testId && e.locator?.startsWith('page.getByTestId('));
  const idsOfName = new Map<string, Set<string>>();
  for (const e of byTestId) {
    if (!e.name) continue;
    const key = `${NOUN_OF_ROLE.get(e.role)}:${e.name}`;
    idsOfName.set(key, (idsOfName.get(key) ?? new Set()).add(e.testId as string));
  }
  return new Map(byTestId.map((e) => {
    const unique = e.name && idsOfName.get(`${NOUN_OF_ROLE.get(e.role)}:${e.name}`)?.size === 1;
    return [e, unique ? e.name : testIdWords(e.testId as string)];
  }));
}

export function generate(scan: PageScan): Generated {
  const names = testIdNames(scan);
  const testIds: Record<string, string> = {};
  const pages: CatalogPage[] = [];

  for (const page of scan.pages) {
    const steps = new Map<string, CatalogStep>();
    const unavailable = new Map<string, { element: string; reason: string }>();
    // A list item's text is its first line, which can include the names of the controls in it: "LampAdd to cartDetails".
    const controlsIn = new Map<string, string[]>();
    for (const e of page.elements) {
      const r = e.locator && recordOf(e.locator);
      if (r && e.name) controlsIn.set(r.text, [...(controlsIn.get(r.text) ?? []), e.name]);
    }
    const recordName = (text: string) => (controlsIn.get(text) ?? []).reduce((t, n) => t.replace(n, ' '), text).replace(/\s+/g, ' ').trim() || text;

    for (const e of page.elements) {
      const noun = NOUN_OF_ROLE.get(e.role);
      if (!OK.has(e.status) || !e.locator || !noun) {
        // an element without a role is a finding only when the scan says so; a heading or an image is not one
        if (!OK.has(e.status) && (noun || !e.role)) {
          const element = noun ? `${noun} "${e.name || '(no name)'}"` : 'element without a role';
          const reason = `${e.status}${e.reason ? `: ${e.reason}` : ''}`;
          unavailable.set(`${element}|${reason}`, { element, reason });
        }
        continue;
      }
      const record = recordOf(e.locator);
      const recordNoun = record && RECORD_OF_ROLE.get(record.role);
      if (record && recordNoun && !RECORD_STEPS.has(noun)) {
        const element = `${noun} "${e.name}"`;
        const reason = `repeated: found inside one ${recordNoun === 'item' ? 'list item' : 'table row'}, and there is no step for a ${noun} in a record yet`;
        unavailable.set(`${element}|${reason}`, { element, reason });
        continue;
      }
      if (record && recordNoun) {
        const text = sentence(noun, e.name, { noun: recordNoun, text: `<${recordNoun}>` });
        const step = steps.get(text) ?? { text, how: `by role and name, inside one ${recordNoun === 'item' ? 'list item' : 'table row'}`, examples: [] };
        const example = recordName(record.text);
        if (!step.examples?.includes(example)) step.examples?.push(example);
        steps.set(text, step);
        continue;
      }
      const alias = names.get(e);
      if (alias !== undefined && e.testId) {
        testIds[`${e.role}:${alias}`] = e.testId;
        const text = sentence(noun, alias);
        steps.set(text, { text, how: `by test ID ${e.testId}` });
        continue;
      }
      const text = sentence(noun, e.name);
      if (!steps.has(text)) steps.set(text, { text, how: 'by role and name' });
    }
    pages.push({
      path: pathOf(page.url),
      title: page.title,
      steps: [...steps.values()],
      unavailable: [...unavailable.values()],
    });
  }

  return { steps: renderSteps(testIds), catalog: renderCatalog(scan, pages), pages, testIds };
}

function renderCatalog(scan: PageScan, pages: CatalogPage[]): string {
  const lines = [
    '# Steps you can write', '',
    `From a testid-scan-page scan of ${scan.scannedOn}. Every step below found exactly one element when its page was scanned.`,
    'Steps with `<...>` take a value: replace it, keeping the quotes.', '',
    'On every page:', '',
    '- `Given I am on the "<page>" page`',
    '- `Then I see the "<name>" button` and `Then I do not see the "<name>" button` (also `link`, `field`, `checkbox`, `item`, `row`, ...)',
    '- `Then I see the text "<text>"`',
    '- `Then the "<name>" checkbox is checked` / `is not checked`', '',
  ];
  for (const p of pages) {
    lines.push(`## ${p.path}${p.title ? ` (${p.title})` : ''}`, '', `- \`Given I am on the "${p.path}" page\``);
    for (const s of p.steps) {
      const examples = s.examples?.length ? `, for example ${s.examples.map((x) => `"${x}"`).join(', ')}` : '';
      lines.push(`- \`${s.text}\` (${s.how}${examples})`);
    }
    if (p.unavailable.length) {
      lines.push('', '**Not available yet.** No step can find these: fix them first (the testid-scan-page report says how), scan again and regenerate.', '');
      for (const u of p.unavailable) lines.push(`- ${u.element}: ${u.reason}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function renderSteps(testIds: Record<string, string>): string {
  const entries = Object.entries(testIds).sort(([a], [b]) => a.localeCompare(b));
  return `// Generated by testid-scan-bdd from a testid-scan-page scan. Do not edit: scan again and regenerate.
// Elements are found the way the scan found them: by role and accessible name, by test ID where that is the only way,
// and inside one list item or table row for repeated elements. A step that matches more than one element fails
// (Playwright strict mode) instead of acting on the wrong one.
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

const { Given, When, Then } = createBdd();

type Role = Parameters<Page['getByRole']>[0];

/** Elements a test can only find by their test ID, by "role:name" as a step writes the name. */
const BY_TEST_ID: Record<string, string> = {
${entries.map(([key, id]) => `  ${JSON.stringify(key)}: ${JSON.stringify(id)},`).join('\n')}
};

const NOUNS: Record<string, Role[]> = ${JSON.stringify(NOUNS)};
const RECORDS: Record<string, Role> = ${JSON.stringify(RECORDS)};

/** The element of this kind with this name, in the page or in one record. */
function element(scope: Page | Locator, noun: string, name: string): Locator {
  const roles = NOUNS[noun];
  if (!roles) throw new Error(\`Unknown kind of element "\${noun}". Use one of: \${Object.keys(NOUNS).join(', ')}\`);
  let found = roles.map((role) => scope.getByRole(role, { name, exact: true })).reduce((a, b) => a.or(b));
  for (const role of roles) {
    const testId = BY_TEST_ID[\`\${role}:\${name}\`];
    if (testId) found = scope.getByTestId(testId).or(found);
  }
  return found;
}

/** The list item or table row whose text contains \`text\`. */
function record(page: Page, noun: string, text: string): Locator {
  const role = RECORDS[noun];
  if (!role) throw new Error(\`Unknown kind of record "\${noun}". Use one of: \${Object.keys(RECORDS).join(', ')}\`);
  return page.getByRole(role).filter({ hasText: text });
}

/** An element, or a record when the noun names one: "Then I see the "Lamp" item". */
const anything = (page: Page, noun: string, name: string) => (RECORDS[noun] ? record(page, noun, name) : element(page, noun, name));

Given('I am on the {string} page', async ({ page }, path: string) => {
  await page.goto(path);
});

for (const noun of ['button', 'link', 'tab', 'menu item']) {
  When(\`I click the {string} \${noun}\`, async ({ page }, name: string) => {
    await element(page, noun, name).click();
  });
  for (const recordNoun of Object.keys(RECORDS)) {
    When(\`I click the {string} \${noun} in the {string} \${recordNoun}\`, async ({ page }, name: string, text: string) => {
      await element(record(page, recordNoun, text), noun, name).click();
    });
  }
}

When('I fill the {string} field with {string}', async ({ page }, name: string, value: string) => {
  await element(page, 'field', name).fill(value);
});
for (const recordNoun of Object.keys(RECORDS)) {
  When(\`I fill the {string} field in the {string} \${recordNoun} with {string}\`, async ({ page }, name: string, text: string, value: string) => {
    await element(record(page, recordNoun, text), 'field', name).fill(value);
  });
}

When('I check the {string} checkbox', async ({ page }, name: string) => {
  await element(page, 'checkbox', name).check();
});
When('I uncheck the {string} checkbox', async ({ page }, name: string) => {
  await element(page, 'checkbox', name).uncheck();
});
When('I choose the {string} option', async ({ page }, name: string) => {
  await element(page, 'option', name).check();
});
When('I select {string} in the {string} dropdown', async ({ page }, option: string, name: string) => {
  await element(page, 'dropdown', name).selectOption(option);
});

for (const noun of [...Object.keys(NOUNS), ...Object.keys(RECORDS)]) {
  Then(\`I see the {string} \${noun}\`, async ({ page }, name: string) => {
    await expect(anything(page, noun, name)).toBeVisible();
  });
  Then(\`I do not see the {string} \${noun}\`, async ({ page }, name: string) => {
    await expect(anything(page, noun, name)).toBeHidden();
  });
}

Then('I see the text {string}', async ({ page }, text: string) => {
  await expect(page.getByText(text).first()).toBeVisible();
});
Then('the {string} checkbox is checked', async ({ page }, name: string) => {
  await expect(element(page, 'checkbox', name)).toBeChecked();
});
Then('the {string} checkbox is not checked', async ({ page }, name: string) => {
  await expect(element(page, 'checkbox', name)).not.toBeChecked();
});
`;
}
