#!/usr/bin/env node
/**
 * Scores the tools against reviewers' labels from the blind labelling kit.
 *
 *   node accuracy/real/score-labels.mjs [--key results/label-key.json] [--out report.md] [--json report.json] labels.csv [more.csv ...]
 *
 * Each CSV has the columns of the kit's labels.csv: id, label (correct | incorrect | cannot tell), and optionally
 * reviewer and review_type (human | ai-assisted | ai). One file per reviewer; with several, their agreement is
 * reported too. "cannot tell" is never counted as correct or incorrect; it is reported separately.
 *
 * The key holds the tools' verdicts; the kit itself never shows them. The referee (the tools' own evidence) is
 * compared with the reviewers as well, but it is not an independent check.
 *
 * Exit codes: 0 scored, 2 a file is invalid (wrong columns, unknown or duplicate ids, labels that are not allowed).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const take = (name) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const keyPath = take('--key') ?? join(dirname(fileURLToPath(import.meta.url)), 'results', 'label-key.json');
const outPath = take('--out');
const jsonPath = take('--json');
if (!args.length) { console.error('Usage: score-labels.mjs [--key label-key.json] [--out report.md] [--json report.json] labels.csv [more.csv ...]'); process.exit(2); }

const LABELS = new Set(['correct', 'incorrect', 'cannot tell']);
const TYPES = new Set(['human', 'ai-assisted', 'ai']);
const VERDICTS = ['verified correct', 'verified incorrect', 'unable to verify'];
const key = JSON.parse(readFileSync(keyPath, 'utf8'));
const frameworkOf = (id) => key[id].framework ?? id.split('#')[0];

/** One CSV line, with "quoted, fields" (a reviewer's note often has commas). */
function fields(line) {
  const out = []; let cur = ''; let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 1; } else if (c === '"') quoted = false; else cur += c; } else if (c === '"') quoted = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}

