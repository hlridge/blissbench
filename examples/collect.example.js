#!/usr/bin/env node
/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
/**
 * collect.example.js: a TEMPLATE for the FREE part of the benchmark.
 *
 * This file is NOT part of the contract. It shows one way to use the Kit API to
 * turn each eligible target into a prompt, call a model, and emit a submission.
 * Each run writes its OWN version: different models, prompts, language rules, and
 * context layouts. The only fixed points are the eligible
 * target set (data/targets.jsonl) and the scorer (bin/score.js).
 *
 * Run (writes a submission with placeholder candidates). Use --set to answer EXACTLY the
 * targets of a named test set, so `score --set <name>` lines up. Defaults to set 50:
 *   node examples/collect.example.js --set 50 --output results/my-run.jsonl
 * Then:
 *   node bin/score.js --submission results/my-run.jsonl --set 50
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

// --- This is the part YOU design ---------------------------------------------
// `kit.dataset.buildContext(targetId)` returns the leak-free context (spelling +
// curated modifier meanings + curated indicator meanings + subword helpers + siblings).
// The target entry's own gloss / explanation / pos are sealed off, never feed them.
// Reshape this however you like into YOUR prompt; just don't add target-private data.

const callYourModel = async (_context) => {
  // TODO: send a prompt built from `_context` to your AI and parse 5 guesses.
  // Placeholder so the template runs end-to-end:
  return ['(your guess 1)', '(your guess 2)', '(your guess 3)', '(your guess 4)', '(your guess 5)'];
};
// -----------------------------------------------------------------------------

const main = async () => {
  const setName = String(arg('set', '50'));
  const outputPath = resolve(String(arg('output', 'results/demo.jsonl')));
  const kit = await loadKit();

  // --set <name> answers exactly that test set's targets, so it lines up with
  // `score --set <name>`. Defaults to set 50; pass --set all for the full run.
  const setPath = resolve(KIT_ROOT, `data/sets/set-${setName}.jsonl`);
  const ids = (await readFile(setPath, 'utf8')).trim().split(/\r?\n/).map((l) => JSON.parse(l).targetId);
  const byId = new Map(kit.dataset.getEligibleTargets().map((t) => [t.targetId, t]));
  const targets = ids.map((id) => byId.get(id)).filter(Boolean);

  const rows = [];
  for (const target of targets) {
    const context = kit.dataset.buildContext(target.targetId);
    const candidates = await callYourModel(context);
    rows.push({
      targetId: target.targetId,
      candidates,
      runner: 'collect.example',
      promptVersion: 'template-v0'
    });
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');
  console.log(`Wrote ${rows.length} submission rows to ${outputPath}`);
  console.log(`Next: node bin/score.js --submission ${outputPath}${setName ? ` --set ${setName}` : ''}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
