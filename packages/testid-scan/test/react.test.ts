/** React adapter: each test feeds a small component to the scanner and checks the status it gets. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectFrameworks, scan, scanJsx } from '../src/index.ts';
import type { Config, ElementRecord } from '../src/index.ts';

// the tests run from the TypeScript sources (npm run test:src) or compiled (npm test); start the matching CLI file
const here = fileURLToPath(import.meta.url);
const cli = join(dirname(here), '..', 'src', here.endsWith('.ts') ? 'cli.ts' : 'cli.js');

/** Wraps JSX lines in a component; the first JSX line is line 1 of the result. */
function jsx(lines: string[], options: Partial<Config> = {}): ElementRecord[] {
  return scanJsx(`export const C = () => <>${lines.join('\n')}</>;`, { requireTypeSuffix: true, ...options });
}

function one(rows: ElementRecord[], match: Partial<ElementRecord>): ElementRecord {
  const hits = rows.filter((r) => Object.entries(match).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v));
  assert.equal(hits.length, 1, `expected exactly one element matching ${JSON.stringify(match)}, got ${hits.length}`);
  return hits[0];
}

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'testid-scan-react-'));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), content);
  }
  return root;
}

// ---------- kinds and roles ----------

test('HTML elements: role comes from the tag; a clickable div or <a> without href has none', () => {
  const rows = jsx([
    '<button onClick={save}>Save</button>',
    '<a href="/orders">Orders</a>',
    '<div onClick={open}>Open</div>',
    '<a onClick={go}>Go</a>',
    '<div role="button" tabIndex={0} onClick={run}>Run</div>',
    '<input type="hidden" name="x" />',
    '<motion.button onClick={x}>Animated</motion.button>',
    '<span>plain text is not listed</span>',
  ]);
  assert.equal(rows.length, 6);
  assert.equal(one(rows, { line: 1 }).status, 'OK (name)');
  assert.equal(one(rows, { line: 2 }).kind, 'link');
  for (const line of [3, 4]) {
    assert.equal(one(rows, { line }).status, 'Needs test ID');
    assert.match(one(rows, { line }).reason ?? '', /has no role/);
  }
  assert.equal(one(rows, { line: 5 }).status, 'OK (name)');
  assert.equal(one(rows, { line: 7 }).kind, 'button');
});

test('components: known names are mapped, unknown clickable ones need review, the map is configurable', () => {
  const rows = jsx([
    '<Button onClick={save}>Save</Button>',
    '<IconButton aria-label="Delete"><DeleteIcon /></IconButton>',
    '<IconButton><DeleteIcon /></IconButton>',
    '<Card onClick={open}>Order 1</Card>',
    '<Card>not clickable, not listed</Card>',
    '<PrimaryButton>Go</PrimaryButton>',
  ]);
  assert.equal(one(rows, { line: 1 }).status, 'OK (name)');
  assert.equal(one(rows, { line: 2 }).label, 'Delete');
  assert.equal(one(rows, { line: 3 }).status, 'Missing name');
  assert.equal(one(rows, { line: 4 }).status, 'Manual review');
  assert.match(one(rows, { line: 4 }).reason ?? '', /component with a click handler/);
  assert.equal(rows.length, 4);

  const custom = jsx(['<PrimaryButton>Go</PrimaryButton>', '<Button>Not ours</Button>'],
    { components: { PrimaryButton: 'button', Button: '' } });
  assert.deepEqual(custom.map((r) => [r.tag, r.status]), [['PrimaryButton', 'OK (name)']]);
});

// ---------- accessible names ----------

test('icons and unknown self-closing components do not name a button', () => {
  const rows = jsx([
    '<button><TrashIcon /></button>',
    '<button><Trash2 /></button>',
    '<button><svg viewBox="0 0 1 1"><title>x</title></svg></button>',
    '<button><span aria-hidden="true">×</span> Close</button>',
    '<button><img src="a.png" alt="Print" /></button>',
  ]);
  assert.equal(one(rows, { line: 1 }).status, 'Missing name');
  assert.equal(one(rows, { line: 2 }).status, 'Missing name');
  assert.match(one(rows, { line: 2 }).reason ?? '', /<Trash2 \/> assumed to render no text/);
  assert.equal(one(rows, { line: 3 }).status, 'Missing name');
  assert.equal(one(rows, { line: 4 }).label, 'Close');
  assert.equal(one(rows, { line: 5 }).label, 'Print');
});

