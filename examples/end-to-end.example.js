#!/usr/bin/env node
/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
/**
 * end-to-end.example.js: the WHOLE loop in one small, runnable file.
 *
 * Frozen target → leak-free context → a simple prompt → a model → 5 guesses →
 * the shared scorer → a printed report. It runs offline (no API key): the
 * "model" here is a trivial deterministic stub: REPLACE `callModel` with a real
 * API call and you have a working pipeline.
 *
 * Run:  node examples/end-to-end.example.js            (defaults to set 50)
 *       node examples/end-to-end.example.js --set 100
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadKit, createReport, formatReport } from '../src/index.js';

const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
};

// 1) PROMPT: turn the leak-free context into a simple text prompt. This is the
//    part you design; the data structure (`context`) is what the kit hands you.
const buildPrompt = (context) => {
  const lines = [];
  lines.push('Interpret this Blissymbolics word into English. Give your 5 best guesses,');
  lines.push('best first, as a JSON array of strings (e.g. ["a","b","c","d","e"]).');
  lines.push('');
  lines.push(`Spelling: ${context.spelling}  (${context.charCount} characters)`);
  if (context.modifiers.length) {
    lines.push('Operators present (as prefix: dictionary meaning):');
    for (const m of context.modifiers) {
      lines.push(`  - ${(m.asPrefix || []).join(' / ')}${m.gloss ? `: ${m.gloss}` : ''}`);
    }
  }
  if (context.indicators.length) {
    lines.push('Grammar indicators:');
    for (const i of context.indicators) lines.push(`  - ${i.name}: ${i.purpose}`);
  }
  if (context.subwords.length) {
    lines.push('Sub-parts that are themselves words (helpers):');
    for (const s of context.subwords) {
      const glosses = s.helpers.map((h) => h.gloss).join(' | ');
      lines.push(`  - ${s.spelling}: ${glosses}`);
    }
  }
  if (context.siblings.length) {
    lines.push('Same glyphs, different grammar (siblings):');
    for (const h of context.siblings) lines.push(`  - (${h.pos || '-'}) ${h.gloss}`);
  }
  return lines.join('\n');
};

// 2) MODEL: STUB. Replace this with a real call to your AI (send `prompt`, get
//    text back). To keep the demo offline and non-zero, this stub just echoes the
//    helper/sibling glosses it was shown, as a JSON array, exactly the kind of
//    raw text a real model would return.
const callModel = async (prompt, context) => {
  const guesses = [];
  const seen = new Set();
  const pools = [context.siblings, ...context.subwords.sort((a, b) => b.length - a.length).map((s) => s.helpers)];
  for (const pool of pools) {
    for (const helper of pool) {
      for (const answer of helper.answers || []) {
        const key = answer.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        guesses.push(answer);
        if (guesses.length === 5) break;
      }
      if (guesses.length === 5) break;
    }
    if (guesses.length === 5) break;
  }
  return JSON.stringify(guesses.length ? guesses : ['unknown']); // raw model text
};

const main = async () => {
  const setName = String(arg('set', '50'));
  const kit = await loadKit();
  const setPath = resolve(KIT_ROOT, `data/sets/set-${setName}.jsonl`);
  const ids = (await readFile(setPath, 'utf8')).trim().split(/\r?\n/).map((l) => JSON.parse(l).targetId);
  const byId = new Map(kit.dataset.getEligibleTargets().map((t) => [t.targetId, t]));
  const targets = ids.map((id) => byId.get(id)).filter(Boolean);

  const submission = [];
  for (const target of targets) {
    const context = kit.dataset.buildContext(target.targetId); // leak-free
    const prompt = buildPrompt(context);
    const rawResponseText = await callModel(prompt, context); // ← your real model here
    submission.push({ targetId: target.targetId, rawResponseText, runner: 'end-to-end-demo', promptVersion: 'demo-v1' });
    if (target === targets[0]) {
      console.log('────────── example prompt (first target) ──────────');
      console.log(prompt);
      console.log(`\nmodel returned: ${rawResponseText}`);
      console.log('────────────────────────────────────────────────────\n');
    }
  }

  // 3) SCORE: createReport does dedup + scoring + coverage + provenance. Build
  //    the answer key for just these targets from the kit (scorer-side data).
  const answers = targets.map((t) => kit.dataset.answerKeyOf(t.targetId));
  const universe = targets.map((t) => t.targetId);
  const { summary } = createReport(submission, answers, { set: setName, universe });

  console.log(formatReport(summary));
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
