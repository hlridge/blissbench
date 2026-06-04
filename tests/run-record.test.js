/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
/**
 * Run record: the durable "what produced this score" artifact. `buildRunRecord` is pure
 * (no fs, no clock), so these tests pin its shape and the method-file fingerprinting
 * without touching disk. Run: node --test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildRunRecord, runRecordBaseName } from '../src/index.js';

const inputs = {
  runner: 'my-run',
  promptVersion: 'v3',
  set: '50',
  count: 2,
  ranAt: '2026-06-04T00:00:00.000Z',
  manifest: { sha256: 'abc123', kitVersion: '0.1.0', sourceFile: 'snapshot.json' },
  model: 'claude-opus-4-8',
  methods: [{ path: 'build-method.example.js', source: 'export const buildPrompt = (c) => c.spelling;\n' }]
};

test('buildRunRecord captures the run details, the snapshot, and the model', () => {
  const rec = buildRunRecord(inputs);
  assert.equal(rec.kind, 'blissbench-run-record/1');
  assert.equal(rec.ranAt, '2026-06-04T00:00:00.000Z'); // injected clock, deterministic
  assert.equal(rec.runner, 'my-run');
  assert.equal(rec.promptVersion, 'v3');
  assert.deepEqual(rec.set, { name: '50', count: 2 });
  assert.deepEqual(rec.snapshot, { sha256: 'abc123', kitVersion: '0.1.0', sourceFile: 'snapshot.json' });
  assert.equal(rec.model, 'claude-opus-4-8');
});

test('buildRunRecord copies the method source and fingerprints it', () => {
  const rec = buildRunRecord(inputs);
  assert.equal(rec.method.length, 1);
  const m = rec.method[0];
  assert.equal(m.path, 'build-method.example.js');
  assert.equal(m.source, inputs.methods[0].source);            // the recipe is embedded, self-contained
  assert.equal(m.bytes, Buffer.byteLength(inputs.methods[0].source, 'utf8'));
  assert.equal(m.sha256, createHash('sha256').update(inputs.methods[0].source, 'utf8').digest('hex'));
});

test('buildRunRecord is a pure function of its inputs (no hidden clock / state)', () => {
  assert.deepEqual(buildRunRecord(inputs), buildRunRecord(inputs));
});

test('buildRunRecord degrades cleanly when optional pieces are missing', () => {
  const rec = buildRunRecord({ runner: 'bare', ranAt: 'T', methods: [] });
  assert.equal(rec.snapshot, null);
  assert.equal(rec.model, null);
  assert.deepEqual(rec.method, []);
  assert.deepEqual(rec.set, { name: null, count: null });
});

test('runRecordBaseName timestamps the file name (no overwrite) and is Windows-safe', () => {
  const iso = '2026-06-04T03:40:41.846Z';
  const base = runRecordBaseName('my-run', iso);
  assert.equal(base, 'my-run.2026-06-04T034041846Z');
  assert.equal(base.includes(':'), false, 'no colons — illegal in Windows file names');

  // Two different run times => two different files (the guard against clobbering).
  assert.notEqual(runRecordBaseName('my-run', '2026-06-04T03:40:41.846Z'),
                  runRecordBaseName('my-run', '2026-06-04T03:40:42.000Z'));
  // Opt out for a stable, overwrite-in-place name.
  assert.equal(runRecordBaseName('my-run', iso, false), 'my-run');
});