test('form controls are named by a label, never by options or a placeholder', () => {
  const rows = jsx([
    '<label htmlFor="email">Email</label><input id="email" />',
    '<label>Phone <input type="tel" /></label>',
    '<select><option>Open</option><option>Closed</option></select>',
    '<label>Status <select><option>Open</option></select></label>',
    '<input placeholder="Search" />',
    '<h2 id="t">Delete order</h2><button aria-labelledby="t"><TrashIcon /></button>',
    '<TextField label="Name" />',
    '<TextField />',
    '<FormControlLabel control={<Checkbox />} label="Remember me" />',
    '<FormControl><InputLabel>Country</InputLabel><Select><MenuItem value="ca">Canada</MenuItem></Select></FormControl>',
    '<input type="submit" value="Send" />',
  ]);
  assert.equal(one(rows, { line: 1 }).label, 'Email');
  assert.equal(one(rows, { line: 2 }).label, 'Phone');
  assert.equal(one(rows, { line: 3 }).status, 'Missing name');
  assert.equal(one(rows, { line: 4 }).label, 'Status');
  assert.equal(one(rows, { line: 5 }).status, 'OK (name)', 'found by its placeholder');
  assert.equal(one(rows, { line: 5 }).accessibilityFindings[0].rule, 'placeholder-only');
  assert.equal(one(rows, { line: 6 }).label, 'Delete order');
  assert.equal(one(rows, { line: 7 }).label, 'Name');
  assert.equal(one(rows, { line: 8 }).status, 'Missing name');
  assert.equal(one(rows, { line: 9 }).label, 'Remember me');
  assert.equal(one(rows, { line: 9 }).kind, 'checkbox');
  assert.equal(one(rows, { line: 10, kind: 'select' }).label, 'Country');
  assert.equal(one(rows, { line: 11 }).kind, 'button');
  assert.equal(one(rows, { line: 11 }).label, 'Send');
});

test('runtime values make a name dynamic; spread props may carry one', () => {
  const rows = jsx([
    '<button>Hello {name}</button>',
    '<button>{editing ? "Update" : "Create"}</button>',
    '<button>{"Fixed"}</button>',
    '<button {...props} />',
    '<button title="Tip">Apply</button>',
    '<button title="Only title"><XIcon /></button>',
  ]);
  for (const line of [1, 2, 4, 6]) assert.equal(one(rows, { line }).status, 'Manual review');
  assert.equal(one(rows, { line: 3 }).label, 'Fixed');
  assert.match(one(rows, { line: 4 }).reason ?? '', /spread/);
  assert.equal(one(rows, { line: 5 }).label, 'Apply');
  assert.equal(one(rows, { line: 5 }).status, 'OK (name)');
});

test('translations: t("KEY") and <Trans> are fixed names; parameters make them dynamic; an i18n file resolves them', () => {
  const lines = [
    '<button>{t("common.save")}</button>',
    '<button aria-label={t("common.close")}><XIcon /></button>',
    '<button><Trans i18nKey="common.cancel" /></button>',
    '<button>{t("orders.delete", { id })}</button>',
    '<button>{t("common.ok")}</button>',
    '<button>{t("common.confirm")}</button>',
    '<button>{t("common.nope")}</button>',
    '<button>{translate("common.save")}</button>',
  ];
  const plain = jsx(lines);
  assert.equal(one(plain, { line: 1 }).label, 'common.save');
  assert.deepEqual(one(plain, { line: 1 }).translationKeys, ['common.save']);
  for (const line of [1, 2, 3]) assert.equal(one(plain, { line }).status, 'OK (name)');
  assert.equal(one(plain, { line: 4 }).status, 'Manual review');
  assert.equal(one(plain, { line: 8 }).status, 'Manual review', 'unknown function is not a translation');

  const root = project({ 'en.json': JSON.stringify({ common: { save: 'Save', close: 'Close', cancel: 'Cancel', ok: 'OK', confirm: 'OK' } }) });
  const resolved = jsx(lines, { i18nFile: join(root, 'en.json'), translateFunctions: ['t', 'translate'] });
  assert.equal(one(resolved, { line: 3 }).label, 'Cancel');
  assert.equal(one(resolved, { line: 5 }).status, 'Needs test ID', 'two keys with the same text collide');
  assert.equal(one(resolved, { line: 6 }).status, 'Needs test ID');
  assert.match(one(resolved, { line: 7 }).reason ?? '', /common\.nope/);
  assert.equal(one(resolved, { line: 1 }).status, 'Needs test ID', 'now a known translate function: same text as line 8');
});

