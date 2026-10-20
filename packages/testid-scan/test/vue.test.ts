/** Vue adapter: each test feeds a small single-file component to the scanner and checks the status it gets. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { detectFrameworks, scan, scanTemplate, scanVue } from '../src/index.ts';
import type { Config, ElementRecord } from '../src/index.ts';

/** Wraps template lines in a .vue file; the first line given is line 2 of the file. */
function vue(lines: string[], options: Partial<Config> = {}): ElementRecord[] {
  return scanVue(`<template>\n${lines.join('\n')}\n</template>\n<script setup>\nconst x = 1;\n</script>\n`, { requireTypeSuffix: true, ...options });
}

function one(rows: ElementRecord[], match: Partial<ElementRecord>): ElementRecord {
  const hits = rows.filter((r) => Object.entries(match).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v));
  assert.equal(hits.length, 1, `expected exactly one element matching ${JSON.stringify(match)}, got ${hits.length}`);
  return hits[0];
}

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'testid-scan-vue-'));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), content);
  }
  return root;
}

test('HTML elements: role comes from the tag; a clickable div or <a> without href has none', () => {
  const rows = vue([
    '<button @click="save">Save</button>',
    '<a href="/orders">Orders</a>',
    '<div @click="open">Open</div>',
    '<a @click.prevent="go">Go</a>',
    '<span v-on:click="x">X</span>',
    '<div role="button" tabindex="0" @click="run">Run</div>',
    '<input type="hidden" name="x" />',
    '<p>plain text is not listed</p>',
  ]);
  assert.equal(rows.length, 6);
  assert.equal(one(rows, { line: 2 }).status, 'OK (name)');
  assert.equal(one(rows, { line: 3 }).kind, 'link');
  for (const line of [4, 5, 6]) {
    assert.equal(one(rows, { line }).status, 'Needs test ID');
    assert.match(one(rows, { line }).reason ?? '', /has no role/);
  }
  assert.equal(one(rows, { line: 7 }).status, 'OK (name)');
});

test('components are matched in kebab-case and PascalCase; unknown clickable ones need review', () => {
  const rows = vue([
    '<v-btn @click="save">Save</v-btn>',
    '<VBtn @click="open">Open</VBtn>',
    '<v-btn icon="mdi-delete" @click="remove" />',
    '<v-btn aria-label="Edit"><v-icon>mdi-pencil</v-icon></v-btn>',
    '<VBtn><VIcon>mdi-plus</VIcon></VBtn>',
    '<router-link to="/orders">Orders</router-link>',
    '<RouterLink to="/users">Users</RouterLink>',
    '<order-card @click="pick(order)" />',
    '<order-card />',
    '<AppButton>Go</AppButton>',
  ]);
  assert.equal(one(rows, { line: 2 }).status, 'OK (name)');
  assert.equal(one(rows, { line: 3 }).tag, 'VBtn');
  assert.equal(one(rows, { line: 3 }).status, 'OK (name)');
  assert.equal(one(rows, { line: 4 }).status, 'Missing name');
  assert.equal(one(rows, { line: 5 }).label, 'Edit');
  assert.equal(one(rows, { line: 6 }).status, 'Missing name', 'icon ligature text is not a name, in PascalCase too');
  assert.equal(one(rows, { line: 7 }).kind, 'link');
  assert.equal(one(rows, { line: 8 }).kind, 'link');
  assert.equal(one(rows, { line: 9 }).status, 'Manual review');
  assert.match(one(rows, { line: 9 }).reason ?? '', /component with a click handler/);
  assert.equal(rows.length, 8);

  const custom = vue(['<AppButton>Go</AppButton>', '<app-button>Stop</app-button>', '<v-btn>Not ours</v-btn>'],
    { components: { AppButton: 'button', 'v-btn': '' } });
  assert.deepEqual(custom.map((r) => [r.label, r.status]), [['Go', 'OK (name)'], ['Stop', 'OK (name)']]);
});

