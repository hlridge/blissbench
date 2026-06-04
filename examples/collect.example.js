#!/usr/bin/env node
/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
/**
 * collect.example.js: a TEMPLATE for a full run — build a prompt, call a model, write a
 * submission, AND record what produced it.
 *
 * Not part of the contract. Each run writes its OWN version (different models, prompts,
 * language rules, context layouts). The only fixed points are the eligible target set
 * (data/targets.jsonl) and the scorer (bin/score.js).
 *
 * Two files come out:
 *   - the SUBMISSION (results/<name>.jsonl) — what the scorer grades;
 *   - a RUN RECORD (runs/<name>.<timestamp>.run.json + .interactions.jsonl) — a durable copy of
 *     THIS method's source + the run details + the prompt/answer per word, so you never have to
 *     copy-paste your recipe by hand. The timestamp in the name means re-running never
 *     overwrites an earlier record. (A record, not a replay button: a remote model can still
 *     change — see src/lib/run-record.js.)
 *
 * Run:
 *   node examples/collect.example.js --set 50 --output results/my-run.jsonl
 *   node bin/score.js --submission results/my-run.jsonl --set 50
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadKit, recordRun } from '../src/index.js';

const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUNNER = 'collect.example';
const PROMPT_VERSION = 'template-v0';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : fallback;
};

// --- This is the part YOU design: hints -> a prompt, then a prompt -> guesses -----------
// `kit.dataset.buildContext(targetId)` returns the leak-free context (spelling + curated
// modifier/indicator meanings + subword helpers + siblings + neighbours + legend). Reshape
// it however you like; just never add the target's own gloss / explanation / pos.

const buildPrompt = (c) => {
  const out = [];
  out.push('Interpret this Blissymbolics word. Reply with your 5 best English guesses, best first, as a JSON array.');
  out.push(`Word: ${c.spelling}  (${c.charCount} symbols)`);
  if (c.subwords.length) {
    out.push('\nParts of it that are themselves words:');
    for (const s of c.subwords) out.push(`  ${s.spelling} = ${s.helpers.map((h) => h.gloss).join('; ')}`);
  }
  return out.join('\n');
};

const callYourModel = async (_prompt, _context) => {
  // TODO: send `_prompt` to your AI and parse 5 guesses. Placeholder so the template runs:
  return ['(your guess 1)', '(your guess 2)', '(your guess 3)', '(your guess 4)', '(your guess 5)'];
};
// ----------------------------------------------------------------------------------------

const main = async () => {
  const setName = String(arg('set', '50'));
  const outputPath = resolve(String(arg('output', 'results/demo.jsonl')));
  const kit = await loadKit();

  const setPath = resolve(KIT_ROOT, `data/sets/set-${setName}.jsonl`);
  const ids = (await readFile(setPath, 'utf8')).trim().split(/\r?\n/).map((l) => JSON.parse(l).targetId);
  const byId = new Map(kit.dataset.getEligibleTargets().map((t) => [t.targetId, t]));
  const targets = ids.map((id) => byId.get(id)).filter(Boolean);

  const submissionRows = []; // the contract shape the scorer reads
  const recordRows = []; // the same + the prompt, for the durable run record
  for (const target of targets) {
    const context = kit.dataset.buildContext(target.targetId);
    const prompt = buildPrompt(context);
    const candidates = await callYourModel(prompt, context);
    submissionRows.push({ targetId: target.targetId, candidates, runner: RUNNER, promptVersion: PROMPT_VERSION });
    recordRows.push({ targetId: target.targetId, prompt, candidates });
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${submissionRows.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');
  console.log(`Wrote ${submissionRows.length} submission rows to ${outputPath}`);

  // Record WHAT produced this submission, automatically: this file (the method) is copied
  // in, alongside the run details and the per-word prompts/answers. Lives in runs/ (kept),
  // not results/ (throwaway). Edit the prompt later and your old record still holds.
  let manifest = null;
  try {
    manifest = JSON.parse(await readFile(resolve(KIT_ROOT, 'data/manifest.json'), 'utf8'));
  } catch {
    // manifest optional; the record's snapshot fields stay null
  }
  const runName = basename(outputPath).replace(/\.jsonl$/i, '');
  const { recordPath, interactionsPath } = await recordRun({
    runner: RUNNER,
    promptVersion: PROMPT_VERSION,
    set: setName,
    rows: recordRows,
    manifest,
    methodPaths: [fileURLToPath(import.meta.url)], // THIS file is the method; copy it in
    dir: resolve('runs'),
    name: runName
  });
  console.log(`Recorded the run in ${recordPath}${interactionsPath ? ` (+ ${interactionsPath})` : ''}`);
  console.log(`Next: node bin/score.js --submission ${outputPath} --set ${setName}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
