#!/usr/bin/env node
/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
/**
 * baseline.example.js: a DETERMINISTIC, no-AI baseline submission.
 *
 * Not part of the contract, and not a serious pipeline: it just guesses the
 * answers of a target's helpers/siblings directly (siblings first, then the
 * longest subword helpers). Its only jobs are to (a) sanity-check the whole
 * loop end-to-end (kit → buildContext → submission → scorer → sets) with no
 * API key or network, and (b) give you a real, no-AI floor to compare a method against.
 *
 * Run (answers a whole set; defaults to --set all, the official run):
 *   node examples/baseline.example.js --set all --output results/baseline.jsonl
 *   node bin/score.js --submission results/baseline.jsonl --set all
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadKit } from '../src/index.js';

const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : fallback;
};

// Build up to 5 candidate guesses from helper/sibling evidence ONLY (leak-free):
// siblings (same glyphs, different indicator) are the strongest signal, then the
// longest contiguous subword helpers, then shorter ones. Uses each helper's
// already-split `answers`, deduped, first-5.
const candidatesFromContext = (ctx) => {
  const ordered = [
    ...ctx.siblings,
    ...[...ctx.subwords]
      .sort((a, b) => b.length - a.length)
      .flatMap((s) => s.helpers)
  ];
  const out = [];
  const seen = new Set();
  for (const helper of ordered) {
    for (const answer of helper.answers || []) {
      const key = answer.toLowerCase().trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(answer);
      if (out.length === 5) return out;
    }
  }
  return out.length ? out : ['unknown']; // keep the row schema-valid (>=1 candidate)
};

const main = async () => {
  const setName = String(arg('set', 'all'));
  const outputPath = resolve(String(arg('output', 'results/baseline.jsonl')));
  const kit = await loadKit();

  // --set <name> answers exactly that test set's targets; defaults to set all
  // (the official run). Pass e.g. --set 50 for a quick subset.
  const setPath = resolve(KIT_ROOT, `data/sets/set-${setName}.jsonl`);
  const ids = (await readFile(setPath, 'utf8')).trim().split(/\r?\n/).map((l) => JSON.parse(l).targetId);
  const byId = new Map(kit.dataset.getEligibleTargets().map((t) => [t.targetId, t]));
  const targets = ids.map((id) => byId.get(id)).filter(Boolean);
  const rows = targets.map((target) => ({
    targetId: target.targetId,
    candidates: candidatesFromContext(kit.dataset.buildContext(target.targetId)),
    runner: 'baseline-helper-gloss',
    promptVersion: 'baseline-v0'
  }));

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');
  console.log(`Wrote ${rows.length} baseline rows to ${outputPath}`);
  console.log(`Next: node bin/score.js --submission ${outputPath} --set ${setName}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
