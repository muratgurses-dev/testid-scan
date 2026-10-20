// Clean-environment check: pack this package, install the tarball into an empty folder, and run the CLI and the
// API from there on a small Angular, React and Vue project, as a user would.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], shell: process.platform === 'win32' });

const out = mkdtempSync(join(tmpdir(), 'testid-scan-pack-'));
const tarball = join(out, run(npm, ['pack', '--silent', '--pack-destination', out], root).trim().split('\n').at(-1));
const app = mkdtempSync(join(tmpdir(), 'testid-scan-smoke-'));
writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'smoke', private: true, type: 'module' }));
run(npm, ['install', '--no-audit', '--no-fund', tarball], app);
// the frameworks are only named (testid-scan reads them from package.json to choose its readers), not installed
const installed = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'));
writeFileSync(join(app, 'package.json'), JSON.stringify({ ...installed, peerDependencies: { '@angular/core': '19', react: '18', vue: '3' } }));
mkdirSync(join(app, 'src'));
writeFileSync(join(app, 'src', 'home.component.ts'), "@Component({ selector: 'app-home', templateUrl: './home.component.html' }) export class HomeComponent {}");
writeFileSync(join(app, 'src', 'home.component.html'), '<button (click)="save()">Save</button><button (click)="x()"><mat-icon>add</mat-icon></button>');
writeFileSync(join(app, 'src', 'List.tsx'), 'export const List = () => <ul><li><button>Edit</button></li></ul>;');
writeFileSync(join(app, 'src', 'Card.vue'), '<template><a href="/x">Open</a></template>');

const bin = join(app, 'node_modules', '.bin', process.platform === 'win32' ? 'testid-scan.cmd' : 'testid-scan');
const version = run(bin, ['--version'], app).trim();
if (version !== pkg.version) throw new Error(`--version printed ${version}, expected ${pkg.version}`);
const r = spawnSync(bin, ['src', '--json', 'scan.json', '--format', 'quiet'], { cwd: app, encoding: 'utf8', shell: process.platform === 'win32' });
if (r.status !== 0) throw new Error(`testid-scan exited ${r.status}: ${r.stderr}`);
const scan = JSON.parse(readFileSync(join(app, 'scan.json'), 'utf8'));
const frameworks = [...new Set(scan.files.map((f) => f.framework))].sort().join(',');
if (frameworks !== 'angular,react,vue') throw new Error(`expected all three frameworks, got ${frameworks}`);
if (scan.totals.missingName !== 1) throw new Error(`expected one missing name (the icon button), got ${scan.totals.missingName}`);
writeFileSync(join(app, 'check.mjs'), "import { scanTemplate } from 'testid-scan'; if (scanTemplate('<button>Go</button>')[0].status !== 'OK (name)') throw new Error('API'); console.log('API ok');");
console.log(run(process.execPath, ['check.mjs'], app).trim());
console.log(`smoke ok: ${pkg.name}@${version} installed from ${tarball.split(/[\\/]/).at(-1)} into a clean folder`);
