/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
/**
 * Neighbours: the third match group (shared-affix words), alongside subwords
 * (contiguous fragments) and siblings (same full base, different indicators).
 *
 * A SHARED-START neighbour shares a leading run with the target then diverges or
 * extends (non-shared tail bounded); a SHARED-END neighbour shares a trailing run
 * with a different, short head. Each is tagged with how many glyphs it shares and
 * ordered longest-shared-first. Neighbours are DISJOINT from subwords and siblings.
 *
 * These synthetic-dataset tests pin the exact algorithm; the real-kit tests pin the
 * invariants on the bundled snapshot. Run: node --test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataset, loadKit, parseBCodeWord } from '../src/index.js';

const baseGlyphs = (spelling) => parseBCodeWord(spelling).characters.map((c) => c.baseSpelling);

// A tiny, fully-controlled dataset. Target B1 = B100/B200/B300.
const word = (id, code, gloss) => ({ id, code, gloss, isWord: true });
const fixtureDataset = () =>
  createDataset({
    entries: [
      word(1, 'B100/B200/B300', 'target'), // the target
      word(2, 'B100/B999', 'start near, share 1'), // sharedStart len 1
      word(3, 'B100/B200/B777', 'start near, share 2'), // sharedStart len 2
      word(4, 'B100/B200/B300/B400', 'start super, share 3'), // sharedStart len 3 (extends target)
      word(5, 'B888/B300', 'end near, share 1'), // sharedEnd len 1
      word(6, 'B777/B200/B300', 'end near, share 2'), // sharedEnd len 2
      word(7, 'B100', 'leading glyph'), // a contiguous subword (prefix) -> excluded
      word(8, 'B300', 'trailing glyph'), // a contiguous subword (suffix) -> excluded
      word(9, 'B100/B200/B300', 'sibling'), // same full base -> sibling, excluded
      word(10, 'B500/B600', 'unrelated'), // shares nothing -> excluded
      word(11, 'B100/B201/B202/B203/B204', 'start too long'), // tail 4 > 3 -> excluded
      word(12, 'B201/B202/B203/B300', 'end too long'), // head 3 > 2 -> excluded
      word(13, 'B100/B888;;B81', 'start, has an indicator') // base B100/B888 -> sharedStart len 1
    ],
    modifiers: { entries: [], conditionalExceptions: [] },
    indicators: { entries: [] }
  });

test('sharedStartOf: longest-shared-affix first, tail bounded, indicator-agnostic', () => {
  const ds = fixtureDataset();
  const out = ds.sharedStartOf('B1');
  // B4 (share 3) > B3 (share 2) > [B2, B13] (share 1, id asc). B7/B9 (subword/sibling),
  // B11 (tail too long), and all non-B100-leading entries are excluded.
  assert.deepEqual(out.map((n) => n.id), ['B4', 'B3', 'B2', 'B13']);
  assert.deepEqual(out.map((n) => n.sharedLen), [3, 2, 1, 1]);
  const b4 = out.find((n) => n.id === 'B4');
  assert.equal(b4.sharedSpelling, 'B100/B200/B300');
  assert.equal(b4.spelling, 'B100/B200/B300/B400'); // neighbour's own base spelling
  const b13 = out.find((n) => n.id === 'B13');
  assert.equal(b13.spelling, 'B100/B888'); // indicators stripped (base sequence)
  assert.equal(b13.sharedSpelling, 'B100');
});

test('sharedEndOf: longest-shared-suffix first, head bounded', () => {
  const ds = fixtureDataset();
  const out = ds.sharedEndOf('B1');
  assert.deepEqual(out.map((n) => n.id), ['B6', 'B5']); // share 2 before share 1
  assert.deepEqual(out.map((n) => n.sharedLen), [2, 1]);
  assert.equal(out.find((n) => n.id === 'B6').sharedSpelling, 'B200/B300');
  assert.equal(out.find((n) => n.id === 'B5').sharedSpelling, 'B300');
});

test('neighboursOf bundles both groups and stays disjoint from subwords/siblings/self', () => {
  const ds = fixtureDataset();
  const n = ds.neighboursOf('B1');
  assert.deepEqual(n.sharedStart.map((x) => x.id), ['B4', 'B3', 'B2', 'B13']);
  assert.deepEqual(n.sharedEnd.map((x) => x.id), ['B6', 'B5']);

  const neighbourIds = new Set([...n.sharedStart, ...n.sharedEnd].map((x) => x.id));
  const subwordHelperIds = new Set(ds.subwordsOf('B1').flatMap((s) => s.helpers.map((h) => h.id)));
  const siblingIds = new Set(ds.siblingsOf('B1').map((h) => h.id));
  assert.ok([...subwordHelperIds].includes('B7') && [...subwordHelperIds].includes('B8'));
  assert.ok(siblingIds.has('B9'));
  for (const id of neighbourIds) {
    assert.equal(subwordHelperIds.has(id), false, `${id} must not be both a neighbour and a subword helper`);
    assert.equal(siblingIds.has(id), false, `${id} must not be both a neighbour and a sibling`);
    assert.notEqual(id, 'B1', 'target itself is never its own neighbour');
  }
});

test('real kit: buildContext surfaces neighbours, leak-free and shaped', async () => {
  const kit = await loadKit();
  const target = kit.dataset.getEligibleTargets()[0];
  const ctx = kit.dataset.buildContext(target.targetId);
  assert.ok(ctx.neighbours && Array.isArray(ctx.neighbours.sharedStart) && Array.isArray(ctx.neighbours.sharedEnd));
  for (const leak of ['gloss', 'explanation', 'pos', 'derivation', 'filename']) {
    assert.equal(leak in ctx, false, `buildContext must not expose target's ${leak}`);
  }
});

test('buildContext caps neighbours at 8 per group, deepest-first, with omitted counts', async () => {
  const kit = await loadKit();
  const ds = kit.dataset;
  const flooder = ds.getEligibleTargets().find((t) => ds.neighboursOf(t.targetId).sharedStart.length > 8);
  assert.ok(flooder, 'snapshot has a target with >8 shared-start neighbours');
  const full = ds.neighboursOf(flooder.targetId);
  const ctx = ds.buildContext(flooder.targetId);
  // capped to 8, keeping the top (deepest-shared-first) prefix of the full list
  assert.equal(ctx.neighbours.sharedStart.length, 8);
  assert.ok(ctx.neighbours.sharedEnd.length <= 8);
  assert.deepEqual(
    ctx.neighbours.sharedStart.map((n) => n.id),
    full.sharedStart.slice(0, 8).map((n) => n.id)
  );
  // truncation is surfaced, never silent
  assert.equal(ctx.neighbours.omitted.sharedStart, full.sharedStart.length - 8);
  assert.equal(ctx.neighbours.omitted.sharedEnd, Math.max(0, full.sharedEnd.length - 8));
});

// --- legend: decode the neighbours' NON-SHARED parts -------------------------
// Target B1 = B100/B200/B300. B2 is a shared-START neighbour (shares B100), so its
// non-shared tail is B401/B402; B3 is a shared-END neighbour (shares B300), so its
// non-shared head is B777. B4/B5/B6/B7 make those off-parts decodable as words,
// including the MULTI-glyph sequence B401/B402. B8 (B100) is a target subword, so it
// must NOT appear in the legend (the target's own spans are excluded).
const legendDataset = () =>
  createDataset({
    entries: [
      word(1, 'B100/B200/B300', 'TARGET'),
      word(2, 'B100/B401/B402', 'shared-start, tail B401/B402'),
      word(3, 'B777/B300', 'shared-end, head B777'),
      word(4, 'B401', 'alpha'),
      word(5, 'B402', 'beta'),
      word(6, 'B401/B402', 'widget'), // a MULTI-glyph off-part word
      word(7, 'B777', 'omega'),
      word(8, 'B100', 'leading glyph (a target subword, never a legend entry)')
    ],
    modifiers: { entries: [], conditionalExceptions: [] },
    indicators: { entries: [] }
  });

test('legend decodes neighbours\' non-shared parts: single AND multi-glyph, target spans excluded', () => {
  const ds = legendDataset();
  const ctx = ds.buildContext('B1');
  // B401/B402 (len 2) first, then the singles by spelling: B401, B402, B777.
  assert.deepEqual(ctx.legend.map((p) => p.spelling), ['B401/B402', 'B401', 'B402', 'B777']);

  const multi = ctx.legend.find((p) => p.spelling === 'B401/B402');
  assert.equal(multi.length, 2);
  assert.equal(multi.gloss, 'widget'); // a multi-glyph sequence resolved to its own word
  assert.equal(ctx.legend.find((p) => p.spelling === 'B777').gloss, 'omega'); // shared-END head decoded too

  const spellings = new Set(ctx.legend.map((p) => p.spelling));
  assert.equal(spellings.has('B100'), false, 'a target subword span is never a legend entry');
  for (const p of ctx.legend) assert.notEqual(p.id, 'B1', 'the target itself is never decoded into its own legend');
});

test('real kit: buildContext.legend is present, shaped, leak-free, and surfaces multi-glyph parts', async () => {
  const kit = await loadKit();
  const ds = kit.dataset;
  const targets = ds.getEligibleTargets();

  const ctx0 = ds.buildContext(targets[0].targetId);
  assert.ok(Array.isArray(ctx0.legend), 'legend is an array on every context');
  for (const p of ctx0.legend) {
    assert.equal(typeof p.spelling, 'string');
    assert.equal(typeof p.gloss, 'string');
    assert.notEqual(p.id, ctx0.targetId, 'legend never resolves to the target itself');
  }

  // Multi-glyph decoding works on real data (we measured ~2071 such targets).
  const withMulti = targets.slice(0, 400).find((t) => ds.buildContext(t.targetId).legend.some((p) => p.length >= 2));
  assert.ok(withMulti, 'some target has a multi-glyph legend entry');
});

test('real kit: every neighbour shares the right affix and is disjoint from self/siblings', async () => {
  const kit = await loadKit();
  const ds = kit.dataset;
  let checked = 0;
  for (const t of ds.getEligibleTargets().slice(0, 60)) {
    const { sharedStart, sharedEnd } = ds.neighboursOf(t.targetId);
    if (!sharedStart.length && !sharedEnd.length) continue;
    checked += 1;
    const tBase = baseGlyphs(t.spelling);
    const firstGlyph = tBase[0];
    const lastGlyph = tBase[tBase.length - 1];
    const siblingIds = new Set(ds.siblingsOf(t.targetId).map((h) => h.id));
    for (const n of sharedStart) {
      assert.equal(n.id === t.targetId, false, 'no self');
      assert.equal(siblingIds.has(n.id), false, 'neighbour is not a sibling');
      assert.equal(n.spelling.split('/')[0], firstGlyph, 'shared-start begins with the target head glyph');
      assert.ok(n.sharedLen >= 1, 'shares at least one glyph');
    }
    for (const n of sharedEnd) {
      assert.equal(n.spelling.split('/').pop(), lastGlyph, 'shared-end ends with the target tail glyph');
      assert.ok(n.sharedLen >= 1);
    }
  }
  assert.ok(checked > 0, 'at least one eligible target has neighbours');
});
