/** Walks a folder, hands each file to the adapter for its framework, and collects the results. */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { angularCandidates, componentSelectors, inlineTemplates, templateUrls } from './angular/adapter.ts';
import { classify, countElements } from './classify.ts';
import { applyComponentUsage, namesSharedOnPage } from './components.ts';
import type { Unit } from './components.ts';
import { defaultConfig, mergeConfig } from './config.ts';
import type { Config } from './config.ts';
import { createContext } from './i18n.ts';
import { reactCandidates } from './react/adapter.ts';
import { vueCandidates, vueTemplate } from './vue/adapter.ts';
import type { ElementRecord, FileResult, Framework, ScanResult } from './types.ts';

/** Classify the templates of one scan, after looking at how they use each other. */
function classifyUnits(units: Unit[], cfg: Config): ElementRecord[][] {
  if (cfg.followComponents) applyComponentUsage(units);
  const shared = cfg.followComponents ? namesSharedOnPage(units) : undefined;
  return units.map((unit) => classify(unit.candidates, unit.file, cfg, shared));
}

/** Scan one Angular template string. Handy for editor plugins and unit tests. */
export function scanTemplate(source: string, options: Partial<Config> = {}, file = 'template.html'): ElementRecord[] {
  const cfg = mergeConfig(defaultConfig, options);
  if (cfg.placeholderAsLabel === 'auto') cfg.placeholderAsLabel = 'never';
  return classify(angularCandidates(source, createContext(cfg)), file, cfg);
}

/** Scan the JSX in one React source string. The file name decides between TSX and JSX syntax. */
export function scanJsx(source: string, options: Partial<Config> = {}, file = 'component.tsx'): ElementRecord[] {
  const cfg = mergeConfig(defaultConfig, options);
  return classifyUnits([{ file, framework: 'react', owners: [], candidates: reactCandidates(source, file, createContext(cfg)) }], cfg)[0];
}

/** Scan one Vue single-file component (the whole .vue text). */
export function scanVue(source: string, options: Partial<Config> = {}, file = 'Component.vue'): ElementRecord[] {
  const cfg = mergeConfig(defaultConfig, options);
  const template = vueTemplate(source);
  if ('skipped' in template) return [];
  return classify(vueCandidates(template.source, createContext(cfg), template.lineOffset), file, cfg);
}

/** Dependencies of each package.json at or above `root`, nearest first. */
function* packageDependencies(root: string): Generator<Record<string, string>> {
  for (let dir = root, depth = 0; depth < 8; dir = dirname(dir), depth += 1) {
    const path = join(dir, 'package.json');
    if (existsSync(path)) {
      try {
        const pkg = JSON.parse(readFileSync(path, 'utf8')) as Record<string, Record<string, string> | undefined>;
        yield { ...pkg.peerDependencies, ...pkg.devDependencies, ...pkg.dependencies };
      } catch { /* unreadable package.json: keep looking */ }
    }
    if (dirname(dir) === dir) break;
  }
}

/** Major version of Angular Material used by the project, if it can be read. */
export function angularMaterialMajor(root: string): number | undefined {
  for (const deps of packageDependencies(root)) {
    const major = /\d+/.exec(deps['@angular/material'] ?? '')?.[0];
    if (major) return Number(major);
  }
  return undefined;
}

/** Frameworks named in the nearest package.json at or above `root`; all of them when it does not say. */
export function detectFrameworks(root: string): Framework[] {
  for (const deps of packageDependencies(root)) {
    const found: Framework[] = [];
    if ('@angular/core' in deps) found.push('angular');
    if (['react', 'preact', 'next'].some((name) => name in deps)) found.push('react');
    if (['vue', 'nuxt'].some((name) => name in deps)) found.push('vue');
    if (found.length) return found;
  }
  return ['angular', 'react', 'vue'];
}

/** Group = the folder path between the scan root and the component's own folder (at most three levels). */
function folderOf(relFile: string): string {
  const segments = relFile.split('/');
  const fileName = segments.at(-1) ?? '';
  const parts = segments.slice(0, -1);
  const ownFolder = parts.at(-1);
  if (ownFolder && fileName.toLowerCase().startsWith(ownFolder.toLowerCase())) parts.pop();
  return parts.slice(0, 3).join('/') || '(root)';
}

const TEST_FILE = /\.(test|spec|stories|story|d)\.[cm]?[jt]sx?$/i;