test('form controls are named by a label, never by options or a placeholder', () => {
  const rows = vue([
    '<label for="email">Email</label><input id="email" v-model="email" />',
    '<label>Phone <input type="tel" /></label>',
    '<select v-model="s"><option>Open</option><option>Closed</option></select>',
    '<input placeholder="Search" />',
    '<v-text-field label="Name" v-model="name" />',
    '<v-text-field :label="$t(\'user.city\')" />',
    '<v-text-field :label="fieldLabel" />',
    '<v-text-field placeholder="No label" />',
    '<el-form-item label="Country"><el-select v-model="c"><el-option label="CA" /></el-select></el-form-item>',
    '<h2 id="t">Delete order</h2><button aria-labelledby="t"><v-icon>mdi-delete</v-icon></button>',
  ]);
  assert.equal(one(rows, { line: 2 }).label, 'Email');
  assert.equal(one(rows, { line: 3 }).label, 'Phone');
  assert.equal(one(rows, { line: 4 }).status, 'Missing name');
  assert.equal(one(rows, { line: 5 }).status, 'OK (name)', 'found by its placeholder');
  assert.equal(one(rows, { line: 6 }).label, 'Name');
  assert.equal(one(rows, { line: 7 }).label, 'user.city');
  assert.equal(one(rows, { line: 8 }).status, 'Manual review');
  assert.equal(one(rows, { line: 9 }).recommendedLocator, 'page.getByPlaceholder(\'No label\', { exact: true })');
  assert.equal(one(rows, { line: 10 }).label, 'Country');
  assert.equal(one(rows, { line: 11 }).label, 'Delete order');
});

test('runtime values, v-text/v-html and conditional children make a name dynamic', () => {
  const rows = vue([
    '<button>Hello {{ name }}</button>',
    '<button :aria-label="label"><v-icon>mdi-x</v-icon></button>',
    '<button :aria-label="\'Close\'"><v-icon>mdi-x</v-icon></button>',
    '<button v-text="caption"></button>',
    '<button><span v-if="editing">Update</span><span v-else>Create</span></button>',
    '<button><v-icon v-if="loading">mdi-loading</v-icon> Save</button>',
    '<button title="Tip">Apply</button>',
  ]);
  for (const line of [2, 3, 5, 6]) assert.equal(one(rows, { line }).status, 'Manual review');
  assert.equal(one(rows, { line: 4 }).label, 'Close');
  assert.equal(one(rows, { line: 7 }).label, 'Save', 'a conditional icon does not make the text dynamic');
  assert.equal(one(rows, { line: 7 }).status, 'OK (name)');
  assert.equal(one(rows, { line: 8 }).label, 'Apply');
});

test('translations: $t("key") is a fixed name; parameters make it dynamic; an i18n file resolves it', () => {
  const lines = [
    '<button>{{ $t("common.save") }}</button>',
    '<button :aria-label="t(\'common.close\')"><v-icon>mdi-x</v-icon></button>',
    '<button>{{ $t("orders.delete", { id }) }}</button>',
    '<button>{{ $t("common.ok") }}</button>',
    '<button>{{ $t("common.confirm") }}</button>',
    '<button>{{ $t("common.nope") }}</button>',
  ];
  const plain = vue(lines);
  assert.equal(one(plain, { line: 2 }).label, 'common.save');
  assert.deepEqual(one(plain, { line: 2 }).translationKeys, ['common.save']);
  assert.equal(one(plain, { line: 3 }).status, 'OK (name)');
  assert.equal(one(plain, { line: 4 }).status, 'Manual review');
  const root = project({ 'en.json': JSON.stringify({ common: { save: 'Save', close: 'Close', ok: 'OK', confirm: 'OK' } }) });
  const resolved = vue(lines, { i18nFile: join(root, 'en.json') });
  assert.equal(one(resolved, { line: 2 }).label, 'Save');
  assert.equal(one(resolved, { line: 5 }).status, 'Needs test ID', 'two keys with the same text collide');
  assert.match(one(resolved, { line: 7 }).reason ?? '', /common\.nope/);
});

