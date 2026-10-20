/** Cross-file pass: a component rendered in a loop, or more than once, repeats what is inside it. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { scan, scanJsx } from '../src/index.ts';
import type { Config, ElementRecord } from '../src/index.ts';

function project(files: Record<string, string>, options: Partial<Config> = {}): ElementRecord[] {
  const root = mkdtempSync(join(tmpdir(), 'testid-scan-comp-'));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), content);
  }
  return scan(root, options).elements;
}
function one(rows: ElementRecord[], match: Partial<ElementRecord>): ElementRecord {
  const hits = rows.filter((r) => Object.entries(match).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v));
  assert.equal(hits.length, 1, `expected exactly one element matching ${JSON.stringify(match)}, got ${hits.length}`);
  return hits[0];
}

const vueFiles = {
  'package.json': JSON.stringify({ dependencies: { vue: '^3.5.0' } }),
  'src/ArticleList.vue': '<template>\n<ArticlePreview v-for="article in articles" :key="article.slug" :article="article" />\n<button>Load more</button>\n</template>\n',
  'src/ArticlePreview.vue': [
    '<template>',
    '<div data-testid="article-preview-card">',
    '  <button>Favorite</button>',
    '  <a :href="article.url" :data-testid="`article-open-link-${article.slug}`">Open</a>',
    '  <span :data-testid="`article-count-${total}`">n</span>',
    '</div>',
    '</template>',
  ].join('\n'),
};

test('Vue: a component used with v-for in another file repeats its elements', () => {
  const rows = project(vueFiles);
  const card = one(rows, { testId: 'article-preview-card' });
  assert.equal(card.repeated, true);
  assert.equal(card.status, 'Fix test ID');
  assert.match(card.reason ?? '', /same test ID on every repeated element/);
  assert.match(card.reason ?? '', /<ArticlePreview> is rendered in a loop in src\/ArticleList\.vue:2/);
  const favorite = one(rows, { label: 'Favorite' });
  assert.equal(favorite.status, 'Manual review');
  assert.equal(favorite.locatorScope, 'unknown');
  const open = one(rows, { label: 'Open' });
  assert.equal(open.status, 'OK (test ID)', 'the ID uses the input that carries the record');
  assert.equal(open.recommendedLocator, 'page.getByTestId(\'article-open-link-<article.slug>\')');
  assert.match(one(rows, { tag: 'span' }).reason ?? '', /does not use the loop record/);
  assert.equal(one(rows, { label: 'Load more' }).status, 'OK (name)', 'the parent itself is rendered once');
  assert.equal(one(rows, { label: 'Load more' }).repeated, false);
});

test('the cross-file pass can be switched off', () => {
  const rows = project(vueFiles, { followComponents: false });
  assert.equal(one(rows, { label: 'Favorite' }).status, 'OK (name)');
  assert.equal(one(rows, { label: 'Favorite' }).repeated, false);
});

test('Vue: a component used twice in one template, and components nested inside a repeated one', () => {
  const rows = project({
    'package.json': JSON.stringify({ dependencies: { vue: '^3.5.0' } }),
    'src/Article.vue': '<template>\n<ArticleMeta :article="a" />\n<p>text</p>\n<article-meta :article="a" />\n</template>\n',
    'src/ArticleMeta.vue': '<template>\n<button>Delete article</button>\n<FollowButton />\n</template>\n',
    'src/FollowButton.vue': '<template>\n<button>Follow</button>\n</template>\n',
    'src/Footer.vue': '<template>\n<button>Contact</button>\n</template>\n',
    'src/App.vue': '<template>\n<Article />\n<Footer />\n</template>\n',
  });
  const del = one(rows, { label: 'Delete article' });
  assert.equal(del.status, 'Manual review');
  assert.match(del.reason ?? '', /<ArticleMeta> is used 2 times in src\/Article\.vue/);
  const follow = one(rows, { label: 'Follow' });
  assert.equal(follow.status, 'Manual review', 'repetition is inherited by the components inside');
  assert.match(follow.reason ?? '', /inside a component that is rendered more than once/);
  assert.equal(one(rows, { label: 'Contact' }).status, 'OK (name)', 'a component used once stays as it was');
});

test('Angular: a component is found by its selector, through templateUrl or an inline template', () => {
  const rows = project({
    'package.json': JSON.stringify({ dependencies: { '@angular/core': '^20.0.0' } }),
    'src/orders/orders.html': '<app-order-row *ngFor="let order of orders" [order]="order"></app-order-row>\n<app-toolbar></app-toolbar>\n',
    'src/orders/orders.ts': '@Component({ selector: \'app-orders\', templateUrl: \'./orders.html\' })\nexport class Orders {}\n',
    'src/orders/order-row.html': '<button>Delete</button>\n<a routerLink="/x" [attr.data-testid]="\'orders-open-link-\' + order.id">Open</a>\n',
    'src/orders/order-row.ts': '@Component({ selector: \'app-order-row\', templateUrl: \'./order-row.html\' })\nexport class OrderRow { @Input() order: Order; }\n',
    'src/shared/toolbar.ts': '@Component({\n  selector: \'app-toolbar\',\n  template: `<button>Refresh</button>`,\n})\nexport class Toolbar {}\n',
  });
  const del = one(rows, { label: 'Delete' });
  assert.equal(del.status, 'Manual review');
  assert.match(del.reason ?? '', /<app-order-row> is rendered in a loop in src\/orders\/orders\.html:1/);
  assert.equal(one(rows, { label: 'Open' }).status, 'OK (test ID)');
  assert.equal(one(rows, { label: 'Refresh' }).status, 'OK (name)');
});

test('React: the component function an element is written in decides, also within one file', () => {
  const rows = project({
    'package.json': JSON.stringify({ dependencies: { react: '^19.0.0' } }),
    'src/transaction-list.tsx': 'import { TransactionItem } from "./transaction-item";\nexport const TransactionList = ({ transactions }) => (\n  <ul>{transactions.map((transaction) => <TransactionItem key={transaction.id} transaction={transaction} />)}</ul>\n);\n',
    'src/transaction-item.tsx': [
      'export function TransactionItem({ transaction }) {',
      '  return (',
      '    <li data-testid={`transaction-item-${transaction.id}`}>',
      '      <button>Like</button>',
      '      <span data-testid="transaction-amount-count">1</span>',
      '    </li>',
      '  );',
      '}',
      'export const Legend = () => <button>Help</button>;',
    ].join('\n'),
  });
  const item = one(rows, { tag: 'li' });
  assert.equal(item.status, 'OK (test ID)', 'built from the prop that carries the record');
  assert.equal(item.locatorScope, 'page-candidate');
  const like = one(rows, { label: 'Like' });
  assert.equal(like.status, 'OK (name)', 'inside a keyed record');
  assert.equal(like.locatorScope, 'record-scoped');
  assert.equal(like.recommendedLocator, 'page.getByTestId(\'transaction-item-<transaction.id>\').getByRole(\'button\', { name: \'Like\', exact: true })');
  assert.equal(one(rows, { testId: 'transaction-amount-count' }).locatorScope, 'record-scoped');
  assert.equal(one(rows, { label: 'Help' }).repeated, false, 'another component in the same file is not affected');

  const single = scanJsx([
    'const Row = ({ order }) => <button>Remove</button>;',
    'export const Table = ({ orders }) => <div>{orders.map((order) => <Row key={order.id} order={order} />)}</div>;',
  ].join('\n'));
  assert.equal(one(single, { label: 'Remove' }).status, 'Manual review', 'also when both components are in one file');
});

test('a component name defined in two files is left alone', () => {
  const rows = project({
    'package.json': JSON.stringify({ dependencies: { vue: '^3.5.0' } }),
    'src/a/Row.vue': '<template>\n<button>A</button>\n</template>\n',
    'src/b/Row.vue': '<template>\n<button>B</button>\n</template>\n',
    'src/List.vue': '<template>\n<Row v-for="r in rows" :key="r.id" />\n</template>\n',
  });
  assert.equal(one(rows, { label: 'A' }).status, 'OK (name)');
  assert.equal(one(rows, { label: 'B' }).status, 'OK (name)');
});

test('alternatives are not two instances: routes, ternaries, v-if / v-else', () => {
  const react = scanJsx([
    'const Panel = () => <button>Refresh</button>;',
    'const Meta = () => <button>Delete</button>;',
    'export const App = ({ wide }) => (',
    '  <Switch>',
    '    <Route path="/a"><Panel /></Route>',
    '    <Route path="/b"><Panel /></Route>',
    '    {wide ? <Panel /> : <Panel />}',
    '    <Meta /><footer><Meta /></footer>',
    '  </Switch>',
    ');',
  ].join('\n'));
  assert.equal(one(react, { label: 'Refresh' }).status, 'OK (name)');
  assert.equal(one(react, { label: 'Delete' }).status, 'Manual review', 'two unconditional usages are two instances');
  const vue = project({
    'package.json': JSON.stringify({ dependencies: { vue: '^3.5.0' } }),
    'src/Page.vue': '<template>\n<Spinner v-if="loading" />\n<Spinner v-else />\n</template>\n',
    'src/Spinner.vue': '<template>\n<button>Cancel</button>\n</template>\n',
  });
  assert.equal(one(vue, { label: 'Cancel' }).status, 'OK (name)');
});

test('React: a named row renderer and per-row constants', () => {
  const rows = project({
    'package.json': JSON.stringify({ dependencies: { react: '^19.0.0' } }),
    'src/list.tsx': [
      'export const TransactionList = ({ transactions }) => {',
      '  function rowRenderer({ key, index, style }) {',
      '    const transaction = get(index, transactions);',
      '    return <div key={key} style={style}><TransactionItem transaction={transaction} /></div>;',
      '  }',
      '  return <VirtualList rowRenderer={rowRenderer} />;',
      '};',
    ].join('\n'),
    'src/item.tsx': 'export const TransactionItem = ({ transaction }) => (\n  <li data-testid={`transaction-item-${transaction.id}`}><span data-testid="transaction-like-count">1</span></li>\n);\n',
  });
  assert.equal(one(rows, { tag: 'li' }).status, 'OK (test ID)');
  assert.equal(one(rows, { tag: 'span' }).locatorScope, 'record-scoped');
  assert.equal(one(rows, { tag: 'span' }).recommendedLocator, 'page.getByTestId(\'transaction-item-<transaction.id>\').getByTestId(\'transaction-like-count\')');
});

test('two separate conditions are two instances; a select with only a placeholder needs review', () => {
  const vue = project({
    'package.json': JSON.stringify({ dependencies: { vue: '^3.5.0' } }),
    'src/Article.vue': '<template>\n<ArticleMeta v-if="article" />\n<p>text</p>\n<ArticleMeta v-if="article" />\n<el-select v-model="x" placeholder="Pick one" />\n</template>\n',
    'src/ArticleMeta.vue': '<template>\n<button>Delete article</button>\n</template>\n',
  });
  assert.equal(one(vue, { label: 'Delete article' }).status, 'Manual review');
  const select = one(vue, { kind: 'select' });
  assert.equal(select.status, 'Manual review');
  assert.equal(select.recommendedLocator, undefined);
  assert.equal(select.accessibilityFindings[0].rule, 'placeholder-only');
});