/** Read and check one reviewer's file. Problems that would bias the score are errors; gaps are warnings. */
function readLabels(path) {
  const lines = readFileSync(path, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const header = fields(lines[0]).map((h) => h.trim().toLowerCase());
  const col = (name) => header.indexOf(name);
  const errors = []; const warnings = [];
  if (col('id') < 0 || col('label') < 0) return { path, errors: [`${path}: the header needs "id" and "label" columns, found: ${header.join(', ')}`], warnings, labels: new Map() };
  const seen = new Map(); const labels = new Map(); let reviewer; let type;
  lines.slice(1).forEach((line, k) => {
    const f = fields(line);
    const id = (f[col('id')] ?? '').trim();
    const label = (f[col('label')] ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    const at = `${path}:${k + 2}`;
    if (!id) return;
    if (!key[id]) { errors.push(`${at}: unknown id ${id} (not in the kit this key belongs to)`); return; }
    if (seen.has(id)) { errors.push(`${at}: ${id} is labelled twice (first at line ${seen.get(id)}); both are left out`); labels.delete(id); return; }
    seen.set(id, k + 2);
    if (label && !LABELS.has(label)) { errors.push(`${at}: label "${label}" is not one of correct, incorrect, cannot tell`); return; }
    if (col('reviewer') >= 0 && f[col('reviewer')]?.trim()) reviewer ??= f[col('reviewer')].trim();
    if (col('review_type') >= 0 && f[col('review_type')]?.trim()) {
      const t = f[col('review_type')].trim().toLowerCase();
      if (!TYPES.has(t)) errors.push(`${at}: review_type "${t}" is not one of human, ai-assisted, ai`); else if (type && type !== t) errors.push(`${at}: review_type changes from ${type} to ${t} within one file`); else type = t;
    }
    if (label) labels.set(id, label);
  });
  const missing = Object.keys(key).filter((id) => !seen.has(id));
  if (missing.length) warnings.push(`${path}: ${missing.length} kit items have no row (${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', ...' : ''})`);
  const empty = [...seen.keys()].filter((id) => !labels.has(id)).length;
  if (empty) warnings.push(`${path}: ${empty} rows have no label`);
  if (!type) warnings.push(`${path}: no review_type: reported as "unspecified", not as independent human review`);
  return { path, reviewer: reviewer ?? basename(path, '.csv'), type: type ?? 'unspecified', errors, warnings, labels };
}

const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
const show = (v, a, b) => (v === null ? 'n/a' : `${v}% (${a} of ${b})`);

/** Scores of one mode (verdicts with or without evidence) against one set of labels. */
function score(labels, field, ids = Object.keys(key)) {
  const items = ids.map((id) => ({ id, tool: key[id][field], human: labels.get(id) }));
  const decisive = items.filter((x) => x.human === 'correct' || x.human === 'incorrect');
  const said = (v) => decisive.filter((x) => x.tool === v);
  const c = said('verified correct'); const i = said('verified incorrect');
  const humanWrong = decisive.filter((x) => x.human === 'incorrect');
  const toolDecisive = decisive.filter((x) => x.tool !== 'unable to verify');
  const matrix = Object.fromEntries(VERDICTS.map((v) => [v, Object.fromEntries(['correct', 'incorrect', 'cannot tell', 'no label'].map((h) => [h, items.filter((x) => x.tool === v && (x.human ?? 'no label') === h).length]))]));
  const n = (arr, pred) => arr.filter(pred).length;
  return {
    items: items.length, labelledDecisive: decisive.length, cannotTell: n(items, (x) => x.human === 'cannot tell'), noLabel: n(items, (x) => !x.human),
    correctPrecision: { value: pct(n(c, (x) => x.human === 'correct'), c.length), of: c.length, hit: n(c, (x) => x.human === 'correct') },
    falseAssuranceRate: { value: pct(n(c, (x) => x.human === 'incorrect'), c.length), of: c.length, hit: n(c, (x) => x.human === 'incorrect') },
    incorrectPrecision: { value: pct(n(i, (x) => x.human === 'incorrect'), i.length), of: i.length, hit: n(i, (x) => x.human === 'incorrect') },
    falseAlarmRate: { value: pct(n(i, (x) => x.human === 'correct'), i.length), of: i.length, hit: n(i, (x) => x.human === 'correct') },
    incorrectRecall: { value: pct(n(humanWrong, (x) => x.tool === 'verified incorrect'), humanWrong.length), of: humanWrong.length, hit: n(humanWrong, (x) => x.tool === 'verified incorrect') },
    unableRate: { value: pct(n(items, (x) => x.tool === 'unable to verify'), items.length), of: items.length, hit: n(items, (x) => x.tool === 'unable to verify') },
    agreement: { value: pct(n(toolDecisive, (x) => (x.tool === 'verified correct') === (x.human === 'correct')), toolDecisive.length), of: toolDecisive.length, hit: n(toolDecisive, (x) => (x.tool === 'verified correct') === (x.human === 'correct')) },
    coverage: { value: pct(toolDecisive.length, decisive.length), of: decisive.length, hit: toolDecisive.length },
    matrix,
  };
}

/** Cohen's kappa of two reviewers on the items both labelled (cannot tell is a category of its own). */
function kappa(a, b) {
  const both = [...a.labels.keys()].filter((id) => b.labels.has(id));
  if (!both.length) return null;
  const cats = ['correct', 'incorrect', 'cannot tell'];
  const agree = both.filter((id) => a.labels.get(id) === b.labels.get(id)).length / both.length;
  const expected = cats.reduce((s, c) => s + (both.filter((id) => a.labels.get(id) === c).length / both.length) * (both.filter((id) => b.labels.get(id) === c).length / both.length), 0);
  return { items: both.length, agreement: Math.round(1000 * agree) / 10, kappa: expected === 1 ? 1 : Math.round(1000 * ((agree - expected) / (1 - expected))) / 1000 };
}

const reviews = args.map(readLabels);
const errors = reviews.flatMap((r) => r.errors);
for (const w of reviews.flatMap((r) => r.warnings)) console.error(`warning: ${w}`);
if (errors.length) { for (const e of errors) console.error(`error: ${e}`); console.error('Fix the files and score again: invalid rows would bias the result.'); process.exit(2); }

const frameworks = [...new Set(Object.keys(key).map(frameworkOf))].sort();
const metricRows = [
  ['verified correct, reviewer agrees (precision)', 'correctPrecision'],
  ['false assurance rate (verified correct, reviewer says incorrect)', 'falseAssuranceRate'],
  ['verified incorrect, reviewer agrees (precision)', 'incorrectPrecision'],
  ['false alarm rate (verified incorrect, reviewer says correct)', 'falseAlarmRate'],
  ['incorrect locators the tool verified incorrect (recall)', 'incorrectRecall'],
  ['unable to verify', 'unableRate'],
  ['agreement where both decided', 'agreement'],
  ['coverage: reviewer-decided items the tool decided too', 'coverage'],
];
const out = { key: keyPath, reviews: [], interRater: [] };
const md = ['# Reviewer scoring', '', `Key: ${keyPath} · ${Object.keys(key).length} kit items · frameworks: ${frameworks.join(', ')}`, ''];
for (const r of reviews) {
  const independent = r.type === 'human';
  md.push(`## ${r.reviewer} — ${r.path}`, '', independent
    ? 'Review type: **human**.'
    : `Review type: **${r.type}**. This is ${r.type === 'unspecified' ? 'not marked as' : 'not'} an independent human review; read the numbers as such.`, '');
  const entry = { reviewer: r.reviewer, path: r.path, type: r.type, modes: {} };
  const modes = [['without evidence (a plain production build)', 'verdictWithoutEvidence'], ['with evidence (data-tsrc / Angular hosts)', 'verdictWithEvidence'], ['React production build with source maps (React items only)', 'verdictWithSourceMaps']];
  for (const [mode, field] of modes) {
    // a mode only some apps were checked in (source maps: React) is scored on those apps' items
    const ids = Object.keys(key).filter((id) => key[id][field]);
    if (!ids.length) continue;
    const modeFrameworks = frameworks.filter((f) => ids.some((id) => frameworkOf(id) === f));
    const all = score(r.labels, field, ids);
    const per = Object.fromEntries(modeFrameworks.map((f) => [f, score(r.labels, field, ids.filter((id) => frameworkOf(id) === f))]));
    entry.modes[field] = { all, frameworks: per };
    md.push(`### ${mode}`, '', `Labelled correct or incorrect: ${all.labelledDecisive} of ${all.items}; cannot tell: ${all.cannotTell}; no label: ${all.noLabel} (both left out of the rates below).`, '',
      `| Metric | All | ${modeFrameworks.join(' | ')} |`, `|---|---:|${modeFrameworks.map(() => '---:').join('|')}|`,
      ...metricRows.map(([title, k]) => `| ${title} | ${show(all[k].value, all[k].hit, all[k].of)} | ${modeFrameworks.map((f) => show(per[f][k].value, per[f][k].hit, per[f][k].of)).join(' | ')} |`), '',
      'Confusion matrix (rows: tool verdict, columns: reviewer label):', '',
      '| Tool \\ Reviewer | correct | incorrect | cannot tell | no label |', '|---|---:|---:|---:|---:|',
      ...VERDICTS.map((v) => `| ${v} | ${['correct', 'incorrect', 'cannot tell', 'no label'].map((h) => all.matrix[v][h]).join(' | ')} |`), '');
  }
  const ref = [...r.labels].filter(([id, l]) => key[id].referee && l !== 'cannot tell');
  const refAgree = ref.filter(([id, l]) => (key[id].referee === 'right') === (l === 'correct')).length;
  entry.referee = { agree: refAgree, of: ref.length };
  md.push(`The referee (the tools' own evidence, not independent) agrees with this reviewer on ${show(pct(refAgree, ref.length), refAgree, ref.length)} of the items both settled.`, '');
  out.reviews.push(entry);
}
if (reviews.length > 1) {
  md.push('## Agreement between reviewers', '', '| Reviewers | Items both labelled | Agreement | Cohen\'s kappa |', '|---|---:|---:|---:|');
  for (let a = 0; a < reviews.length; a += 1) for (let b = a + 1; b < reviews.length; b += 1) {
    const k = kappa(reviews[a], reviews[b]);
    out.interRater.push({ a: reviews[a].reviewer, b: reviews[b].reviewer, ...k });
    md.push(`| ${reviews[a].reviewer} / ${reviews[b].reviewer} | ${k?.items ?? 0} | ${k ? `${k.agreement}%` : 'n/a'} | ${k?.kappa ?? 'n/a'} |`);
  }
  md.push('');
}
const text = `${md.join('\n')}\n`;
if (outPath) writeFileSync(outPath, text); else process.stdout.write(text);
if (jsonPath) writeFileSync(jsonPath, `${JSON.stringify(out, null, 2)}\n`);