/** Scan every template under `folder`. Reads files only; never writes. */
export function scan(folder: string, options: Partial<Config> = {}): ScanResult {
  const cfg = mergeConfig(defaultConfig, options);
  const root = resolve(folder);
  const legacyMaterial = (angularMaterialMajor(root) ?? 99) < 15;
  if (cfg.placeholderAsLabel === 'auto') cfg.placeholderAsLabel = legacyMaterial ? 'always' : 'never';
  // before version 15 every <mat-chip> is a selectable option; later only <mat-chip-option> is
  if (legacyMaterial && !Object.hasOwn(cfg.elements, 'mat-chip')) cfg.elements = { ...cfg.elements, 'mat-chip': 'option' };
  const ctx = createContext(cfg);
  const frameworks = cfg.framework === 'auto' ? detectFrameworks(root) : [cfg.framework];
  const angular = frameworks.includes('angular');
  const react = frameworks.includes('react');
  const vue = frameworks.includes('vue');
  const reactExtensions = cfg.reactExtensions.map((e) => e.toLowerCase());
  const rel = (p: string) => relative(root, p).replace(/\\/g, '/');
  const units: Unit[] = [];
  const notScanned: ScanResult['notScanned'] = { otherHtml: [], unreadable: [] };
  const add = (file: string, framework: Framework, candidates: Unit['candidates'], owners: string[] = []) => units.push({ file, framework, candidates, owners });

  // Angular .html files are decided after the walk, once every templateUrl has been seen
  const htmlFiles: string[] = [];
  const referencedHtml = new Map<string, string[]>(); // template path -> selectors of the component that names it

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { if (!cfg.ignoreDirs.includes(entry.name)) walk(path); continue; }
      if (!entry.isFile()) continue;
      const name = entry.name;
      const lower = name.toLowerCase();
      const file = rel(path);

      if (react && reactExtensions.some((ext) => lower.endsWith(ext)) && !TEST_FILE.test(name)) {
        const candidates = reactCandidates(readFileSync(path, 'utf8'), name, ctx);
        if (candidates.length) add(file, 'react', candidates); // files without JSX are not listed
        continue;
      }
      if (vue && lower.endsWith('.vue')) {
        const template = vueTemplate(readFileSync(path, 'utf8'));
        if ('skipped' in template) notScanned.unreadable.push({ file, reason: template.skipped });
        else add(file, 'vue', vueCandidates(template.source, ctx, template.lineOffset), [basename(name, '.vue')]);
        continue;
      }
      if (!angular) continue;
      if (lower.endsWith('.html')) {
        if (lower !== 'index.html') htmlFiles.push(path);
      } else if (lower.endsWith('.ts') && !TEST_FILE.test(name)) {
        const text = readFileSync(path, 'utf8');
        const selectors = componentSelectors(text);
        for (const url of templateUrls(text)) referencedHtml.set(resolve(dir, url), selectors);
        const found = inlineTemplates(text);
        for (const reason of found.skipped) notScanned.unreadable.push({ file, reason });
        if (!found.templates.length) continue;
        if (!cfg.inlineTemplates) { notScanned.unreadable.push({ file, reason: 'inline templates are switched off' }); continue; }
        // each inline template is its own template: names and IDs are compared within it
        for (const t of found.templates) add(file, 'angular', angularCandidates(t.source, ctx, t.lineOffset), selectors);
      }
    }
  };
  walk(root);
  for (const path of htmlFiles) {
    const file = rel(path);
    // a template is: named *.component.html, or named by some component's templateUrl, or everything with allHtml
    if (!cfg.allHtml && !path.toLowerCase().endsWith('.component.html') && !referencedHtml.has(path)) { notScanned.otherHtml.push(file); continue; }
    add(file, 'angular', angularCandidates(readFileSync(path, 'utf8'), ctx), referencedHtml.get(path) ?? []);
  }

  // every template is read; now look at how they use each other, then classify
  const classified = classifyUnits(units, cfg);
  const byFile = new Map<string, FileResult>();
  units.forEach((unit, i) => {
    const entry: FileResult = byFile.get(unit.file) ?? { file: unit.file, folder: folderOf(unit.file), framework: unit.framework, elements: [] };
    entry.elements.push(...classified[i]); // several inline templates of one file end up in one entry
    if (unit.framework === 'angular' && unit.owners.length) entry.selectors = [...new Set([...(entry.selectors ?? []), ...unit.owners])].sort();
    byFile.set(unit.file, entry);
  });
  const files = [...byFile.values()].sort((a, b) => a.file.localeCompare(b.file));

  const elements = files.flatMap((f) => f.elements);
  const idFiles = new Map<string, Set<string>>();
  for (const e of elements) {
    if (e.testIdKind !== 'static' || !e.testId) continue;
    if (!idFiles.has(e.testId)) idFiles.set(e.testId, new Set());
    idFiles.get(e.testId)!.add(`${e.file}:${e.line}`);
  }
  const sharedTestIds = [...idFiles.entries()]
    .filter(([, locations]) => new Set([...locations].map((l) => l.slice(0, l.lastIndexOf(':')))).size > 1)
    .map(([testId, locations]) => ({ testId, locations: [...locations].sort() }))
    .sort((a, b) => a.testId.localeCompare(b.testId));

  return {
    schemaVersion: 1,
    source: folder, scannedOn: new Date().toISOString().slice(0, 10), frameworks, strict: cfg.strict,
    files, elements, totals: countElements(elements), sharedTestIds, notScanned,
  };
}
