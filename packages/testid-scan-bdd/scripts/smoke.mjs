// Clean-environment check: pack this package, install the tarball into an empty folder, and run the CLI and the
// API from there on the fixture scan, as a user would.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], shell: process.platform === 'win32' });

const out = mkdtempSync(join(tmpdir(), 'testid-scan-bdd-pack-'));
const tarball = join(out, run(npm, ['pack', '--silent', '--pack-destination', out], root).trim().split('\n').at(-1));
const app = mkdtempSync(join(tmpdir(), 'testid-scan-bdd-smoke-'));
writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'smoke', private: true, type: 'module' }));
run(npm, ['install', '--no-audit', '--no-fund', tarball], app);
copyFileSync(join(root, 'test', 'fixtures', 'shop.page.json'), join(app, 'scan.json'));

const bin = join(app, 'node_modules', '.bin', process.platform === 'win32' ? 'testid-scan-bdd.cmd' : 'testid-scan-bdd');
const version = run(bin, ['--version'], app).trim();
if (version !== pkg.version) throw new Error(`--version printed ${version}, expected ${pkg.version}`);
const summary = run(bin, ['scan.json'], app);
if (!/12 steps/.test(summary)) throw new Error(`unexpected summary: ${summary}`);
if (!/I click the "Open" button in the "<row>" row/.test(readFileSync(join(app, 'testid-steps.md'), 'utf8'))) throw new Error('catalog is missing the row step');
writeFileSync(join(app, 'check.mjs'), "import { readFileSync } from 'node:fs'; import { generate, readScan } from 'testid-scan-bdd'; const g = generate(readScan(JSON.parse(readFileSync('scan.json', 'utf8')))); if (g.testIds['button:delete all'] !== 'delete-all-button') throw new Error('API'); console.log('API ok');");
console.log(run(process.execPath, ['check.mjs'], app).trim());
console.log(`smoke ok: ${pkg.name}@${version} installed from ${tarball.split(/[\\/]/).at(-1)} into a clean folder`);