// ---------- test IDs ----------

test('test ID naming rules apply to JSX the same way', () => {
  const rows = jsx([
    '<div data-testid="BadName">x</div>',
    '<button data-testid="orders-save-button">Save</button>',
    '<Button data-testid="orders-save-table">Save all</Button>',
    '<button data-testid={"orders-open-button"}>Open</button>',
    '<button data-testid>Empty</button>',
    '<button data-testid="orders-save-button">Save again</button>',
  ]);
  assert.deepEqual(one(rows, { line: 1 }).violations, ['not kebab-case', 'type suffix']);
  assert.deepEqual(one(rows, { line: 2 }).violations, ['duplicate in template']);
  assert.match(one(rows, { line: 3 }).violations.join(), /suffix "-table" does not fit a button/);
  assert.equal(one(rows, { line: 4 }).testIdKind, 'static');
  assert.deepEqual(one(rows, { line: 4 }).violations, []);
  assert.deepEqual(one(rows, { line: 5 }).violations, ['empty test ID']);
  const cy = jsx(['<button data-cy="app-save-btn">Save</button>'], { testIdAttribute: 'data-cy', suffixes: ['btn'] });
  assert.equal(cy[0].status, 'OK (test ID)');
});

test('lists: .map() is a loop; IDs built from the record are OK, from the index need review', () => {
  const rows = scanJsx([
    'export function List({ orders, page }) {',
    '  return <ul>{orders.map((order, i) => (',
    '    <li key={order.id}>',
    '      <button data-testid={`orders-open-button-${order.id}`}>Open</button>',
    '      <button data-testid={"orders-edit-button-" + order.id}>Edit</button>',
    '      <button data-testid={`orders-move-button-${i}`}>Move</button>',
    '      <button data-testid={`orders-print-button-${page}`}>Print</button>',
    '      <button data-testid="orders-copy-button">Copy</button>',
    '      <button data-testid={testId}>Other</button>',
    '      <a href="/x">Details</a>',
    '    </li>',
    '  ))}</ul>;',
    '}',
    'export const Tab = ({ name }) => <button data-testid={`orders-tab-${name}`}>Tab</button>;',
  ].join('\n'));
  for (const line of [4, 5]) {
    assert.equal(one(rows, { line }).status, 'OK (test ID)');
    assert.match(one(rows, { line }).reason ?? '', /order\.id/);
    assert.deepEqual(one(rows, { line }).violations, []);
  }
  assert.match(one(rows, { line: 6 }).reason ?? '', /index-based/);
  assert.match(one(rows, { line: 7 }).reason ?? '', /does not use the loop record/);
  assert.match(one(rows, { line: 8 }).violations.join(), /same test ID on every repeated element/);
  assert.equal(one(rows, { line: 9 }).testIdKind, 'opaque');
  assert.equal(one(rows, { line: 10 }).repeated, true);
  assert.equal(one(rows, { line: 10 }).status, 'Manual review');
  assert.equal(one(rows, { line: 14 }).repeated, false);
  assert.equal(one(rows, { line: 14 }).status, 'Manual review');
});

test('a keyed record makes what is inside it scopable; table rows are records', () => {
  const keyed = scanJsx([
    'const L = ({ orders }) => orders.map(({ id, name }) => (',
    '  <li key={id} data-order-id={id}>',
    '    <button data-testid="orders-open-button">Open</button>',
    '    <a href="/x">Details</a>',
    '  </li>',
    '));',
  ].join('\n'));
  assert.deepEqual(one(keyed, { tag: 'button' }).violations, []);
  assert.equal(one(keyed, { tag: 'a' }).status, 'OK (name)');

  const table = (rowAttrs: string) => scanJsx([
    'const T = ({ rows }) => (',
    '  <table>',
    '    <thead><tr><th>Name</th></tr></thead>',
    `    <tbody>{rows.map((row) => <tr key={row.id} ${rowAttrs}>`,
    '      <td><button aria-label="Delete"><TrashIcon /></button></td>',
    '    </tr>)}</tbody>',
    '  </table>',
    ');',
  ].join('\n'));
  const plain = table('');
  assert.equal(plain.length, 3, 'the header row is not a record');
  assert.equal(one(plain, { tag: 'tr' }).status, 'Needs test ID');
  assert.equal(one(plain, { tag: 'button' }).status, 'Manual review');
  assert.equal(one(plain, { tag: 'table' }).status, 'OK (name)');
  const withKey = table('data-testid={`orders-row-${row.id}`}');
  assert.equal(one(withKey, { tag: 'tr' }).status, 'OK (test ID)');
  assert.equal(one(withKey, { tag: 'button' }).status, 'OK (name)');
});

