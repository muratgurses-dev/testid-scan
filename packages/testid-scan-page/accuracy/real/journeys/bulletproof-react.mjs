// bulletproof-react (apps/react-vite): its own mock API (MSW) answers in the browser. Adapted from the 2026-10-09 runtime validation.
export async function journey({ page, base, look, step, settle }) {
  await page.goto(base + '/', { waitUntil: 'networkidle' }); await look('landing');
  await page.goto(base + '/auth/login', { waitUntil: 'networkidle' }); await look('login');
  await page.goto(base + '/auth/register', { waitUntil: 'networkidle' }); await look('register');
  await step('switch to existing team', () => page.getByRole('switch').click({ timeout: 4000 })); await look('register: join existing team');
  await step('switch back', () => page.getByRole('switch').click({ timeout: 4000 }));
  await step('register', async () => {
    await page.getByLabel('First Name').fill('Ada');
    await page.getByLabel('Last Name').fill('Lovelace');
    await page.getByLabel('Email Address').fill('ada@example.com');
    await page.getByLabel('Password').fill('secret-password-1');
    await page.getByLabel('Team Name').fill('Engines');
    await page.getByRole('button', { name: 'Register' }).click();
    await page.waitForURL('**/app', { timeout: 15000 });
  });
  await settle(); await look('dashboard');
  await step('open user menu', () => page.getByRole('button', { name: 'Open user menu' }).click()); await look('dashboard: user menu open');
  await page.keyboard.press('Escape');
  await step('go to discussions', () => page.getByRole('link', { name: 'Discussions' }).click()); await settle(); await look('discussions: empty');
  await step('open create discussion', () => page.getByRole('button', { name: 'Create Discussion' }).click()); await look('discussions: create drawer');
  await step('create discussion', async () => {
    await page.getByLabel('Title').fill('First topic');
    await page.getByLabel('Body').fill('Hello there');
    await page.getByRole('button', { name: 'Submit' }).click();
  });
  await settle(); await look('discussions: one row');
  await step('create second discussion', async () => {
    await page.getByRole('button', { name: 'Create Discussion' }).click();
    await page.getByLabel('Title').fill('Second topic');
    await page.getByLabel('Body').fill('More');
    await page.getByRole('button', { name: 'Submit' }).click();
  });
  await settle(); await look('discussions: two rows');
  await step('open delete discussion', () => page.getByRole('button', { name: 'Delete Discussion' }).first().click()); await look('discussions: delete dialog');
  await step('cancel delete', () => page.getByRole('button', { name: 'Cancel' }).click({ timeout: 4000 }));
  await page.keyboard.press('Escape');
  await step('view discussion', () => page.getByRole('link', { name: 'View' }).first().click()); await settle(); await look('discussion: view');
  await step('open update discussion', () => page.getByRole('button', { name: 'Update Discussion' }).click()); await look('discussion: update drawer');
  await page.keyboard.press('Escape');
  await step('open create comment', () => page.getByRole('button', { name: 'Create Comment' }).click()); await look('discussion: comment drawer');
  await step('create comment', async () => { await page.getByLabel('Body').fill('A comment'); await page.getByRole('button', { name: 'Submit' }).click(); });
  await settle(); await look('discussion: one comment');
  await step('go to users', () => page.getByRole('link', { name: 'Users' }).click()); await settle(); await look('users');
  await step('open profile', () => page.goto(base + '/app/profile', { waitUntil: 'networkidle' }));
  await settle(); await look('profile');
  await step('open update profile', () => page.getByRole('button', { name: 'Update Profile' }).click({ timeout: 4000 })); await look('profile: update drawer');
  await page.keyboard.press('Escape');
  await step('phone width', async () => { await page.setViewportSize({ width: 390, height: 800 }); await page.goto(base + '/app', { waitUntil: 'networkidle' }); }); await look('dashboard: phone width');
  await step('unknown route', () => page.goto(base + '/no-such-page', { waitUntil: 'networkidle' })); await look('not found page');
}
