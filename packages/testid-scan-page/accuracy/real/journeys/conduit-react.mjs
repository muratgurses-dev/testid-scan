// conduit-realworld-example-app (TonyMckes), frontend/: React 19, Vite 7, HashRouter. The API gets fixed data.
import { mockConduitApi } from './conduit-api.mjs';

export const setup = mockConduitApi;

export async function journey({ page, base, look, step, settle }) {
  await page.goto(base + '/#/', { waitUntil: 'networkidle' }); await settle(); await look('home: signed out');
  await step('open first article', () => page.getByRole('link', { name: /Article 1/ }).first().click({ timeout: 5000 })); await settle(); await look('article: signed out');
  await step('go to register', () => page.goto(base + '/#/register', { waitUntil: 'networkidle' })); await settle(); await look('register');
  await step('go to login', () => page.goto(base + '/#/login', { waitUntil: 'networkidle' })); await settle(); await look('login');
  await step('sign in', async () => {
    await page.getByPlaceholder('Email').fill('ada@example.com');
    await page.getByPlaceholder('Password').fill('secret');
    await page.getByRole('button', { name: 'Login' }).click({ timeout: 5000 });
    await page.waitForURL(/#\/$/, { timeout: 5000 });
  });
  await settle(); await look('home: signed in');
  await step('open user menu', () => page.locator('.dropdown-toggle').click({ timeout: 5000 })); await look('home: user menu open');
  await step('close user menu', () => page.locator('.dropdown-toggle').click({ timeout: 5000 }));
  await step('your feed', () => page.getByText('Your Feed').first().click({ timeout: 5000 })); await settle(); await look('home: your feed');
  await step('open first article signed in', () => page.getByRole('link', { name: /Article 1/ }).first().click({ timeout: 5000 })); await settle(); await look('article: signed in');
  await step('new article', () => page.goto(base + '/#/editor', { waitUntil: 'networkidle' })); await settle(); await look('editor');
  await step('settings', () => page.goto(base + '/#/settings', { waitUntil: 'networkidle' })); await settle(); await look('settings');
  await step('profile', () => page.goto(base + '/#/profile/ada', { waitUntil: 'networkidle' })); await settle(); await look('profile');
  await step('favorited articles', () => page.getByRole('link', { name: 'Favorited Articles' }).click({ timeout: 5000 })); await settle(); await look('profile: favorites');
  await step('unknown route', () => page.goto(base + '/#/no/such/page', { waitUntil: 'networkidle' })); await look('not found page');
}