test('a reviewed comment acknowledges manual review only', () => {
  const rows = scanJsx([
    'export const C = ({ label }) => (',
    '  <div>',
    '    {/* testid-scan: reviewed */}',
    '    <button>{label}</button>',
    '    {/* testid-scan: reviewed */}',
    '    <button><XIcon /></button>',
    '    <button>{label}!</button>',
    '  </div>',
    ');',
    'export const D = ({ label }) => (',
    '  // testid-scan: reviewed',
    '  <button>{label}</button>',
    ');',
  ].join('\n'));
  assert.equal(one(rows, { line: 4 }).status, 'OK (reviewed)');
  assert.equal(one(rows, { line: 6 }).status, 'Missing name');
  assert.equal(one(rows, { line: 7 }).status, 'Manual review', 'the marker covers only the next element');
  assert.equal(one(rows, { line: 12 }).status, 'OK (reviewed)');
});

// ---------- folders ----------

test('TypeScript and plain JSX syntax both parse; line numbers point at the element', () => {
  const tsx = scanJsx('type P<T> = { items: T[] };\nconst id = <T,>(x: T): T => x;\nexport const C = (p: P<string>) => (\n  <button>Typed</button>\n);\n', {}, 'c.tsx');
  assert.equal(one(tsx, { label: 'Typed' }).line, 4);
  const plain = scanJsx('export function C(props) {\n  return <button>Plain</button>;\n}\n', {}, 'c.jsx');
  assert.equal(one(plain, { label: 'Plain' }).line, 2);
});

test('folder scan: framework from package.json, test files and files without JSX are left out', () => {
  const root = project({
    'package.json': JSON.stringify({ dependencies: { react: '^19.0.0' } }),
    'src/components/OrderList/OrderList.tsx': 'export const OrderList = () => <button>Refresh</button>;\n',
    'src/components/OrderList/OrderList.test.tsx': 'test("x", () => { render(<button>Test only</button>); });\n',
    'src/hooks/useOrders.tsx': 'export const useOrders = () => [];\n',
    'src/legacy/Old.jsx': 'export const Old = () => <div onClick={go}>Old</div>;\n',
    'src/public/page.html': '<button>Not React</button>\n',
    'src/node_modules/pkg/X.tsx': 'export const X = () => <button>Ignored</button>;\n',
  });
  assert.deepEqual(detectFrameworks(join(root, 'src')), ['react']);
  const result = scan(join(root, 'src'));
  assert.deepEqual(result.frameworks, ['react']);
  assert.deepEqual(result.files.map((f) => [f.file, f.folder, f.framework]), [
    ['components/OrderList/OrderList.tsx', 'components', 'react'],
    ['legacy/Old.jsx', 'legacy', 'react'],
  ]);
  assert.deepEqual(result.notScanned.otherHtml, [], 'HTML files are not an Angular concern in a React project');
  assert.equal(result.totals.needsId, 1);
  assert.equal(scan(join(root, 'src'), { framework: 'angular' }).files.length, 0);
});

test('a folder with both kinds of files is scanned with both adapters when nothing says otherwise', () => {
  const root = project({
    'ng/a.component.html': '<button>Angular</button>\n',
    'rx/B.tsx': 'export const B = () => <button>React</button>;\n',
  });
  const result = scan(root);
  assert.deepEqual(result.frameworks, ['angular', 'react', 'vue']);
  assert.deepEqual(result.files.map((f) => f.framework), ['angular', 'react']);
});

test('command line: --framework and --fail-on-todo work for React', () => {
  const root = project({ 'src/A.tsx': 'export const A = () => <button><XIcon /></button>;\n' });
  const run = (...args: string[]) => spawnSync(process.execPath, [cli, join(root, 'src'), '--out', join(root, 'out.md'), ...args, '--format', 'quiet'], { encoding: 'utf8', cwd: root });
  assert.equal(run('--framework', 'react', '--fail-on-todo').status, 1);
  assert.match(run('--framework', 'react').stdout, /Missing name=1/);
  assert.match(run('--framework', 'angular').stdout, /Elements=0/);
  assert.equal(run('--framework', 'svelte').status, 2);
});

