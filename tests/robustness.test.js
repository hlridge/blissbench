/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
/**
 * Robustness tests: scoring normalization, tolerant candidate parsing, and the
 * scorer's handling of malformed or hostile submission rows. These pin fixes
 * from the pre-release review so the behaviours cannot silently regress.
 * Run: node --test   (or: npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreRow, createReport } from '../src/index.js';
import { parseCandidateArray } from '../src/lib/result-parsing.js';
import { setModifierReference } from '../src/modifiers/match.js';

const rank = (candidate, answers, pos = 'noun') => scoreRow([candidate], { targetId: 'T', pos, answers }).rank;

// A 300k-deep nested array: stringifying it would overflow the stack, so the
// parser and the scorer must tolerate it without recursing into it.
const deeplyNested = () => {
  let deep = [];
  for (let i = 0; i < 300000; i += 1) deep = [deep];
  return deep;
};

test('scoring: an apostrophe joins a word, so it is dropped, not split into two tokens', () => {
  assert.equal(rank('lets', ["let's"]), 1);
  assert.equal(rank('oclock', ["o'clock"]), 1);
  assert.equal(rank('new years day', ["New Year's Day"]), 1);
  assert.equal(rank('lets', ['let’s']), 1); // a curly apostrophe is handled too
});

test('scoring: trailing punctuation and underscores still fold to a space (unchanged)', () => {
  assert.equal(rank('drive', ['drive.']), 1);
  assert.equal(rank('ice cream', ['ice_cream']), 1);
});

test('parseCandidateArray: recovers an embedded array despite stray brackets in prose', () => {
  assert.deepEqual(
    parseCandidateArray('Guesses: ["water","river","lake"]\nNote: [confidence: high]'),
    ['water', 'river', 'lake']
  );
  assert.deepEqual(parseCandidateArray('Answer: ["a","b"] (considered [other options])'), ['a', 'b']);
  assert.deepEqual(parseCandidateArray('x ["a","b"] y ["c","d"]'), ['c', 'd']); // a model puts its final answer last
});

test('parseCandidateArray: recovers a { "candidates": [...] } object', () => {
  assert.deepEqual(parseCandidateArray('{"candidates":["x","y"]}'), ['x', 'y']);
});

test('parseCandidateArray: drops non-string elements and never throws', () => {
  assert.deepEqual(parseCandidateArray(['a', null, undefined, 'b', { x: 1 }]), ['a', 'b']);
  assert.deepEqual(parseCandidateArray('[{"x":1}]'), []);
  assert.deepEqual(parseCandidateArray('[["a","b"]]'), ['a', 'b']); // one level of string array is flattened
  assert.deepEqual(parseCandidateArray([deeplyNested()]), []); // no stack overflow
});

test('createReport: a JSON-encoded candidates string is recovered, not scored as empty', () => {
  const answers = [{ targetId: 'B1', pos: 'noun', answers: ['cat'] }];
  const { summary } = createReport([{ targetId: 'B1', candidates: '["cat","x"]' }], answers, { set: 's', universe: ['B1'] });
  assert.equal(summary.top1, 1);
  assert.equal(summary.coverage.emptyCandidates, 0);
});

test('createReport: a row with no targetId is malformed (not a duplicate) and does not abort the batch', () => {
  const answers = [
    { targetId: 'B1', pos: 'noun', answers: ['cat'] },
    { targetId: 'B2', pos: 'noun', answers: ['dog'] }
  ];
  const { summary } = createReport(
    [
      { candidates: ['z'] }, // no targetId
      { candidates: ['w'] }, // no targetId
      { targetId: 'B1', candidates: [deeplyNested()] }, // hostile row
      { targetId: 'B2', candidates: ['dog'] }
    ],
    answers,
    { set: 'all', universe: ['B1', 'B2'] }
  );
  assert.equal(summary.coverage.malformed, 2);
  assert.equal(summary.coverage.duplicates, 0);
  assert.equal(summary.official, false); // malformed rows disqualify an official run
  assert.equal(summary.coverage.scored, 2); // both real rows scored despite the malformed + hostile rows
  assert.equal(summary.top1, 0.5);
});

test('setModifierReference: an empty-codes entry fails loudly instead of hanging', () => {
  assert.throws(
    () => setModifierReference({ entries: [{ codes: [], spelling: '' }], conditionalExceptions: [] }),
    /empty\/missing codes/
  );
});
