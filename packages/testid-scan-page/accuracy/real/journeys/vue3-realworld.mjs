// vue3-realworld-example-app: its backend is a public API that cannot be reached here, so its calls get fixed data.
// Adapted from the 2026-10-09 runtime validation.
export async function setup(page) {
  const now = '2026-10-01T10:00:00.000Z';
  const author = { username: 'ada', bio: 'Engines', image: '', following: false };
  const user = { email: 'ada@example.com', token: 'token-1', username: 'ada', bio: 'Engines', image: '' };
  const article = (n) => ({ slug: `article-${n}`, title: `Article ${n}`, description: `About ${n}`, body: `Body ${n}`, tagList: ['one', 'two'], createdAt: now, updatedAt: now, favorited: false, favoritesCount: n, author });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, '');
    const method = route.request().method();
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (path === '/users/login' || path === '/users' || path === '/user') return json({ user });
    if (path === '/tags') return json({ tags: ['one', 'two', 'three'] });
    if (path === '/articles' || path === '/articles/feed') return json({ articles: [article(1), article(2), article(3)], articlesCount: 30 });
    if (/^\/articles\/[^/]+\/comments$/.test(path)) return json({ comments: [{ id: 1, body: 'Nice one', createdAt: now, updatedAt: now, author }, { id: 2, body: 'Agreed', createdAt: now, updatedAt: now, author: { ...author, username: 'bob' } }] });
    if (/^\/articles\/[^/]+$/.test(path)) return json({ article: article(1) });
    if (/^\/profiles\//.test(path)) return json({ profile: author });
    return json({});
  });
}

export async function journey({ page, base, look, step, settle }) {
  await page.goto(base + '/', { waitUntil: 'networkidle' }); await look('home: signed out');
  await step('open first article', () => page.getByRole('link', { name: 'article', exact: true }).first().click({ timeout: 5000 })); await settle(); await look('article: signed out');
  await step('go to register', () => page.getByRole('link', { name: 'Sign up' }).first().click({ timeout: 5000 })); await settle(); await look('register');
  await step('go to login', () => page.getByRole('link', { name: 'Sign in' }).first().click({ timeout: 5000 })); await settle(); await look('login');
  await step('sign in', async () => {
    await page.getByPlaceholder('Email').fill('ada@example.com');
    await page.getByPlaceholder('Password').fill('secret');
    await page.getByRole('button', { name: 'Sign in' }).click({ timeout: 5000 });
  });
  await settle(); await look('home: signed in');
  await step('open first article signed in', () => page.getByRole('link', { name: 'article', exact: true }).first().click({ timeout: 5000 })); await settle(); await look('article: signed in');
  await step('new article', () => page.getByRole('link', { name: /New Article|New Post/ }).first().click({ timeout: 5000 })); await settle(); await look('editor');
  await step('settings', () => page.getByRole('link', { name: 'Settings' }).first().click({ timeout: 5000 })); await settle(); await look('settings');
  await step('profile', () => page.getByRole('link', { name: 'ada' }).first().click({ timeout: 5000 })); await settle(); await look('profile');
  await step('unknown route', () => page.goto(page.url().replace(/#.*$/, '') + '#/no/such/page', { waitUntil: 'networkidle' })); await look('not found page');
}
