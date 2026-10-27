// Scans test/fixtures/shop.html with testid-scan-page (built next to this package) and writes
// test/fixtures/shop.page.json, the scan the tests read. Run it after changing shop.html:
//   (cd ../testid-scan-page && npm run build) && node scripts/update-fixture.mjs
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './serve.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = join(root, 'test', 'fixtures');
const scanner = join(root, '..', 'testid-scan-page', 'dist', 'cli.js');
if (!existsSync(scanner)) { console.error(`testid-scan-page not built: ${scanner}`); process.exit(2); }

const { server, base } = await serve(fixtures);
const out = join(fixtures, 'shop.page.json');
// asynchronous: the server in this process has to answer while the scanner runs
const r = await new Promise((resolve) => {
  const child = spawn(process.execPath, [scanner, `${base}shop.html`, '--json', out, '--out', join(fixtures, '.page-report.md'), '--format', 'quiet']);
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (status) => resolve({ status, stdout, stderr }));
});
server.close();
if (r.status !== 0 && r.status !== 1) { console.error(r.stdout, r.stderr); process.exit(2); }
// the port changes on every run; the steps only use the path
const scan = JSON.parse(readFileSync(out, 'utf8'));
for (const page of scan.pages) page.url = page.url.replace(base, 'http://localhost/');
writeFileSync(out, `${JSON.stringify(scan, null, 2)}\n`);
console.log(r.stdout.trim());
console.log(`Wrote ${out}`);
