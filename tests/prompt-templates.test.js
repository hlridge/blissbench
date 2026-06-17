import test from 'node:test';
import assert from 'node:assert/strict';
import templates from '../test_models/prompt-templates.js';

const tmpl = templates.find(t => t.name === 'json_structured');

const mockContext = {
  targetId: 'B1234',
  spelling: 'B17717/B12374/B13366/B24895;B8993',
  charCount: 5,
  indicators: [
    { spelling: 'B8993', scope: 'word', name: 'action', group: 'verb', purpose: 'indicator (action)' }
  ],
  modifiers: [],
  subwords: [
    {
      spelling: 'B17717',
      span: [0, 1],
      helpers: [{ id: 'B17717', gloss: 'thing,object', pos: 'noun', answers: [], explanation: '(crystal outline)' }]
    },
    {
      spelling: 'B12374',
      span: [1, 2],
      helpers: [{ id: 'B12374', gloss: 'and,also,plus,too', pos: 'conjunction', answers: [], explanation: '(addition half-sized)' }]
    },
    {
      spelling: 'B13366',
      span: [2, 3],
      helpers: [{ id: 'B13366', gloss: 'clothing,clothes,garment', pos: 'noun', answers: [], explanation: '(cloth + protection)' }]
    },
    // B24895 intentionally absent — tests "skip if not found in subwords"
    {
      spelling: 'B17717/B12374/B13366',
      span: [0, 3],
      helpers: [{ id: 'B99999', gloss: 'accessory', pos: 'noun', answers: [], explanation: '(thing + plus + clothing)' }]
    },
  ],
  siblings: [],
  neighbours: { sharedStart: [], sharedEnd: [] },
  legend: [],
};

function parseOutput(ctx) {
  const output = tmpl.build(ctx);
  const splitOn = '\n\nReturn JSON array of candidate interpretations.';
  const idx = output.indexOf(splitOn);
  const jsonPart = output.slice(0, idx);
  return JSON.parse(jsonPart);
}

test('json_structured template exists with systemPrompt and build', () => {
  assert.ok(tmpl, 'json_structured template not found');
  assert.equal(typeof tmpl.build, 'function');
  assert.equal(typeof tmpl.systemPrompt, 'string');
  assert.ok(tmpl.systemPrompt.length > 0);
});

test('inputIds: all symbol codes from spelling including indicator code', () => {
  const parsed = parseOutput(mockContext);
  assert.deepEqual(parsed.inputIds, [17717, 12374, 13366, 24895, 8993]);
});

test('indicatorEffects: maps indicators to {id, gloss}', () => {
  const parsed = parseOutput(mockContext);
  assert.deepEqual(parsed.indicatorEffects, [{ id: '8993', gloss: 'indicator (action)' }]);
});

test('annotations: base chars with subword data, skips symbols with no subword entry', () => {
  const parsed = parseOutput(mockContext);
  // B24895 has no subword entry → skipped
  assert.deepEqual(parsed.annotations, [
    { id: '17717', gloss: 'thing,object', explanation: '(crystal outline)' },
    { id: '12374', gloss: 'and,also,plus,too', explanation: '(addition half-sized)' },
    { id: '13366', gloss: 'clothing,clothes,garment', explanation: '(cloth + protection)' },
  ]);
});

test('subwordMatches: multi-char subwords with subWord array and gloss/explanation', () => {
  const parsed = parseOutput(mockContext);
  assert.deepEqual(parsed.subwordMatches, [
    { subWord: [17717, 12374, 13366], matchedGloss: 'accessory', matchedExplanation: '(thing + plus + clothing)' }
  ]);
});

test('modifierEffects: absent when modifiers.length is 0', () => {
  const parsed = parseOutput(mockContext);
  assert.equal(parsed.modifierEffects, undefined);
});

test('modifierEffects: absent when modifiers.length is 1', () => {
  const ctx = {
    ...mockContext,
    modifiers: [
      { spelling: 'B449', codes: ['B449'], gloss: 'minus,no,without', asPrefix: ['non-'], category: 'negation', span: [0, 1] }
    ]
  };
  const parsed = parseOutput(ctx);
  assert.equal(parsed.modifierEffects, undefined);
});

test('modifierEffects: present when modifiers.length > 1', () => {
  const ctx = {
    ...mockContext,
    modifiers: [
      { spelling: 'B449', codes: ['B449'], gloss: 'minus,no,without', asPrefix: ['non-'], category: 'negation', span: [0, 1] },
      { spelling: 'B532', codes: ['B532'], gloss: 'opposite_of', asPrefix: ['anti-'], category: 'opposition', span: [1, 2] },
    ]
  };
  const parsed = parseOutput(ctx);
  assert.deepEqual(parsed.modifierEffects, [
    { id: '449', gloss: 'minus,no,without' },
    { id: '532', gloss: 'opposite_of' },
  ]);
});

test('output ends with trailing instruction', () => {
  const output = tmpl.build(mockContext);
  assert.ok(output.endsWith('Return JSON array of candidate interpretations.'));
});