test('v-for is a loop; IDs built from the record are OK, from the index need review', () => {
  const rows = vue([
    '<ul>',
    '  <li v-for="(order, i) in orders" :key="order.id">',
    '    <button :data-testid="`orders-open-button-${order.id}`">Open</button>',
    '    <button :data-testid="\'orders-edit-button-\' + order.id">Edit</button>',
    '    <button v-bind:data-testid="\'orders-move-button-\' + i">Move</button>',
    '    <button :data-testid="\'orders-print-button-\' + page">Print</button>',
    '    <button data-testid="orders-copy-button">Copy</button>',
    '    <button :data-testid="testId">Other</button>',
    '    <a href="/x">Details</a>',
    '  </li>',
    '</ul>',
    '<button :data-testid="\'orders-add-button\'">Add</button>',
    '<button data-testid="orders-save-table">Save</button>',
  ]);
  for (const line of [4, 5]) {
    assert.equal(one(rows, { line }).status, 'OK (test ID)');
    assert.match(one(rows, { line }).reason ?? '', /order\.id/);
    assert.deepEqual(one(rows, { line }).violations, []);
  }
  assert.match(one(rows, { line: 6 }).reason ?? '', /index-based/);
  assert.match(one(rows, { line: 7 }).reason ?? '', /does not use the loop record/);
  assert.match(one(rows, { line: 8 }).violations.join(), /same test ID on every repeated element/);
  assert.equal(one(rows, { line: 9 }).testIdKind, 'opaque');
  assert.equal(one(rows, { line: 10 }).status, 'Manual review');
  assert.equal(one(rows, { line: 13 }).testId, 'orders-add-button');
  assert.equal(one(rows, { line: 13 }).status, 'OK (test ID)');
  assert.match(one(rows, { line: 14 }).violations.join(), /suffix "-table" does not fit a button/);
});

test('a keyed record makes what is inside it scopable; table rows are records', () => {
  const keyed = vue([
    '<li v-for="{ id, name } in orders" :key="id" :data-order-id="id">',
    '  <button data-testid="orders-open-button">Open</button>',
    '  <a href="/x">Details</a>',
    '</li>',
  ]);
  assert.deepEqual(one(keyed, { tag: 'button' }).violations, []);
  assert.equal(one(keyed, { tag: 'a' }).status, 'OK (name)');

  const table = (rowAttrs: string) => vue([
    '<table>',
    '  <thead><tr><th>Name</th></tr></thead>',
    `  <tbody><tr v-for="row in rows" :key="row.id" ${rowAttrs}>`,
    '    <td><button aria-label="Delete"><v-icon>mdi-delete</v-icon></button></td>',
    '  </tr></tbody>',
    '</table>',
  ]);
  const plain = table('');
  assert.equal(plain.length, 3, 'the header row is not a record');
  assert.equal(one(plain, { tag: 'tr' }).status, 'Needs test ID');
  assert.equal(one(plain, { tag: 'button' }).status, 'Manual review');
  const withKey = table(':data-testid="`orders-row-${row.id}`"');
  assert.equal(one(withKey, { tag: 'tr' }).status, 'OK (test ID)');
  assert.equal(one(withKey, { tag: 'button' }).status, 'OK (name)');
});

test('nested <template> blocks stay inside the component template; a reviewed marker works', () => {
  const rows = vue([
    '<template v-if="ready">',
    '  <button>Inside</button>',
    '</template>',
    '<template #footer><button>Footer</button></template>',
    '<!-- testid-scan: reviewed -->',
    '<button>{{ label }}</button>',
    '<!-- testid-scan: reviewed -->',
    '<button><v-icon>mdi-x</v-icon></button>',
  ]);
  assert.equal(one(rows, { label: 'Inside' }).line, 3);
  assert.equal(one(rows, { label: 'Footer' }).line, 5);
  assert.equal(one(rows, { line: 7 }).status, 'OK (reviewed)');
  assert.equal(one(rows, { line: 9 }).status, 'Missing name');
});

