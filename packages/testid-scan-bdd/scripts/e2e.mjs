// End-to-end check in a real browser: generate the steps from the fixture scan, then run the fixture features with
// playwright-bdd against the fixture page. shop.feature must pass; each scenario of unavailable.feature must fail,
// for the reason it was written for. The generated steps are also type-checked with strict TypeScript.
//
// Needs Node 20 or later (playwright-bdd 9) and Chromium for the Playwright version below:
//   PW_VERSION=1.56.0 npm run e2e      (E2E_INSTALL_BROWSER=1 also installs that Chromium, as CI does;
//                                       E2E_CHROMIUM=<path> runs an installed Chromium instead)
import { spawn, execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './serve.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = join(root, 'test', 'fixtures');
const dir = join(root, '.e2e');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const shell = process.platform === 'win32';
const pw = process.env.PW_VERSION ?? '1.56.0';
const bdd = process.env.PW_BDD_VERSION ?? '9';

rmSync(join(dir, 'features'), { recursive: true, force: true });
mkdirSync(join(dir, 'features'), { recursive: true });
writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'testid-scan-bdd-e2e', private: true, type: 'module' }));
execFileSync(npm, ['install', '--no-audit', '--no-fund', '--silent', `@playwright/test@${pw}`, `playwright-bdd@${bdd}`, 'typescript@5'], { cwd: dir, stdio: 'inherit', shell });

// in CI: also install the browser for this Playwright version
if (process.env.E2E_INSTALL_BROWSER) execFileSync(npx, ['playwright', 'install', '--with-deps', 'chromium'], { cwd: dir, stdio: 'inherit', shell });
execFileSync(process.execPath, [join(root, 'dist', 'cli.js'), join(fixtures, 'shop.page.json'), '--steps', 'steps/testid-scan.steps.ts', '--catalog', 'testid-steps.md'], { cwd: dir, stdio: 'inherit' });
writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, module: 'esnext', moduleResolution: 'bundler', target: 'es2022', skipLibCheck: true }, include: ['steps/*.ts'] }));
execFileSync(npx, ['tsc', '-p', 'tsconfig.json'], { cwd: dir, stdio: 'inherit', shell });
console.log('generated steps: strict type check ok');

const { server, base } = await serve(fixtures);
writeFileSync(join(dir, 'playwright.config.ts'), `import { defineConfig } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';
const testDir = defineBddConfig({ features: 'features/*.feature', steps: 'steps/*.ts' });
export default defineConfig({ testDir, timeout: 15000, expect: { timeout: 3000 }, reporter: 'list',
  use: { baseURL: ${JSON.stringify(base)}${process.env.E2E_CHROMIUM ? `, launchOptions: { executablePath: ${JSON.stringify(process.env.E2E_CHROMIUM)} }` : ''} } });
`);

/** Runs one feature file; asynchronous, so the server in this process can answer the browser. */
function runFeature(file) {
  rmSync(join(dir, 'features'), { recursive: true, force: true });
  mkdirSync(join(dir, 'features'));
  cpSync(join(fixtures, file), join(dir, 'features', file));
  return new Promise((resolve) => {
    const child = spawn(`${npx} bddgen && ${npx} playwright test`, { cwd: dir, shell: true, env: { ...process.env, FORCE_COLOR: '0' } });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    // some Playwright versions color their errors even when told not to: compare plain text
    child.on('close', (status) => resolve({ status, out: out.replace(/\x1b\[[0-9;]*m/g, '') }));
  });
}

const failures = [];
const good = await runFeature('shop.feature');
console.log(good.out.split('\n').filter((l) => /✓|✘|passed|failed/.test(l)).join('\n'));
if (good.status !== 0) failures.push(`shop.feature failed:\n${good.out}`);

const bad = await runFeature('unavailable.feature');
console.log(bad.out.split('\n').filter((l) => /✓|✘|passed|failed/.test(l)).join('\n'));
if (!/2 failed/.test(bad.out)) failures.push('unavailable.feature: expected both scenarios to fail');
if (!/strict mode violation: getByRole\('button', \{ name: 'Compare', exact: true \}\) resolved to 2 elements/.test(bad.out)) failures.push('the ambiguous "Compare" button did not fail with a strict mode violation');
if (!/toBeVisible\(\) failed/.test(bad.out)) failures.push('the removed item did not fail its visibility check');

server.close();
if (failures.length) {
  console.error(`\ne2e FAILED\n${failures.join('\n\n')}`);
  // in GitHub Actions, also as annotations, which can be read without the log
  if (process.env.GITHUB_ACTIONS) for (const f of failures) console.log(`::error title=testid-scan-bdd e2e::${f.split('\n')[0].replace(/%/g, '%25')}`);
  process.exit(1);
}
console.log('e2e ok: the generated steps pass shop.feature in Chromium, and fail where they must');
