// angular-ngrx-material-starter (Angular 12, Material 12). Adapted from the 2026-10-09 runtime validation.
export async function journey({ page, base, look, step }) {
  const visit = async (path, state) => { await page.goto(base + path, { waitUntil: 'networkidle' }).catch(() => {}); await page.waitForTimeout(700); await look(state); };
  await visit('/about', 'about');
  await visit('/feature-list', 'feature list');
  await visit('/settings', 'settings');
  await step('open language select', () => page.getByRole('combobox').first().click({ timeout: 4000 })); await look('settings: select open'); await page.keyboard.press('Escape');
  await visit('/examples/todos', 'examples: todos');
  await step('open todo filter menu', () => page.locator('button.todos-filter, [mattooltip], button[aria-haspopup]').first().click({ timeout: 4000 })); await look('examples: todos menu'); await page.keyboard.press('Escape');
  await visit('/examples/stock-market', 'examples: stock market');
  await visit('/examples/theming', 'examples: theming');
  await visit('/examples/crud', 'examples: crud');
  await step('select a book', () => page.getByRole('listitem').first().click({ timeout: 4000 })); await look('examples: crud, book selected');
  await step('edit the book', () => page.locator('fa-icon[icon="edit"]').first().click({ timeout: 4000 })); await look('examples: crud, editing');
  await step('clear the title', async () => { await page.getByLabel('Title', { exact: true }).fill(''); await page.getByLabel('Author', { exact: true }).fill(''); await page.keyboard.press('Tab'); }); await look('examples: crud, empty fields');
  await visit('/examples/simple-state-management', 'examples: simple state');
  await step('touch user fields', async () => { await page.getByRole('textbox').first().click({ timeout: 4000 }); for (let i = 0; i < 5; i += 1) await page.keyboard.press('Tab'); }); await look('examples: simple state, fields touched');
  await step('edit a user', () => page.getByRole('button', { name: 'Edit', exact: true }).first().click({ timeout: 4000 })); await look('examples: simple state, editing');
  await visit('/examples/form', 'examples: form');
  await step('touch every form field', async () => { await page.getByLabel('Username', { exact: true }).click({ timeout: 4000 }); for (let i = 0; i < 9; i += 1) await page.keyboard.press('Tab'); }); await look('examples: form, fields touched');
  await step('type invalid values', async () => { await page.getByLabel('E-mail', { exact: true }).fill('x'); await page.getByLabel('Description', { exact: true }).fill('short'); await page.keyboard.press('Tab'); }); await look('examples: form, invalid values');
  await visit('/examples/notifications', 'examples: notifications');
  await visit('/examples/elements', 'examples: elements');
  await visit('/examples/authenticated', 'examples: authenticated (redirects)');
  await step('phone width', async () => { await page.setViewportSize({ width: 390, height: 800 }); await page.goto(base + '/about', { waitUntil: 'networkidle' }); }); await look('about: phone width');
  await step('open side menu', () => page.getByRole('button').first().click({ timeout: 4000 })); await look('about: phone width, menu open');
}
