/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
/**
 * Arbitrary-spelling context: interpret a RAW B-code spelling that need not be an
 * existing target. Same building blocks as buildContext (modifiers / indicators /
 * subwords / siblings / neighbours) computed from the spelling alone, PLUS
 * `exactMatch`: the known dictionary word(s) for that exact spelling, if any, so a
 * caller knows "this is already a known word -> here's the answer" vs "no exact
 * match -> this is a genuine interpretation". Unlike buildContext(targetId), this
 * path has no "self" to seal (there is no hidden answer for an unknown word).
 *
 * Run: node --test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataset, loadKit } from '../src/index.js';

const word = (id, code, gloss) => ({ id, code, gloss, isWord: true });
const fixtureDataset = () =>
  createDataset({
    entries: [
      word(1, 'B100/B200/B300', 'known word'),
      word(2, 'B100/B200/B777', 'prefix neighbour'),
      word(3, 'B100', 'glyph one'),
      word(4, 'B300', 'glyph three')
    ],
    modifiers: { entries: [], conditionalExceptions: [] },
    indicators: { entries: [] }
  });

test('buildContextFromSpelling: arbitrary (unknown) spelling -> blocks, no exactMatch, no targetId', () => {
  const ds = fixtureDataset();
  const ctx = ds.buildContextFromSpelling('B100/B200/B999'); // not a known word
  assert.equal('targetId' in ctx, false, 'raw-spelling context has no targetId');
  assert.equal(ctx.spelling, 'B100/B200/B999');
  assert.equal(ctx.charCount, 3);
  assert.ok(Array.isArray(ctx.modifiers) && Array.isArray(ctx.indicators));
  assert.deepEqual(ctx.exactMatch, [], 'no known word for this exact spelling');
  // B3 (B100) is a subword helper; B1 and B2 share the B100/B200 prefix -> neighbours.
  assert.ok(ctx.subwords.some((s) => s.baseSpelling === 'B100' && s.helpers.some((h) => h.id === 'B3')));
  const startIds = ctx.neighbours.sharedStart.map((n) => n.id);
  assert.ok(startIds.includes('B1') && startIds.includes('B2'), 'shared-start neighbours found from spelling alone');
});

test('buildContextFromSpelling: known spelling surfaces exactMatch and is NOT self-sealed', () => {
  const ds = fixtureDataset();
  const ctx = ds.buildContextFromSpelling('B100/B200/B300'); // this IS B1
  assert.equal(ctx.exactMatch.length, 1);
  assert.equal(ctx.exactMatch[0].id, 'B1');
  assert.ok(ctx.exactMatch[0].answers.includes('known word'), 'exactMatch carries the meaning');
  // no "self" to seal: B1 appears as its own sibling (same base, no exclusion)
  assert.ok(ctx.siblings.some((h) => h.id === 'B1'));
  // but B1 is NOT a neighbour of itself (same full base -> excluded), B2 still is
  const startIds = ctx.neighbours.sharedStart.map((n) => n.id);
  assert.equal(startIds.includes('B1'), false);
  assert.ok(startIds.includes('B2'));
});

test('buildContextFromSpelling: invalid input throws a clear error', () => {
  const ds = fixtureDataset();
  assert.throws(() => ds.buildContextFromSpelling('not-a-bcode'), /B-code word spelling/);
  assert.throws(() => ds.buildContextFromSpelling('VL6:0,8;DOT:0,16'), /B-code word spelling/);
});

test('real kit: exactMatch flags a known word; arbitrary path keeps benchmark buildContext sealed', async () => {
  const kit = await loadKit();
  const ds = kit.dataset;
  // "murder" = B206/B259/B532 is a known word -> exactMatch is non-empty and carries it.
  const ctx = ds.buildContextFromSpelling('B206/B259/B532');
  assert.ok(ctx.exactMatch.length >= 1);
  assert.ok(ctx.exactMatch.every((m) => m.spelling === 'B206/B259/B532'), 'exactMatch is an EXACT spelling match');
  assert.ok(ctx.exactMatch.some((m) => m.answers.includes('murder')));
  assert.ok(Array.isArray(ctx.neighbours.sharedStart) && Array.isArray(ctx.subwords));
  // the sealed benchmark path is untouched: buildContext(targetId) still hides the answer.
  const sealed = ds.buildContext('B4945');
  assert.equal('exactMatch' in sealed, false, 'benchmark buildContext does not surface exactMatch');
  assert.equal('gloss' in sealed, false);
});
