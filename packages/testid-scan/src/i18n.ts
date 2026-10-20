import { readFileSync } from 'node:fs';
import type { Config } from './config.ts';

/** A piece of text found in a template; `dynamic` when part of it is only known at runtime. */
export interface Text { text: string; dynamic: boolean; keys: string[]; missingKeys: string[] }

export const DYNAMIC_TEXT: Text = { text: '', dynamic: true, keys: [], missingKeys: [] };

export interface ScanContext {
  cfg: Config;
  /** Flattened translations ("a.b.c" -> text), when an i18n file was given. */
  i18n?: Map<string, string>;
}

/** Nested translation JSON -> "a.b.c" keys. */
export function flattenTranslations(value: unknown, prefix = '', out = new Map<string, string>()): Map<string, string> {
  if (typeof value === 'string') out.set(prefix, value);
  else if (typeof value === 'object' && value !== null) {
    for (const [k, v] of Object.entries(value)) flattenTranslations(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}

export function createContext(cfg: Config): ScanContext {
  if (!cfg.i18nFile) return { cfg };
  try {
    return { cfg, i18n: flattenTranslations(JSON.parse(readFileSync(cfg.i18nFile, 'utf8'))) };
  } catch (error) {
    throw new Error(`Cannot read i18n file ${cfg.i18nFile}: ${(error as Error).message}`);
  }
}

/**
 * The text of a fixed translation key. Without an i18n file the key itself stands for the text.
 * A translation with placeholders ("Delete {{name}}", "Delete {name}") depends on runtime values.
 */
export function translateKey(ctx: ScanContext, key: string): Text {
  if (!ctx.i18n) return { text: key, dynamic: false, keys: [key], missingKeys: [] };
  const resolved = ctx.i18n.get(key);
  if (resolved === undefined) return { text: key, dynamic: false, keys: [key], missingKeys: [key] };
  if (/\{\{|\{\s*\w+\s*\}/.test(resolved)) return { ...DYNAMIC_TEXT, keys: [key] };
  return { text: resolved, dynamic: false, keys: [key], missingKeys: [] };
}

/** Join several pieces of text into one. */
export function joinText(parts: Text[]): Text {
  return {
    text: parts.map((p) => p.text).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(),
    dynamic: parts.some((p) => p.dynamic),
    keys: parts.flatMap((p) => p.keys),
    missingKeys: parts.flatMap((p) => p.missingKeys),
  };
}
