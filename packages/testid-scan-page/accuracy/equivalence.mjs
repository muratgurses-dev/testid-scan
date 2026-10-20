#!/usr/bin/env node
/**
 * Instrumentation must not change the app. For each app built twice — plainly and with testid-scan-page/vite —
 * every screen must show the same accessibility tree, the same text, the same interactive elements and no new console
 * errors; and the plain build must carry no data-tsrc marks at all (the plugin is opt-in).
 *
 *   node accuracy/equivalence.mjs [--work <folder with real apps built as dist-plain and dist-tsrc>]
 *
 * The corpora (accuracy/react-shop, accuracy/vue-shop) are built by `npm run accuracy` (dist and dist-tsrc).
 * Exit code 1 when any screen differs.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { mockConduitApi } from './real/journeys/conduit-api.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const work = args.includes('--work') ? resolve(args[args.indexOf('--work') + 1]) : undefined;

const APPS = [
  { name: 'react-shop', plain: join(here, 'react-shop', 'dist'), marked: join(here, 'react-shop', 'dist-tsrc'), routes: ['#/', '#/cart', '#/admin'] },
  { name: 'vue-shop', plain: join(here, 'vue-shop', 'dist'), marked: join(here, 'vue-shop', 'dist-tsrc'), routes: ['#/', '#/cart', '#/admin'] },
  ...(work ? [
    { name: 'bulletproof-react', plain: join(work, 'bulletproof-react/apps/react-vite/dist-plain'), marked: join(work, 'bulletproof-react/apps/react-vite/dist-tsrc'), routes: ['', 'auth/login', 'auth/register'] },
    { name: 'vue3-realworld', plain: join(work, 'vue3-realworld-example-app/dist-plain'), marked: join(work, 'vue3-realworld-example-app/dist-tsrc'), routes: ['', '#/login', '#/register'] },
    { name: 'conduit-react', plain: join(work, 'conduit-realworld-example-app/frontend/dist-plain'), marked: join(work, 'conduit-realworld-example-app/frontend/dist-tsrc'), routes: ['#/', '#/login', '#/register'], setup: mockConduitApi },
  ] : []),
];

async function serve(root) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = join(root, path);
    if (!file.startsWith(root) || !existsSync(file) || path.endsWith('/')) file = join(root, 'index.html');
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}/` };
}

/** What a user and a test see on one screen, without the marks themselves. */
async function look(browser, base, route, setup) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  if (setup) await setup(page); // fixed API data, the same for both builds
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).split('\n')[0]));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_TUNNEL|ERR_NAME|net::/.test(m.text())) errors.push(m.text().split('\n')[0]); });
  await page.goto(base + route, { waitUntil: 'networkidle' }).catch(() => undefined);
  await page.waitForTimeout(400);
  const aria = await page.locator('body').ariaSnapshot().catch(() => '');
  const text = await page.locator('body').innerText().catch(() => '');
  const facts = await page.evaluate(() => ({
    interactive: document.querySelectorAll('a[href],button,input,select,textarea,[role],[tabindex]').length,
    marks: document.querySelectorAll('[data-tsrc],[data-tsrc-use]').length,
  }));
  await page.close();
  return { aria, text, ...facts, errors };
}

const browser = await chromium.launch();
let failed = 0;
try {
  for (const app of APPS) {
    if (!existsSync(join(app.plain, 'index.html')) || !existsSync(join(app.marked, 'index.html'))) {
      console.log(`${app.name.padEnd(18)} skipped: build both ${app.plain} and ${app.marked} first`);
      continue;
    }
    const plain = await serve(app.plain); const marked = await serve(app.marked);
    try {
      for (const route of app.routes) {
        const a = await look(browser, plain.base, route, app.setup); const b = await look(browser, marked.base, route, app.setup);
        const problems = [];
        if (a.aria !== b.aria) problems.push('accessibility tree differs');
        if (a.text !== b.text) problems.push('text differs');
        if (a.interactive !== b.interactive) problems.push(`interactive elements ${a.interactive} vs ${b.interactive}`);
        const newErrors = b.errors.filter((e) => !a.errors.includes(e));
        if (newErrors.length) problems.push(`new console errors: ${newErrors.join(' | ')}`);
        if (a.marks) problems.push(`the plain build has ${a.marks} data-tsrc marks`);
        if (!b.marks) problems.push('the instrumented build has no marks (the plugin did not run)');
        failed += problems.length ? 1 : 0;
        console.log(`${app.name.padEnd(18)} ${(route || '/').padEnd(16)} ${problems.length ? `DIFFERS: ${problems.join('; ')}` : `same (${a.interactive} interactive elements; ${b.marks} marks only in the instrumented build)`}`);
      }
    } finally {
      plain.server.close(); marked.server.close();
    }
  }
} finally {
  await browser.close();
}
if (failed) { console.error(`${failed} screen(s) differ between the plain and the instrumented build`); process.exit(1); }
