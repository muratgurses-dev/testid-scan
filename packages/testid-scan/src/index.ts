export { defaultConfig, loadConfigFile, mergeConfig } from './config.ts';
export type { ComponentSpec, Config } from './config.ts';
export { countElements } from './classify.ts';
export { detectFrameworks, scan, scanJsx, scanTemplate, scanVue } from './scan.ts';
export { renderGithub, renderMarkdown, renderText, summaryLine } from './report.ts';
export type { ReportOptions } from './report.ts';
export type { AccessibilityFinding, Counts, ElementRecord, FileResult, Framework, LocatorScope, ScanResult, Status } from './types.ts';
export { compareWithBaseline, createBaseline } from './baseline.ts';
export type { Baseline, BaselineDiff } from './baseline.ts';