test('React: Fix test ID, nested loops, nested interactive elements, hidden content, review fingerprints', () => {
  const rows = scanJsx([
    'export const C = ({ groups, label }) => (',
    '  <div>',
    '    <button data-testid="BadName">Open</button>',
    '    {groups.map((group) => group.items.map((item, i) => (',
    '      <span key={item.id}>',
    '        <button data-testid={`orders-open-button-${item.id}`}>Open</button>',
    '        <button data-testid={`orders-move-button-${group.id}`}>Move</button>',
    '        <button data-testid={`orders-sort-button-${i}`}>Sort</button>',
    '      </span>',
    '    )))}',
    '    <a href="/orders">Orders <button aria-label="Pin"><PinIcon /></button></a>',
    '    <button><span hidden>Old</span> Save</button>',
    '    <button>{label}</button>',
    '  </div>',
    ');',
  ].join('\n'));
  assert.equal(one(rows, { line: 3 }).status, 'Fix test ID');
  assert.equal(one(rows, { line: 6 }).status, 'OK (test ID)');
  assert.match(one(rows, { line: 7 }).reason ?? '', /outer loop only/);
  assert.match(one(rows, { line: 8 }).reason ?? '', /index-based/);
  assert.match(one(rows, { line: 11, kind: 'link' }).reason ?? '', /contains another interactive element/);
  assert.equal(one(rows, { line: 12 }).label, 'Save');
  const fingerprint = one(rows, { line: 13 }).fingerprint as string;
  const marked = (mark: string, body: string) => one(scanJsx(`export const D = ({ label }) => (\n  <div>\n    {/* testid-scan: reviewed ${mark} */}\n    ${body}\n  </div>\n);`), { tag: 'button' });
  assert.equal(marked(fingerprint, '<button>{label}</button>').status, 'OK (reviewed)');
  assert.match(marked(fingerprint, '<button>{label} now</button>').reason ?? '', /out of date/);
  assert.equal(marked('', '<button>{label}</button>').status, 'OK (reviewed)');
});

test('found on real projects: label prop on any known component, react-router Switch, spread on a table', () => {
  const rows = jsx([
    '<Input label="Email Address" type="email" registration={register("email")} />',
    '<Textarea label="Body" />',
    '<Input type="search" />',
    '<Switch><Route path="/a"><Home /></Route></Switch>',
    '<Switch checked={on} onChange={flip} />',
    '<table {...props}><tbody /></table>',
    '<FormInput label="Not a name here" />',
  ], { components: { FormInput: { kind: 'input', nameProps: ['caption'] } } });
  assert.equal(one(rows, { line: 1 }).label, 'Email Address');
  assert.equal(one(rows, { line: 2 }).label, 'Body');
  assert.equal(one(rows, { line: 3 }).status, 'Missing name');
  assert.equal(rows.filter((r) => r.line === 4).length, 0, 'a Switch that wraps routes is not a control');
  assert.equal(one(rows, { line: 5 }).kind, 'toggle');
  assert.equal(one(rows, { line: 6 }).status, 'OK (name)');
  assert.equal(one(rows, { line: 7 }).status, 'Missing name', 'explicit nameProps replace the default');
});

test('found in a running app: cell renderers and row render props repeat what they return', () => {
  const rows = scanJsx([
    'export const T = ({ data }) => (',
    '  <Table data={data} columns={[',
    '    { title: "Title", field: "title" },',
    '    { title: "", field: "id", Cell({ entry: { id } }) { return <Link to={`/d/${id}`}>View</Link>; } },',
    '    { title: "", field: "id", cell: ({ row }) => <button data-testid={`orders-open-button-${row.id}`}>Open</button> },',
    '  ]} />',
    ');',
    'export const L = ({ items }) => <List renderItem={(item, index) => <a href={item.url}>Open</a>} />;',
    'export const F = () => <Controller render={({ field }) => <input aria-label="Email" {...field} />} />;',
    'const routes = [{ path: "/", render: () => <button>Home</button> }];',
  ].join('\n'));
  const view = one(rows, { label: 'View' });
  assert.equal(view.repeated, true);
  assert.equal(view.status, 'Manual review');
  assert.match(view.reason ?? '', /repeated element/);
  assert.equal(one(rows, { line: 5 }).status, 'OK (test ID)', 'an ID built from the row is keyed');
  assert.equal(one(rows, { line: 8 }).repeated, true);
  assert.equal(one(rows, { line: 9 }).repeated, false, 'a form field render prop is not a row');
  assert.equal(one(rows, { line: 10 }).repeated, true, 'documented trade-off: "render" in a list of objects is taken for a column');
});
