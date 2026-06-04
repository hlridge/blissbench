#!/usr/bin/env node
/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
/**
 * show-context.js: print the leak-free `buildContext` for one target, for
 * eyeballing while you design your prompt. Read-only; prints exactly what the
 * kit would hand your pipeline (no target-private data).
 *
 * Run:
 *   node bin/show-context.js B4946          # by id or code
 *   node bin/show-context.js --target B1828
 *   node bin/show-context.js B4946 --json   # raw JSON
 */
import { loadKit } from '../src/index.js';

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
};
const asJson = argv.includes('--json');
const target = flag('target') || argv.find((a) => !a.startsWith('--'));

const main = async () => {
  if (!target) throw new Error('Usage: node bin/show-context.js <targetId|code> [--json]');
  const kit = await loadKit();
  let ctx = kit.dataset.buildContext(target);
  let raw = false;
  if (!ctx) {
    // Not a known target id/code: treat the input as an ARBITRARY raw spelling (the
    // unknown-word path). `exactMatch` then tells you whether it is actually known.
    try {
      ctx = kit.dataset.buildContextFromSpelling(target);
      raw = true;
    } catch {
      throw new Error(`"${target}" is not a known target id/code, nor a B-code word spelling.`);
    }
  }

  if (asJson) {
    console.log(JSON.stringify(ctx, null, 2));
    return;
  }

  if (raw) {
    console.log(`Raw spelling ${ctx.spelling}   (${ctx.charCount} chars), not a sealed target`);
    if (ctx.exactMatch.length) {
      console.log('  ⓘ exact match, this spelling IS a known word (no interpretation needed):');
      for (const m of ctx.exactMatch) console.log(`     ${m.id} (${m.pos || '-'}) "${m.gloss}"`);
    } else {
      console.log('  ⓘ no exact dictionary match: interpret from the parts below');
    }
  } else {
    console.log(`Target ${ctx.targetId}   spelling ${ctx.spelling}   (${ctx.charCount} chars)`);
  }

  console.log(`\nPossible pre-head operators (${ctx.modifiers.length}, detected by sequence; one may instead carry the meaning here):`);
  for (const m of ctx.modifiers) {
    const prefix = (m.asPrefix || []).join(' / ');
    const core = m.gloss ? `  (dictionary: ${m.gloss})` : '';
    console.log(`  ${m.spelling.padEnd(16)} as prefix: ${prefix}${core}  [${m.category}]`);
  }

  console.log(`\nIndicators (${ctx.indicators.length}):`);
  for (const i of ctx.indicators) {
    console.log(`  ${i.spelling.padEnd(8)} ${i.name} (${i.group}): ${i.purpose}  [${i.scope}]`);
  }

  console.log(`\nSubwords with helpers (${ctx.subwords.length}):`);
  for (const s of ctx.subwords) {
    console.log(`  ${s.spelling}`);
    for (const h of s.helpers) {
      console.log(`     ↳ ${h.id} (${h.pos || '-'}) "${h.gloss}"`);
    }
  }

  console.log(`\nSiblings: same glyphs, different indicators (${ctx.siblings.length}):`);
  for (const h of ctx.siblings) {
    console.log(`  ${h.id} (${h.pos || '-'}) "${h.gloss}"`);
  }

  const nb = ctx.neighbours;
  const moreOf = (group) => (nb.omitted[group] ? ` (+${nb.omitted[group]} more via neighboursOf)` : '');
  const showNeighbour = (h) =>
    console.log(`     ↳ ${h.spelling.padEnd(20)} [share ${h.sharedLen}: ${h.sharedSpelling}]  (${h.pos || '-'}) "${h.gloss}"`);
  console.log('\nNeighbours: shared-affix words (deepest-shared first):');
  console.log(`  shared start: same leading glyph(s) (${nb.sharedStart.length})${moreOf('sharedStart')}:`);
  nb.sharedStart.forEach(showNeighbour);
  console.log(`  shared end: shared tail (${nb.sharedEnd.length})${moreOf('sharedEnd')}:`);
  nb.sharedEnd.forEach(showNeighbour);

  const legend = ctx.legend || [];
  console.log(`\nLegend: words inside the neighbours' non-shared parts (${legend.length}):`);
  for (const p of legend) {
    console.log(`  ${p.spelling.padEnd(16)} ${(p.id || '').padEnd(8)} (${p.pos || '-'}) "${p.gloss}"`);
  }
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