test('folder scan: framework from package.json, unreadable templates are listed', () => {
  const root = project({
    'package.json': JSON.stringify({ dependencies: { vue: '^3.5.0' } }),
    'src/components/OrderList.vue': '<script setup lang="ts">\nconst a = 1;\n</script>\n\n<template>\n  <button>Refresh</button>\n  <div @click="x">Old</div>\n</template>\n',
    'src/components/Pug.vue': '<template lang="pug">\nbutton Save\n</template>\n',
    'src/components/Render.vue': '<script>\nexport default { render() { return null; } };\n</script>\n',
    'src/legacy/page.html': '<button>Not Vue</button>\n',
    'src/widgets/Thing.tsx': 'export const Thing = () => <button>JSX</button>;\n',
  });
  assert.deepEqual(detectFrameworks(join(root, 'src')), ['vue']);
  const result = scan(join(root, 'src'));
  assert.deepEqual(result.files.map((f) => [f.file, f.framework]), [['components/OrderList.vue', 'vue']]);
  assert.equal(one(result.elements, { label: 'Refresh' }).line, 6);
  assert.equal(result.totals.needsId, 1);
  assert.deepEqual(result.notScanned.unreadable.map((u) => u.file), ['components/Pug.vue', 'components/Render.vue']);
  assert.deepEqual(result.notScanned.otherHtml, []);
});

test('Angular: the shared reader treats *ngIf text and [innerText] as dynamic too', () => {
  const rows = scanTemplate([
    '<button><span *ngIf="editing">Update</span><span *ngIf="!editing">Create</span></button>',
    '<button><mat-icon *ngIf="busy">sync</mat-icon> Save</button>',
    '<button [innerText]="caption"></button>',
  ].join('\n'));
  assert.equal(one(rows, { line: 1 }).status, 'Manual review');
  assert.equal(one(rows, { line: 2 }).status, 'OK (name)');
  assert.equal(one(rows, { line: 3 }).status, 'Manual review');
});

test('Vue: Fix test ID, nested loops, nested interactive elements, hidden content, review fingerprints', () => {
  const rows = vue([
    '<button data-testid="BadName">Open</button>',
    '<section v-for="group in groups" :key="group.id">',
    '  <span v-for="(item, i) in group.items" :key="item.id">',
    '    <button :data-testid="`orders-open-button-${item.id}`">Open</button>',
    '    <button :data-testid="`orders-move-button-${group.id}`">Move</button>',
    '    <button :data-testid="`orders-sort-button-${i}`">Sort</button>',
    '  </span>',
    '</section>',
    '<router-link to="/orders">Orders <button aria-label="Pin"><v-icon>mdi-pin</v-icon></button></router-link>',
    '<button><span hidden>Old</span> Save</button>',
    '<button>{{ label }}</button>',
  ]);
  assert.equal(one(rows, { line: 2 }).status, 'Fix test ID');
  assert.equal(one(rows, { line: 5 }).status, 'OK (test ID)');
  assert.match(one(rows, { line: 6 }).reason ?? '', /outer loop only/);
  assert.match(one(rows, { line: 7 }).reason ?? '', /index-based/);
  assert.match(one(rows, { line: 10, kind: 'link' }).reason ?? '', /contains another interactive element/);
  assert.equal(one(rows, { line: 11 }).label, 'Save');
  const fingerprint = one(rows, { line: 12 }).fingerprint as string;
  const marked = (mark: string, body: string) => one(vue([`<!-- testid-scan: reviewed ${mark} -->`, body]), {});
  assert.equal(marked(fingerprint, '<button>{{ label }}</button>').status, 'OK (reviewed)');
  assert.match(marked(fingerprint, '<button>{{ label }} now</button>').reason ?? '', /out of date/);
  assert.equal(marked('', '<button>{{ label }}</button>').status, 'OK (reviewed)');
});

test('found on real projects: label prop on any known component, image alt', () => {
  const rows = vue([
    '<el-radio label="round" value="round" />',
    '<el-checkbox label="Remember me" />',
    '<el-input v-model="x" />',
    '<a href="/home"><img src="logo.png" alt="Home"></a>',
    '<a href="/user"><img src="a.png" :alt="user.name"></a>',
  ]);
  assert.equal(one(rows, { line: 2 }).label, 'round');
  assert.equal(one(rows, { line: 3 }).label, 'Remember me');
  assert.equal(one(rows, { line: 4 }).status, 'Missing name');
  assert.equal(one(rows, { line: 5 }).label, 'Home');
  assert.equal(one(rows, { line: 6 }).status, 'Manual review');
});
