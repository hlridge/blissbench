/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
/**
 * Smoke tests: pin the contract's key behaviors so they can't silently change.
 * Run: node --test   (or: npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import {
  loadKit,
  parseBCodeWord,
  scoreRow,
  summarizeScores,
  createReport,
  evaluateEligibility,
  normalizeRawEntry,
  isBCodeWordSpelling
} from '../src/index.js';
import { orderTargetsStratified } from '../src/lib/sampling.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('B-code parser splits characters and indicators', () => {
  const parsed = parseBCodeWord('B398;B86/B688');
  assert.equal(parsed.characters.length, 2);
  // B86 is a word-level indicator → moved after ;;
  assert.match(parsed.spelling, /;;B86$/);
});

test('modifiers.json carries a data-driven gloss + curated asPrefix readings', async () => {
  const modifiers = JSON.parse(await readFile(resolve(ROOT, 'data/modifiers.json'), 'utf8'));
  assert.equal(modifiers.count, modifiers.entries.length);
  assert.deepEqual(modifiers.tiers['absolute-never-head'], ['B233']);
  const get = (sp) => modifiers.entries.find((e) => e.spelling === sp);
  // B368: "group of" is a curated prefix reading; the dictionary gloss carries it too.
  const b368 = get('B368');
  assert.ok(b368.gloss.includes('group of'), 'gloss is the symbol\'s dictionary gloss');
  assert.ok(b368.asPrefix.includes('group of'), 'asPrefix is the curated prefix reading');
  // B486: prefix form curated as "opposite of"; the dictionary gloss carries the core concept.
  const opp = get('B486');
  assert.ok(opp.asPrefix.includes('opposite of'));
  assert.ok(opp.gloss.includes('opposite'));
  // shapes: asPrefix is always a non-empty string[]; gloss is a string (may be '').
  assert.ok(modifiers.entries.every((e) => Array.isArray(e.asPrefix) && e.asPrefix.length >= 1));
  assert.ok(modifiers.entries.every((e) => typeof e.gloss === 'string'));
});

test('indicators.json is the curated, authoritative indicator reference', async () => {
  const indicators = JSON.parse(await readFile(resolve(ROOT, 'data/indicators.json'), 'utf8'));
  assert.equal(indicators.count, indicators.entries.length);
  const action = indicators.entries.find((e) => e.code === 'B81');
  assert.equal(action.name, 'INDICATOR ACTION');
  assert.equal(action.group, 'Verbal');
  assert.ok(action.purpose.includes('action'));
});

test('eligibility: real word passes, character/indicator/full-modifier fail', async () => {
  await loadKit(); // ensure modifier reference is loaded for findFullModifierMatch
  const word = normalizeRawEntry({ id: 1166, code: 'B260/B449/B232/B349', gloss: 'abstinence', isWord: true });
  assert.equal(evaluateEligibility(word).eligible, true);

  const single = normalizeRawEntry({ id: 9001, code: 'B260', gloss: 'decision', isWord: true });
  assert.deepEqual(evaluateEligibility(single).eligible, false);

  const theWord = normalizeRawEntry({ id: 647, code: 'B647', gloss: 'the', isWord: true });
  assert.equal(evaluateEligibility(theWord).failed.includes('exclude-full-modifier'), true);
});

test('scoreRow: noun matching, punctuation-insensitive, rank-aware', () => {
  const key = { targetId: 'B1164', pos: 'noun', answers: ['abortion (induced)'] };
  const r = scoreRow(['abortion', 'termination', 'miscarriage', 'abortion (induced)', 'loss'], key);
  assert.equal(r.rank, 4);      // "abortion" alone ≠ "abortion induced"; match at #4
  assert.equal(r.top1, false);
  assert.equal(r.top5, true);
});

test('scoreRow: verbs compared in "to ..." form', () => {
  const key = { targetId: 'Bx', pos: 'action', answers: ['to drive'] };
  assert.equal(scoreRow(['drive'], key).top1, true);       // "drive" → "to drive"
  assert.equal(scoreRow(['to drive'], key).top1, true);
});

test('scoreRow carries pos; summarizeScores adds a per-pos breakdown', () => {
  assert.equal(scoreRow(['x'], { targetId: 'Bz', pos: 'noun', answers: ['y'] }).pos, 'noun');
  const s = summarizeScores([
    { pos: 'noun', top1: true, top5: true, reciprocalRank: 1 },
    { pos: 'noun', top1: false, top5: true, reciprocalRank: 0.5 },
    { pos: 'action', top1: false, top5: false, reciprocalRank: 0 }
  ]);
  assert.equal(s.total, 3);
  assert.equal(s.byPos.noun.total, 2);
  assert.equal(s.byPos.noun.top1, 0.5);
  assert.equal(s.byPos.action.top5, 0);
});

test('scorer dedups duplicate targetIds and marks the run non-official', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const dir = mkdtempSync(join(tmpdir(), 'blissbench-'));
  try {
    const sub = join(dir, 'sub.jsonl');
    const outp = join(dir, 'scored.jsonl');
    writeFileSync(sub, // two rows for the SAME eligible target
      [
        JSON.stringify({ targetId: 'B1166', candidates: ['abstinence'], runner: 'r', promptVersion: 'v' }),
        JSON.stringify({ targetId: 'B1166', candidates: ['wrong'], runner: 'r', promptVersion: 'v' })
      ].join('\n') + '\n');
    execFileSync(process.execPath, [join(root, 'bin/score.js'), '--submission', sub, '--output', outp], { stdio: 'ignore' });
    const summary = JSON.parse(readFileSync(outp.replace(/\.jsonl$/, '') + '.summary.json', 'utf8'));
    assert.equal(summary.coverage.scored, 1);    // NOT inflated to 2
    assert.equal(summary.coverage.duplicates, 1);
    assert.equal(summary.official, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scorer refuses to write inside the frozen data dir', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const dir = mkdtempSync(join(tmpdir(), 'blissbench-'));
  try {
    const sub = join(dir, 'sub.jsonl');
    writeFileSync(sub, JSON.stringify({ targetId: 'B1166', candidates: ['abstinence'] }) + '\n');
    assert.throws(() =>
      execFileSync(
        process.execPath,
        [join(root, 'bin/score.js'), '--submission', sub, '--output', join(root, 'data/answers.jsonl')],
        { stdio: 'ignore' }
      )
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadKit produces a stable eligible target count', async () => {
  const kit = await loadKit();
  const report = kit.dataset.eligibilityReport();
  assert.equal(report.total, 6420);
  assert.equal(report.eligible, 4186);
});

test('buildContext is leak-free (no target-private fields)', async () => {
  const kit = await loadKit();
  const target = kit.dataset.getEligibleTargets()[0];
  const ctx = kit.dataset.buildContext(target.targetId);
  // present: spelling-derived + helper info (incl. the new siblings field)
  assert.ok(ctx.spelling && Array.isArray(ctx.modifiers) && Array.isArray(ctx.subwords));
  assert.ok(Array.isArray(ctx.siblings), 'buildContext exposes siblings');
  // sealed: nothing from the target entry itself
  for (const leak of ['gloss', 'explanation', 'pos', 'answers', 'derivation', 'filename']) {
    assert.equal(leak in ctx, false, `buildContext must not expose ${leak}`);
  }
});

test('buildContext modifiers are curated and drop head-selection tier', async () => {
  const kit = await loadKit();
  // B1616 ("to appreciate") leads with B297 then has B401 (a low-priority modifier).
  const ctx = kit.dataset.buildContext('B1616');
  assert.ok(ctx.modifiers.length >= 1);
  for (const m of ctx.modifiers) {
    assert.equal('tier' in m, false, 'tier must not be surfaced to prompts');
    assert.equal('asConcept' in m, false, 'asConcept removed');
    assert.ok('gloss' in m && 'asPrefix' in m && 'category' in m);
    assert.ok(Array.isArray(m.asPrefix), 'asPrefix is a list of prefix readings');
  }
});

test('indicatorsOf resolves to curated meaning (not the dictionary gloss)', async () => {
  const kit = await loadKit();
  // B4946 = "to murder" → carries the action (verb) indicator B81.
  const ctx = kit.dataset.buildContext('B4946');
  const action = ctx.indicators.find((i) => i.spelling === 'B81');
  assert.ok(action, 'B81 indicator present');
  assert.equal(action.name, 'INDICATOR ACTION');
  assert.equal(action.group, 'Verbal');
  assert.equal('gloss' in action, false); // dictionary gloss no longer surfaced
});

test('subword/helper matching is indicator-agnostic (base sequence)', async () => {
  const kit = await loadKit();
  const ds = kit.dataset;
  // "murder" (noun, B206/B259/B532) and "to murder" (B206/B259/B532;;B81) share a base.
  const matches = ds.findByBaseSpelling('B206/B259/B532').map((e) => e.id);
  assert.ok(matches.includes('B4945'), 'noun form matched by base');
  assert.ok(matches.includes('B4946'), 'verb form (indicator) matched by base');
});

test('siblingsOf surfaces full-base inflectional siblings (self excluded)', async () => {
  const kit = await loadKit();
  const ds = kit.dataset;
  const siblings = ds.siblingsOf('B4946').map((h) => h.id); // "to murder"
  assert.ok(siblings.includes('B4945'), '"murder" is a sibling of "to murder"');
  assert.equal(siblings.includes('B4946'), false, 'target itself is excluded');
  // and it shows up in the assembled context
  const ctx = ds.buildContext('B4946');
  assert.ok(ctx.siblings.some((h) => h.id === 'B4945'));
});

test('non-preferred entries are never offered as helpers', async () => {
  const kit = await loadKit();
  const np = kit.dataset.entries.find(
    (e) => e.isNonPreferred && isBCodeWordSpelling(e.spelling)
  );
  if (!np) return; // none in this snapshot → nothing to assert
  const helpers = kit.dataset.findBySpelling(np.spelling);
  assert.equal(helpers.some((h) => h.id === np.id), false);
});

test('createReport scores, dedups duplicates, and gates official', () => {
  const answers = [
    { targetId: 'B1', pos: 'noun', answers: ['cat'] },
    { targetId: 'B2', pos: 'action', answers: ['to run'] }
  ];
  const submission = [
    { targetId: 'B1', candidates: ['cat', 'dog'], runner: 'r' },
    { targetId: 'B1', candidates: ['wrong'], runner: 'r' }, // duplicate → last wins (a miss)
    { targetId: 'B2', candidates: ['run'], runner: 'r' } // "run" → "to run"
  ];
  const { summary, scored } = createReport(submission, answers, { set: 'all' });
  assert.equal(summary.coverage.scored, 2); // deduped, not 3
  assert.equal(summary.coverage.duplicates, 1);
  assert.equal(summary.official, false); // duplicates present
  assert.equal(summary.top1, 0.5); // B1 miss (last row), B2 hit
  assert.equal(scored.find((s) => s.targetId === 'B2').top1, true);
});

test('orderTargetsStratified accepts composite (multi-key) strata', () => {
  const items = [
    { targetId: 'B1', pos: 'noun', charBucket: '2' },
    { targetId: 'B2', pos: 'noun', charBucket: '3' },
    { targetId: 'B3', pos: 'action', charBucket: '2' },
    { targetId: 'B4', pos: 'action', charBucket: '3' }
  ];
  const ordered = orderTargetsStratified(items, { seed: 't', stratifyBy: ['pos', 'charBucket'] });
  assert.equal(ordered.length, 4);
  assert.deepEqual([...new Set(ordered.map((i) => i.targetId))].sort(), ['B1', 'B2', 'B3', 'B4']);
});

test('test sets are compositionally balanced (pos AND length) vs the full set', async () => {
  const read = async (p) =>
    (await readFile(resolve(ROOT, p), 'utf8')).split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  const targets = await read('data/targets.jsonl');
  const answers = await read('data/answers.jsonl');
  const posById = new Map(answers.map((a) => [a.targetId, a.pos || '']));
  const charById = new Map(targets.map((t) => [t.targetId, t.charCount]));
  const bucket = (n) => (n >= 5 ? '5+' : String(n));
  const fullIds = targets.map((t) => t.targetId);
  const distOf = (ids, keyFn) => ids.reduce((m, id) => m.set(keyFn(id), (m.get(keyFn(id)) || 0) + 1), new Map());
  const fullPos = distOf(fullIds, (id) => posById.get(id));
  const fullLen = distOf(fullIds, (id) => bucket(charById.get(id)));
  const maxDev = (ids, full, keyFn) => {
    const sub = distOf(ids, keyFn);
    let d = 0;
    for (const k of full.keys()) d = Math.max(d, Math.abs(full.get(k) / fullIds.length - (sub.get(k) || 0) / ids.length));
    return d;
  };
  for (const [n, tol] of [[100, 0.07], [300, 0.05], [1000, 0.03]]) {
    const ids = (await read(`data/sets/set-${n}.jsonl`)).map((r) => r.targetId);
    assert.ok(maxDev(ids, fullPos, (id) => posById.get(id)) < tol, `set-${n} pos balance within ${tol}`);
    assert.ok(maxDev(ids, fullLen, (id) => bucket(charById.get(id))) < tol, `set-${n} length balance within ${tol}`);
  }
});

test('test sets are nested (50 ⊂ 100), requires build-manifest first', async () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const read = async (n) =>
    (await readFile(resolve(root, `data/sets/set-${n}.jsonl`), 'utf8'))
      .split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l).targetId);
  const s50 = await read(50);
  const s100 = await read(100);
  assert.equal(s50.length, 50);
  assert.equal(s100.length, 100);
  const set100 = new Set(s100);
  assert.ok(s50.every((id) => set100.has(id)), 'set-50 must be a subset of set-100');
});
