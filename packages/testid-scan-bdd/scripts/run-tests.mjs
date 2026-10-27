// Runs the compiled tests with the Node.js that started this script.
// The file list is built here, because older Node versions and Windows shells do not expand "*.test.js".
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '.test-build', 'test');
const files = readdirSync(dir).filter((name) => name.endsWith('.test.js')).sort().map((name) => join(dir, name));
if (!files.length) {
  console.error(`No compiled tests in ${dir}`);
  process.exit(1);
}
process.exit(spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' }).status ?? 1);
