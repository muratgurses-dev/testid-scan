/**
 * The same name in two arms of one if/else or switch is not a duplicate: only one arm is on the page at a time.
 * The same name outside such a pair still is.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanJsx, scanTemplate, scanVue } from '../src/index.ts';
import type { ElementRecord } from '../src/index.ts';

const statuses = (rows: ElementRecord[], label: string) => rows.filter((r) => r.label === label).map((r) => r.status);

test('Angular @if / @else if / @else: the same name in different arms is OK', () => {
  const rows = scanTemplate([
    '@if (saving) {',
    '  <button disabled>Save</button>',
    '} @else if (dirty) {',
    '  <span><button (click)="save()">Save</button></span>',
    '} @else {',
    '  <button (click)="save()">Save</button>',
    '}',
  ].join('\n'));
  assert.deepEqual(statuses(rows, 'Save'), ['OK (name)', 'OK (name)', 'OK (name)']);
  assert.match(rows[0].reason ?? '', /another branch/);
  assert.equal(rows[0].locatorScope, 'page-candidate');
});

test('Angular @switch: the same name in two cases is OK', () => {
  const rows = scanTemplate([
    '@switch (mode) {',
    "  @case ('a') { <a routerLink=\"/a\">Go</a> }",
    '  @default { <a routerLink="/b">Go</a> }',
    '}',
  ].join('\n'));
  assert.deepEqual(statuses(rows, 'Go'), ['OK (name)', 'OK (name)']);
});

test('Angular *ngIf with else template and *ngSwitchCase are alternatives', () => {
  const rows = scanTemplate([
    '<button *ngIf="a; else other" (click)="x()">Next</button>',
    '<ng-template #other><button (click)="y()">Next</button></ng-template>',
    '<div [ngSwitch]="mode">',
    '  <button *ngSwitchCase="\'a\'" (click)="a()">Run</button>',
    '  <button *ngSwitchDefault (click)="b()">Run</button>',
    '</div>',
  ].join('\n'));
  assert.deepEqual(statuses(rows, 'Next'), ['OK (name)', 'OK (name)']);
  assert.deepEqual(statuses(rows, 'Run'), ['OK (name)', 'OK (name)']);
});

test('Angular: an @if without else, or two plain elements, still count as duplicates', () => {
  const rows = scanTemplate([
    '@if (z) { <button (click)="e()">Help</button> }',
    '<button (click)="f()">Help</button>',
    '<button (click)="c()">Close</button>',
    '<button (click)="d()">Close</button>',
  ].join('\n'));
  assert.deepEqual(statuses(rows, 'Help'), ['Needs test ID', 'Needs test ID']);
  assert.deepEqual(statuses(rows, 'Close'), ['Needs test ID', 'Needs test ID']);
});

test('Angular: two separate @if/@else chains are not alternatives of each other', () => {
  const rows = scanTemplate([
    '@if (a) { <button (click)="x()">Save</button> } @else { <span></span> }',
    '@if (b) { <button (click)="y()">Save</button> } @else { <span></span> }',
  ].join('\n'));
  assert.deepEqual(statuses(rows, 'Save'), ['Needs test ID', 'Needs test ID']);
});

test('Angular: the same fixed test ID in two arms is not a duplicate', () => {
  const rows = scanTemplate([
    '@if (a) { <button data-testid="orders-save-button" disabled>Save</button> }',
    '@else { <button data-testid="orders-save-button" (click)="s()">Save</button> }',
  ].join('\n'));
  assert.deepEqual(rows.map((r) => r.violations), [[], []]);
  assert.deepEqual(rows.map((r) => r.status), ['OK (test ID)', 'OK (test ID)']);
});

test('Vue v-if / v-else-if / v-else chain: alternatives; a second v-if starts a new chain', () => {
  const rows = scanVue([
    '<template>',
    '  <button v-if="saving" disabled>Save</button>',
    '  <button v-else-if="dirty" @click="save">Save</button>',
    '  <div v-else><button @click="save">Save</button></div>',
    '  <button v-if="a" @click="x">Open</button>',
    '  <button v-if="b" @click="y">Open</button>',
    '</template>',
  ].join('\n'));
  assert.deepEqual(statuses(rows, 'Save'), ['OK (name)', 'OK (name)', 'OK (name)']);
  assert.deepEqual(statuses(rows, 'Open'), ['Needs test ID', 'Needs test ID']);
});

test('React ternary, if/else and early return: alternatives; && is not', () => {
  const rows = scanJsx([
    'export const A = ({ s }: { s: boolean }) => (',
    '  <div>{s ? <button disabled>Save</button> : <button onClick={() => {}}>Save</button>}</div>',
    ');',
    'export function B({ loading }: { loading: boolean }) {',
    '  if (loading) return <button disabled>Send</button>;',
    '  return <form><button onClick={() => {}}>Send</button></form>;',
    '}',
    'export function C({ a }: { a: boolean }) {',
    '  if (a) { return <a href="/x">Next</a>; } else { return <a href="/y">Next</a>; }',
    '}',
    'export const D = ({ a }: { a: boolean }) => <div>{a && <button>Open</button>}<button>Open</button></div>;',
  ].join('\n'));
  assert.deepEqual(statuses(rows, 'Save'), ['OK (name)', 'OK (name)']);
  assert.deepEqual(statuses(rows, 'Send'), ['OK (name)', 'OK (name)']);
  assert.deepEqual(statuses(rows, 'Next'), ['OK (name)', 'OK (name)']);
  assert.deepEqual(statuses(rows, 'Open'), ['Needs test ID', 'Needs test ID']);
});

test('conditional: elements shown only under a condition are marked, in all three frameworks', () => {
  const ng = scanTemplate([
    '<button (click)="a()">Always</button>',
    '@if (x) { <button (click)="b()">Block</button> }',
    '<button *ngIf="y" (click)="c()">Directive</button>',
    '<ng-template #t><button (click)="d()">Template</button></ng-template>',
  ].join('\n'));
  assert.deepEqual(ng.map((r) => [r.label, r.conditional]), [['Always', false], ['Block', true], ['Directive', true], ['Template', true]]);
  const vue = scanVue('<template><button @click="a">Always</button><button v-if="x" @click="b">If</button><button v-show="y" @click="c">Show</button></template>');
  assert.deepEqual(vue.map((r) => [r.label, r.conditional]), [['Always', false], ['If', true], ['Show', true]]);
  const react = scanJsx([
    'export const A = ({ x, busy }: { x: boolean; busy: boolean }) => {',
    '  if (busy) return <button>Wait</button>;',
    '  return <div><button>Always</button>{x && <button>And</button>}{x ? <button>Yes</button> : null}</div>;',
    '};',
    'export const B = () => <div><button>Plain</button></div>;',
  ].join('\n'));
  assert.deepEqual(react.map((r) => [r.label, r.conditional]), [['Wait', true], ['Always', true], ['And', true], ['Yes', true], ['Plain', false]]);
});

test('alternatives: each arm names the lines of the same element in the other arms', () => {
  const rows = scanTemplate([
    '@if (saving) {',
    '  <button disabled>Save</button>',
    '} @else {',
    '  <button (click)="save()">Save</button>',
    '}',
    '<button (click)="x()">Close</button>',
  ].join('\n'));
  assert.deepEqual(rows.map((r) => [r.label, r.line, r.alternatives]), [['Save', 2, [4]], ['Save', 4, [2]], ['Close', 6, undefined]]);
});

test('conditional: JSX passed as a prop and named slot content are shown when the component decides (found by the reviewer)', () => {
  const react = scanJsx([
    'export const A = () => (',
    '  <FormDrawer triggerButton={<Button>Create</Button>} submitButton={<Button type="submit">Submit</Button>}>',
    '    <button>Inside</button>',
    '  </FormDrawer>',
    ');',
  ].join('\n'), { components: { Button: 'button' } });
  assert.deepEqual(react.filter((r) => r.kind === 'button').map((r) => [r.label, r.conditional]), [['Create', true], ['Submit', true], ['Inside', false]]);
  const vue = scanVue('<template><MyDialog><template #footer><button @click="ok">OK</button></template><button @click="x">Body</button></MyDialog></template>');
  assert.deepEqual(vue.filter((r) => r.kind === 'button').map((r) => [r.label, r.conditional]), [['OK', true], ['Body', false]]);
});

test('conditional: JSX inside a function passed as children is shown when the component calls it (found by the React source-map run)', () => {
  const react = scanJsx([
    'export const A = ({ items }) => (',
    '  <Form onSubmit={save}>',
    '    {({ register }) => <button>Inside</button>}',
    '    <ul>{items.map((i) => <li key={i}><button>Row</button></li>)}</ul>',
    '    <button>Plain</button>',
    '  </Form>',
    ');',
  ].join('\n'), { components: {} });
  assert.deepEqual(react.filter((r) => r.kind === 'button').map((r) => [r.label, r.conditional]), [['Inside', true], ['Row', false], ['Plain', false]]);
});
