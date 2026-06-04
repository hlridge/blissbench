#!/usr/bin/env node
/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
/**
 * build-method.example.js: the smallest honest look at THE METHOD (the free middle).
 *
 * Not part of the contract, and not a "good" prompt: it just shows the seam you own
 * — how you CONSUME the leak-free `buildContext` hints and CONCATENATE them into a
 * string you could send to a model. The task line is two lines; everything else is
 * just picking some hints and laying them out. You don't have to use them all (this
 * one skips modifiers / indicators / siblings / explanation / answers on purpose).
 *
 * It prints the materialized prompt — exactly what the variables expand to — so you
 * can see the real text, then swap `console.log` for your own API call.
 *
 * Run:
 *   node examples/build-method.example.js                       # defaults to B1175
 *   node examples/build-method.example.js --target B1167
 *   node examples/build-method.example.js --target B398/B688/B999   # an unseen spelling
 */
import { loadKit } from '../src/index.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
};

// --- THE METHOD: turn the hints into a prompt string -------------------------
// `c` is whatever buildContext() / buildContextFromSpelling() returned. Read from
// it; never add the target's own gloss/pos/explanation (buildContext seals those).
const buildPrompt = (c) => {
  const out = [];
  out.push('Interpret this Blissymbolics word. Reply with your 5 best English guesses, best first, as a JSON array.');
  out.push(`Word: ${c.spelling}  (${c.charCount} symbols)`);

  if (c.subwords.length) {
    out.push('\nParts of it that are themselves words:');
    for (const s of c.subwords) out.push(`  ${s.spelling} = ${s.helpers.map((h) => h.gloss).join('; ')}`);
  }

  const related = c.neighbours.sharedStart.concat(c.neighbours.sharedEnd).slice(0, 6);
  if (related.length) {
    out.push('\nRelated words that share symbols with it:');
    for (const n of related) out.push(`  ${n.spelling} = ${n.gloss}`);
  }

  if (c.legend.length) {
    out.push('\nWhat the other symbols in those related words mean:');
    for (const p of c.legend.slice(0, 10)) out.push(`  ${p.spelling} = ${p.gloss}`);
  }
  return out.join('\n'); // ← this string is what you would send to your model
};
// -----------------------------------------------------------------------------

const main = async () => {
  const target = arg('target', 'B1175');
  const kit = await loadKit();
  // A known target id/code → sealed buildContext; anything else (e.g. an unseen
  // spelling) → buildContextFromSpelling, the same hints with no "self" to seal.
  const context = kit.dataset.buildContext(target) || kit.dataset.buildContextFromSpelling(target);

  console.log(`# context for ${target} → buildPrompt() → the literal text below:\n`);
  console.log(buildPrompt(context));
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
