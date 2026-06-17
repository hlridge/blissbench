import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPromptRows, buildFileContent } from '../test_models/gen-prompts.js';

const mockDataset = {
  buildContext: (targetId) => ({
    targetId,
    spelling: `SPELL_${targetId}`,
    charCount: 2,
    subwords: [],
    modifiers: [],
    indicators: [],
    siblings: [],
    neighbours: { sharedStart: [], sharedEnd: [] },
    legend: [],
  }),
};

const mockTargets = [
  { targetId: 'B0001' },
  { targetId: 'B0002' },
];

const mockTemplates = [
  { name: 'tmpl-a', build: (ctx) => `prompt-a:${ctx.spelling}` },
  { name: 'tmpl-b', build: (ctx) => `prompt-b:${ctx.spelling}` },
];

test('buildPromptRows returns one entry per template', () => {
  const result = buildPromptRows(mockTemplates, mockTargets, mockDataset);
  assert.equal(result.size, 2);
  assert.ok(result.has('tmpl-a'));
  assert.ok(result.has('tmpl-b'));
});

test('buildPromptRows returns one row per target per template', () => {
  const result = buildPromptRows(mockTemplates, mockTargets, mockDataset);
  assert.equal(result.get('tmpl-a').length, 2);
  assert.equal(result.get('tmpl-b').length, 2);
});

test('each row has targetId and prompt fields', () => {
  const result = buildPromptRows(mockTemplates, mockTargets, mockDataset);
  const rows = result.get('tmpl-a');
  assert.deepEqual(Object.keys(rows[0]).sort(), ['prompt', 'targetId']);
  assert.equal(rows[0].targetId, 'B0001');
  assert.equal(rows[0].prompt, 'prompt-a:SPELL_B0001');
});

test('prompt is produced by calling template.build with context', () => {
  const result = buildPromptRows(mockTemplates, mockTargets, mockDataset);
  assert.equal(result.get('tmpl-b')[1].prompt, 'prompt-b:SPELL_B0002');
});

test('buildFileContent: no systemPrompt produces plain JSONL', () => {
  const rows = [{ targetId: 'B1', prompt: 'hello' }];
  const result = buildFileContent(rows);
  assert.equal(result, '{"targetId":"B1","prompt":"hello"}\n');
});

test('buildFileContent: with systemPrompt adds _meta line first', () => {
  const rows = [{ targetId: 'B1', prompt: 'hello' }];
  const result = buildFileContent(rows, 'My system prompt');
  const lines = result.trim().split('\n');
  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[0]), { _meta: true, systemPrompt: 'My system prompt' });
  assert.deepEqual(JSON.parse(lines[1]), { targetId: 'B1', prompt: 'hello' });
});

test('buildFileContent: empty systemPrompt is falsy, no _meta line', () => {
  const rows = [{ targetId: 'B1', prompt: 'hello' }];
  const result = buildFileContent(rows, '');
  assert.equal(result, '{"targetId":"B1","prompt":"hello"}\n');
});
