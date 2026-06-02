#!/usr/bin/env node
/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
/**
 * build-modifiers.js
 *
 * Compiles the kit-owned modifier source (src/modifiers/bliss-modifiers.js) into
 * the frozen `data/modifiers.json`.
 *
 * Each entry gets two readings:
 *   gloss       the symbol's OWN standalone meaning. By default DATA-DRIVEN, looked
 *               up in the snapshot like any other entry (single code → by id;
 *               multi-code → by canonical spelling, then base sequence; '' if none).
 *               A source entry may set `gloss` to OVERRIDE this (e.g. to drop a
 *               prefix-only sense from the standalone meaning).
 *   asPrefix    how the glyph reads when prefixing what follows, taken verbatim
 *               from the curated list in src/modifiers/bliss-modifiers.js.
 *
 * Membership/tiers/conditionals originate from the BCI-AV head-glyph exclusions in
 * bliss-svg-builder (referenced, not vendored). Never hand-edit data/modifiers.json.
 *
 * Run:  node bin/build-modifiers.js   [--source <snapshot.json>]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { modifiers, conditionalExceptions, knownGaps } from '../src/modifiers/bliss-modifiers.js';
import { normalizeSpelling, parseBCodeWord } from '../src/lib/bcode.js';

const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = resolve(KIT_ROOT, 'data/modifiers.json');
const sourceArg = (() => {
  const i = process.argv.indexOf('--source');
  return i !== -1 && process.argv[i + 1] ? resolve(process.cwd(), process.argv[i + 1]) : null;
})();
const SNAPSHOT = sourceArg || resolve(KIT_ROOT, 'data/blissary-bliss-dictionary-export-2026-05-23.json');

const main = async () => {
  // Build the snapshot gloss lookups (by B-id for single codes; by canonical
  // spelling for multi-code sequences). First occurrence wins.
  const raw = JSON.parse(await readFile(SNAPSHOT, 'utf8'));
  const rows = Array.isArray(raw) ? raw : raw.data;
  const baseOf = (code) => {
    try {
      return parseBCodeWord(code).characters.map((c) => c.baseSpelling).join('/');
    } catch {
      return null;
    }
  };
  const glossById = new Map();
  const glossBySpelling = new Map();
  const glossByBase = new Map(); // indicator-agnostic fallback (e.g. doubled quantifiers)
  for (const row of rows) {
    const id = `B${Number(row.id)}`;
    const gloss = `${row.gloss || ''}`.trim();
    if (!glossById.has(id)) glossById.set(id, gloss);
    try {
      const sp = normalizeSpelling(row.code);
      if (!glossBySpelling.has(sp)) glossBySpelling.set(sp, gloss);
    } catch {
      // shape/primitive codes have no word spelling
    }
    const b = baseOf(row.code);
    if (b && !glossByBase.has(b)) glossByBase.set(b, gloss);
  }
  const dictGloss = (spelling, codes) => {
    if (codes.length === 1) return glossById.get(spelling) || '';
    try {
      const exact = glossBySpelling.get(normalizeSpelling(spelling));
      if (exact) return exact;
    } catch {
      // fall through to base match
    }
    const b = baseOf(spelling);
    return (b && glossByBase.get(b)) || '';
  };

  const seen = new Set();
  const noPrefixReading = [];
  const entries = modifiers.map((m) => {
    if (seen.has(m.spelling)) throw new Error(`Duplicate modifier spelling in source: ${m.spelling}`);
    seen.add(m.spelling);
    const codes = m.spelling.split('/');
    // gloss: an explicit source override wins; otherwise the snapshot dictionary gloss.
    const gloss = typeof m.gloss === 'string' ? m.gloss : dictGloss(m.spelling, codes);
    const asPrefix = Array.isArray(m.asPrefix) ? m.asPrefix : [];
    if (asPrefix.length === 0) noPrefixReading.push(m.spelling);
    return { spelling: m.spelling, codes, category: m.category, tier: m.tier, gloss, asPrefix };
  });

  const tiers = {
    'absolute-never-head': entries.filter((e) => e.tier === 'absolute-never-head').map((e) => e.spelling),
    'low-priority': entries.filter((e) => e.tier === 'low-priority').map((e) => e.spelling)
  };
  const categories = [...new Set(entries.map((e) => e.category))];

  const modifiersJson = {
    $schema: 'blissbench/modifiers@3',
    $source:
      'src/modifiers/bliss-modifiers.js: kit-owned modifier set. Membership/tiers/conditionals ' +
      'originate from the BCI-AV head-glyph exclusions in bliss-svg-builder ' +
      '(https://github.com/hlridge/bliss-svg-builder, MPL-2.0), referenced not vendored. ' +
      "`gloss` is the symbol's own dictionary gloss from the snapshot (data-driven); " +
      '`asPrefix` is how it reads when prefixing what follows (curated in the source).',
    $regenerate: 'node bin/build-modifiers.js',
    tiers,
    conditionalExceptions,
    categories,
    knownGaps,
    count: entries.length,
    entries
  };

  await writeFile(OUTPUT, `${JSON.stringify(modifiersJson, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${OUTPUT}`);
  console.log(`  ${entries.length} modifier sequences across ${categories.length} categories`);
  console.log(`  tiers: never-head=${tiers['absolute-never-head'].length}, low-priority=${tiers['low-priority'].length}, conditional=${conditionalExceptions.length}`);
  const overrides = modifiers.filter((m) => typeof m.gloss === 'string').length;
  console.log(`  gloss: ${entries.filter((e) => e.gloss).length}/${entries.length} have a gloss (${overrides} curated override(s), rest data-driven)`);
  if (noPrefixReading.length) {
    console.warn(`  ⚠ ${noPrefixReading.length} have no asPrefix reading: ${noPrefixReading.join(', ')}`);
  }
  if (knownGaps.length) console.log(`  known gaps: ${knownGaps.join('; ')}`);
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
