// Clean-environment check: pack this package, install the tarball (with Playwright) into an empty folder, and run
// the CLI and both entry points from there, as a user would.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], shell: process.platform === 'win32' });

const out = mkdtempSync(join(tmpdir(), 'testid-scan-page-pack-'));
const tarball = join(out, run(npm, ['pack', '--silent', '--pack-destination', out], root).trim().split('\n').at(-1));
const app = mkdtempSync(join(tmpdir(), 'testid-scan-page-smoke-'));
writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'smoke', private: true, type: 'module' }));
run(npm, ['install', '--no-audit', '--no-fund', tarball, `playwright@${pkg.devDependencies.playwright}`], app);

const bin = join(app, 'node_modules', '.bin', process.platform === 'win32' ? 'testid-scan-page.cmd' : 'testid-scan-page');
const version = run(bin, ['--version'], app).trim();
if (version !== pkg.version) throw new Error(`--version printed ${version}, expected ${pkg.version}`);
const fixture = pathToFileURL(join(root, 'test', 'fixtures', 'orders.html')).href;
const summary = run(bin, [fixture, '--out', join(app, 'report.md'), '--format', 'quiet'], app);
if (!/Pages=1; Elements=\d+/.test(summary)) throw new Error(`unexpected CLI output: ${summary}`);
writeFileSync(join(app, 'check.mjs'), `
import { scanPages, parseLocator } from 'testid-scan-page';
import { testidSource } from 'testid-scan-page/vite';
if (typeof scanPages !== 'function' || typeof testidSource !== 'function') throw new Error('missing exports');
if (parseLocator("page.getByRole('button')")[0].method !== 'getByRole') throw new Error('parseLocator');
console.log('entry points ok');`);
console.log(run(process.execPath, ['check.mjs'], app).trim());
console.log(`smoke ok: ${pkg.name}@${version} installed from ${tarball.split(/[\\/]/).at(-1)} into a clean folder`);
