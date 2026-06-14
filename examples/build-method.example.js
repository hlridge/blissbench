#!/usr/bin/env node
/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
/**
 * build-method.example.js: a small, honest look at THE METHOD (the free middle).
 *
 * Not part of the contract, and not a "good" prompt: it shows the seam you own —
 * how you CONSUME the leak-free `buildContext` hints and CONCATENATE them into a
 * string you could send to a model. The task line is two lines; the rest is just
 * picking hints and laying them out (this one still skips siblings / explanation /
 * answers, and trims long lists — your call what to keep).
 *
 * The indicators and modifiers it prints are the TARGET WORD'S OWN: buildContext
 * derives them from the target spelling alone (helper/neighbour words never add
 * theirs), so everything shown is directly about the word under test.
 *
 * It prints the materialized prompt — exactly what the variables expand to — so you
 * can see the real text, then swap `console.log` for your own API call.
 *
 * Run:
 *   node examples/build-method.example.js                       # defaults to B1181
 *   node examples/build-method.example.js --target B1167
 *   node examples/build-method.example.js --target B398/B688/B999   # an unseen spelling
 */
import { loadKit } from '../src/index.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
};

const SHOW = 4; // how many of each list to print before a truthful "more" note

// All contiguous spans of an array of glyph codes, as joined strings.
const spansOf = (glyphs) => {
  const spans = [];
  for (let i = 0; i < glyphs.length; i += 1)
    for (let j = i + 1; j <= glyphs.length; j += 1) spans.push(glyphs.slice(i, j).join('/'));
  return spans;
};

// --- THE METHOD: turn the hints into a prompt string -------------------------
// `c` is whatever buildContext() / buildContextFromSpelling() returned. Read from
// it; never add the target's own gloss / pos / explanation (buildContext seals those).
const buildPrompt = (c) => {
  const out = [];
  out.push('Interpret this Blissymbolics word. Reply with your 5 best English guesses, best first, as a JSON array.');
  out.push(`Word: ${c.spelling}  (${c.charCount} characters)`);

  // The word's OWN grammar markers (part of speech, tense, number). For "afraid"
  // this is the description indicator that turns the noun "fear" into an adjective.
  // Rendering ctx.indicators / ctx.modifiers like this is the clean DEFAULT — they
  // arrive already scoped to the word; the craft is in HOW you use them, not getting them.
  if (c.indicators.length) {
    out.push('\nGrammar markers on this word:');
    for (const i of c.indicators) out.push(`  ${i.spelling} = ${i.purpose || i.name}`);
  }

  // The word's OWN pre-head operators (negation, "opposite of", quantifiers, …),
  // flagged by sequence — one MIGHT be carrying the meaning instead, so it's a hint.
  if (c.modifiers.length) {
    out.push('\nPre-head operators in this word (one may instead carry the meaning):');
    for (const m of c.modifiers) out.push(`  ${m.spelling} = ${(m.asPrefix || []).join(' / ')}`);
  }

  if (c.subwords.length) {
    out.push('\nParts of it that are themselves words:');
    for (const s of c.subwords) {
      const senses = s.helpers.slice(0, 2).map((h) => h.gloss).join('; ');
      out.push(`  ${s.spelling} = ${senses}${s.helpers.length > 2 ? ` (+${s.helpers.length - 2} more senses)` : ''}`);
    }
  }

  // Show BOTH neighbour groups (an earlier version showed only the shared-start ones,
  // which left the glossary below looking unrelated). Track the non-shared symbols of
  // the neighbours we actually print, so the glossary can be limited to exactly those.
  // Different entries can share one base spelling (a noun and its verb, say); merge
  // them onto a single line so the same code is never printed twice.
  const dedupe = (items) => {
    const bySpelling = new Map();
    for (const n of items) {
      const cur = bySpelling.get(n.spelling);
      if (cur) cur.glosses.push(n.gloss);
      else bySpelling.set(n.spelling, { spelling: n.spelling, sharedLen: n.sharedLen, glosses: [n.gloss] });
    }
    return [...bySpelling.values()];
  };
  const shownParts = new Set();
  const printGroup = (label, items, side, omitted) => {
    if (!items.length) return;
    const list = dedupe(items);
    out.push(`\n${label}`);
    for (const n of list.slice(0, SHOW)) {
      out.push(`  ${n.spelling} = ${n.glosses.join('; ')}`);
      const g = n.spelling.split('/');
      const offset = side === 'start' ? g.slice(n.sharedLen) : g.slice(0, g.length - n.sharedLen);
      for (const part of spansOf(offset)) shownParts.add(part);
    }
    if (list.length > SHOW || omitted) out.push('  …(more via neighboursOf)');
  };
  printGroup('Related words sharing its leading symbols:', c.neighbours.sharedStart, 'start', c.neighbours.omitted.sharedStart);
  printGroup('Related words sharing its trailing symbols:', c.neighbours.sharedEnd, 'end', c.neighbours.omitted.sharedEnd);

  // Decode just the symbols that appear in the related words we printed above
  // (c.legend covers ALL neighbours, so filter it to the ones we showed).
  const glossary = dedupe(c.legend.filter((p) => shownParts.has(p.spelling)));
  if (glossary.length) {
    out.push('\nWhat the other symbols in those related words mean:');
    for (const p of glossary.slice(0, 8)) out.push(`  ${p.spelling} = ${p.glosses.join('; ')}`);
    if (glossary.length > 8) out.push(`  …(+${glossary.length - 8} more)`);
  }
  return out.join('\n'); // ← this string is what you would send to your model
};
// -----------------------------------------------------------------------------

const main = async () => {
  const target = arg('target', 'B1181');
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
