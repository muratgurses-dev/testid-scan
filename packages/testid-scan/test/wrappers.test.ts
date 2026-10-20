import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { scan } from '../src/index.ts';

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'testid-wrap-'));
  for (const [name, text] of Object.entries(files)) { mkdirSync(dirname(join(root, name)), { recursive: true }); writeFileSync(join(root, name), text); }
  return root;
}

test('vue: a link drawn through the project\'s own wrapper is listed where it is used', () => {
  const root = project({
    'AppLink.vue': '<template>\n<RouterLink :aria-label="props.name" :to="props"><slot /></RouterLink>\n</template>',
    'Nav.vue': '<template>\n<nav>\n<AppLink name="home">Home</AppLink>\n<AppLink :name="route">Other</AppLink>\n</nav>\n</template>',
  });
  const els = scan(root, { framework: 'vue' }).elements;
  assert.deepEqual(els.map((e) => [e.file, e.kind, e.label, e.nameKind]), [['Nav.vue', 'link', 'home', 'static'], ['Nav.vue', 'link', '', 'dynamic']]);
  assert.equal(els[0].recommendedLocator, 'page.getByRole(\'link\', { name: \'home\', exact: true })');
});

test('vue: a wrapper that passes its content is named by that content', () => {
  const root = project({
    'MyButton.vue': '<template>\n<button class="btn"><slot /></button>\n</template>',
    'Page.vue': '<template>\n<MyButton>Save</MyButton>\n</template>',
  });
  const els = scan(root, { framework: 'vue' }).elements;
  assert.deepEqual(els.map((e) => [e.file, e.kind, e.label]), [['Page.vue', 'button', 'Save']]);
});

test('vue: a component with two controls is not a wrapper', () => {
  const root = project({
    'Pair.vue': '<template>\n<div><button>Yes</button><button><slot /></button></div>\n</template>',
    'Page.vue': '<template>\n<Pair>No</Pair>\n</template>',
  });
  assert.deepEqual(scan(root, { framework: 'vue' }).elements.map((e) => e.file), ['Pair.vue', 'Pair.vue']);
});

test('react: a wrapper around a button is listed where it is used', () => {
  const root = project({
    'Fancy.tsx': 'export function Fancy({ children, ...rest }) { return <button className="f" {...rest}>{children}</button>; }',
    'Page.tsx': 'import { Fancy } from "./Fancy";\nexport function Page() { return <main><Fancy>Delete</Fancy></main>; }',
  });
  const els = scan(root, { framework: 'react' }).elements;
  assert.deepEqual(els.map((e) => [e.file, e.kind, e.label]), [['Page.tsx', 'button', 'Delete']]);
});

test('angular: ng-content wrapper, and Material tags found by the coverage run', () => {
  const root = project({
    'package.json': '{"dependencies":{"@angular/material":"12.0.0"}}',
    'app-link.component.ts': '@Component({ selector: \'app-link\', template: `<a routerLink="/x"><ng-content></ng-content></a>` }) export class L {}',
    'page.component.html': '<app-link>Orders</app-link>\n<mat-datepicker-toggle [for]="p"></mat-datepicker-toggle>\n<mat-slider aria-label="Volume"></mat-slider>\n<mat-chip>One</mat-chip>',
  });
  const els = scan(root, { framework: 'angular' }).elements;
  assert.deepEqual(els.map((e) => [e.kind, e.label]), [['link', 'Orders'], ['button', 'Open calendar'], ['input', 'Volume'], ['option', 'One']]);
});

test('vue: an aria-label written on the wrapper wins over the name the wrapper sets itself', () => {
  const root = project({
    'AppLink.vue': '<template>\n<RouterLink :aria-label="props.name" :to="props"><slot /></RouterLink>\n</template>',
    'Nav.vue': '<template>\n<AppLink name="home" aria-label="Start page">Home</AppLink>\n</template>',
  });
  assert.deepEqual(scan(root, { framework: 'vue' }).elements.map((e) => e.label), ['Start page']);
});

test('a name that is unique in its file but also in another component on the same page needs review', () => {
  const root = project({
    'App.vue': '<template>\n<TopBar />\n<RouterView />\n<BottomBar />\n</template>',
    'TopBar.vue': '<template>\n<a href="/">Home</a>\n<a href="/a">About</a>\n</template>',
    'BottomBar.vue': '<template>\n<a href="/">Home</a>\n</template>',
    'Missing.vue': '<template>\n<a href="/">Home</a>\n<a href="/c">Contact</a>\n</template>',
    'Other.vue': '<template>\n<a href="/c">Contact</a>\n</template>',
  });
  const els = scan(root, { framework: 'vue' }).elements;
  const status = (file: string, label: string) => els.find((e) => e.file === file && e.label === label)?.status;
  assert.equal(status('TopBar.vue', 'Home'), 'Manual review'); // BottomBar is next to it in App
  assert.equal(status('BottomBar.vue', 'Home'), 'Manual review');
  assert.equal(status('Missing.vue', 'Home'), 'Manual review'); // a routed page inside the frame that has TopBar
  assert.equal(status('TopBar.vue', 'About'), 'OK (name)');
  assert.equal(status('Missing.vue', 'Contact'), 'OK (name)'); // two routed pages are not shown together
  assert.match(els.find((e) => e.file === 'TopBar.vue' && e.label === 'Home')?.reason ?? '', /also used in (BottomBar|Missing)\.vue:2/);
});

test('alternatives are not on the page together', () => {
  const root = project({
    'Page.tsx': 'import {A} from "./A"; import {B} from "./B";\nexport function Page({ on }) { return on ? <A /> : <B />; }',
    'A.tsx': 'export function A() { return <button>Save</button>; }',
    'B.tsx': 'export function B() { return <button>Save</button>; }',
  });
  assert.deepEqual(scan(root, { framework: 'react' }).elements.map((e) => e.status), ['OK (name)', 'OK (name)']);
});
