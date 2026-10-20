// angular-realworld-example-app (gothinkster): Angular 21, standalone components, @if/@for blocks, path routing.
// The API gets fixed data.
import { mockConduitApi } from './conduit-api.mjs';

export const setup = mockConduitApi;

export async function journey({ page, base, look, step, settle }) {
  await page.goto(base + '/', { waitUntil: 'networkidle' }); await settle(); await look('home: signed out');
  await step('open first article', () => page.getByRole('link', { name: /Article 1/ }).first().click({ timeout: 5000 })); await settle(); await look('article: signed out');
  await step('go to register', () => page.getByRole('link', { name: 'Sign up' }).first().click({ timeout: 5000 })); await settle(); await look('register');
  await step('go to login', () => page.getByRole('link', { name: 'Sign in' }).first().click({ timeout: 5000 })); await settle(); await look('login');
  await step('sign in', async () => {
    await page.getByPlaceholder('Email').fill('ada@example.com');
    await page.getByPlaceholder('Password').fill('secret');
    await page.getByRole('button', { name: 'Sign in' }).click({ timeout: 5000 });
    await page.waitForURL((u) => new URL(u).pathname === '/', { timeout: 5000 });
  });
  await settle(); await look('home: signed in');
  await step('your feed', () => page.getByText('Your Feed').first().click({ timeout: 5000 })); await settle(); await look('home: your feed');
  await step('open first article signed in', () => page.getByRole('link', { name: /Article 1/ }).first().click({ timeout: 5000 })); await settle(); await look('article: signed in');
  await step('new article', () => page.getByRole('link', { name: 'New Article' }).first().click({ timeout: 5000 })); await settle(); await look('editor');
  await step('settings', () => page.getByRole('link', { name: 'Settings' }).first().click({ timeout: 5000 })); await settle(); await look('settings');
  await step('profile', () => page.getByRole('link', { name: 'ada' }).first().click({ timeout: 5000 })); await settle(); await look('profile');
  await step('favorited articles', () => page.getByRole('link', { name: 'Favorited Posts' }).click({ timeout: 5000 })); await settle(); await look('profile: favorites');
  await step('tag page', () => page.goto(base + '/tag/one', { waitUntil: 'networkidle' })); await settle(); await look('tag page');
  await step('unknown route', () => page.goto(base + '/no/such/page', { waitUntil: 'networkidle' })); await look('not found page');
}
