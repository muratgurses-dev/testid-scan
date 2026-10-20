// Fixed data for the RealWorld ("Conduit") API, shared by the Conduit front ends: their backend cannot be reached here.
export async function mockConduitApi(page) {
  const now = '2026-10-01T10:00:00.000Z';
  const author = { username: 'ada', bio: 'Engines', image: '', following: false };
  const user = { email: 'ada@example.com', token: 'token-1', username: 'ada', bio: 'Engines', image: '' };
  const article = (n) => ({ slug: `article-${n}`, title: `Article ${n}`, description: `About ${n}`, body: `Body ${n}`, tagList: ['one', 'two'], createdAt: now, updatedAt: now, favorited: false, favoritesCount: n, author });
  const comments = [{ id: 1, body: 'Nice one', createdAt: now, updatedAt: now, author }, { id: 2, body: 'Agreed', createdAt: now, updatedAt: now, author: { ...author, username: 'bob' } }];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^.*?\/api/, '');
    const method = route.request().method();
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (path === '/users/login' || path === '/users' || path === '/user') return json({ user });
    if (path === '/tags') return json({ tags: ['one', 'two', 'three'] });
    if (path === '/articles' || path === '/articles/feed') return json({ articles: [article(1), article(2), article(3)], articlesCount: 30 });
    if (/^\/articles\/[^/]+\/comments$/.test(path)) return json(method === 'POST' ? { comment: comments[0] } : { comments });
    if (/^\/articles\/[^/]+\/favorite$/.test(path)) return json({ article: { ...article(1), favorited: method === 'POST' } });
    if (/^\/articles\/[^/]+$/.test(path)) return json({ article: article(1) });
    if (/^\/profiles\/[^/]+\/follow$/.test(path)) return json({ profile: { ...author, following: method === 'POST' } });
    if (/^\/profiles\//.test(path)) return json({ profile: author });
    return json({});
  });
}
