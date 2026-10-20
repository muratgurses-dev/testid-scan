/**
 * A baseline is a snapshot of the findings of one scan. Later scans are compared with it, so a project that
 * starts with hundreds of findings can still fail its build on every new one.
 */
import type { Counts, ElementRecord, ScanResult } from './types.ts';

export interface Baseline {
  schemaVersion: 1;
  createdOn: string;
  totals: Counts;
  /** Finding -> how many times it occurred. Line numbers are left out, so moving code does not make a finding new. */
  findings: Record<string, number>;
}

export interface BaselineDiff {
  /** Findings of this scan that the baseline does not have. */
  added: ElementRecord[];
  /** How many findings of the baseline are gone. */
  resolved: number;
  previous: Counts;
  createdOn: string;
}

const OPEN = new Set(['Needs test ID', 'Missing name', 'Fix test ID', 'Manual review']);
/** Something a person still has to act on: a to-do, a manual review, or a test ID that breaks a rule. */
export const isFinding = (e: ElementRecord) => OPEN.has(e.status) || e.violations.length > 0;

const keyOf = (e: ElementRecord) => [e.file, e.tag, e.kind, e.status, e.label, e.testId ?? '', e.violations.join(';')].join('|');

export function createBaseline(result: ScanResult): Baseline {
  const findings: Record<string, number> = {};
  for (const e of result.elements) if (isFinding(e)) findings[keyOf(e)] = (findings[keyOf(e)] ?? 0) + 1;
  return { schemaVersion: 1, createdOn: result.scannedOn, totals: result.totals, findings: Object.fromEntries(Object.entries(findings).sort(([a], [b]) => a.localeCompare(b))) };
}

export function compareWithBaseline(result: ScanResult, baseline: Baseline): BaselineDiff {
  if (baseline.schemaVersion !== 1 || typeof baseline.findings !== 'object') throw new Error('The baseline file is not one this version can read. Write a new one with --update-baseline.');
  const left = new Map(Object.entries(baseline.findings));
  const added: ElementRecord[] = [];
  for (const e of result.elements) {
    if (!isFinding(e)) continue;
    const n = left.get(keyOf(e)) ?? 0;
    if (n > 0) left.set(keyOf(e), n - 1); else added.push(e);
  }
  return { added, resolved: [...left.values()].reduce((a, b) => a + b, 0), previous: baseline.totals, createdOn: baseline.createdOn };
}
