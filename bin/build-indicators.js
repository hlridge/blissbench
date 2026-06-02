#!/usr/bin/env node
/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
/**
 * build-indicators.js
 *
 * Compiles the curated indicator source (src/indicators/bliss-indicators.js)
 * into the frozen reference `data/indicators.json`. The curated table is the
 * AUTHORITATIVE source of indicator meaning, deliberately NOT the BCI-AV
 * dictionary, which under-explains indicators and mis-marks some as
 * non-preferred.
 *
 * A soft cross-check reports where the snapshot disagrees with the curated set
 * (a code we curate that the snapshot doesn't flag isIndicator, marks
 * non-preferred, or lacks entirely). These are WARNINGS only: our reference
 * wins, but they document exactly what we are overriding.
 *
 * Run:  node bin/build-indicators.js
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, basename } from 'node:path';
import { indicators, indicatorGroups } from '../src/indicators/bliss-indicators.js';

const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = resolve(KIT_ROOT, 'data/indicators.json');
// Default to the pinned snapshot; `--source <path>` swaps it (keep in step with build-manifest).
const sourceArg = (() => {
  const i = process.argv.indexOf('--source');
  return i !== -1 && process.argv[i + 1] ? resolve(process.cwd(), process.argv[i + 1]) : null;
})();
const SNAPSHOT = sourceArg || resolve(KIT_ROOT, 'data/blissary-bliss-dictionary-export-2026-05-23.json');

const main = async () => {
  // Cross-check against the snapshot (best-effort; our curation is authoritative).
  let snapshotById = new Map();
  try {
    const raw = JSON.parse(await readFile(SNAPSHOT, 'utf8'));
    const rows = Array.isArray(raw) ? raw : raw.data;
    snapshotById = new Map(rows.map((r) => [`B${Number(r.id)}`, r]));
  } catch (error) {
    console.warn(`  (could not read snapshot for cross-check: ${error.message})`);
  }

  const warnings = [];
  for (const ind of indicators) {
    const row = snapshotById.get(ind.code);
    if (snapshotById.size === 0) break;
    if (!row) {
      warnings.push(`${ind.code} (${ind.name}): not present in snapshot`);
    } else {
      if (!row.isIndicator) warnings.push(`${ind.code} (${ind.name}): snapshot does NOT flag isIndicator`);
      if (row.isNonPreferred) warnings.push(`${ind.code} (${ind.name}): snapshot mis-marks it isNonPreferred (overridden)`);
    }
  }

  // Sanity: the curated set must be unique and reference known groups.
  const seen = new Set();
  for (const ind of indicators) {
    if (seen.has(ind.code)) throw new Error(`Duplicate indicator code in source: ${ind.code}`);
    seen.add(ind.code);
    if (!indicatorGroups.includes(ind.group)) {
      throw new Error(`Indicator ${ind.code} has unknown group "${ind.group}"`);
    }
  }

  const reference = {
    $schema: 'blissbench/indicators@1',
    $source:
      'src/indicators/bliss-indicators.js: curated from the bliss-svg-builder ' +
      '"Indicators Reference". This is the AUTHORITATIVE source of indicator ' +
      'meaning for the kit (NOT the BCI-AV dictionary).',
    $regenerate: 'node bin/build-indicators.js',
    groups: indicatorGroups,
    count: indicators.length,
    entries: indicators
  };

  await writeFile(OUTPUT, `${JSON.stringify(reference, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${OUTPUT}`);
  console.log(`  ${indicators.length} indicators across ${indicatorGroups.length} groups`);
  if (warnings.length) {
    console.log(`  cross-check vs ${basename(SNAPSHOT)}, ${warnings.length} note(s) (curation wins):`);
    for (const w of warnings) console.log(`    • ${w}`);
  } else if (snapshotById.size) {
    console.log('  cross-check vs snapshot: no disagreements');
  }
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
