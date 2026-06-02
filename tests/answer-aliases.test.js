/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
/**
 * Answer-alias expansion: the "one or more spellings that should match" policy.
 *
 * Two layers, both pinned here:
 *   1. the TIGHTENED mechanical fallback (rule): strip every bracketed tag to the
 *      bare head, clean stray " - " separators, add the plural for "(s)", apply
 *      dialect. It NEVER fronts a tag or keeps an "X (Y)" literal, so a regex can't
 *      invent junk like "shape circle" or "yuk -".
 *   2. the per-entry CURATED layer (model-judged at authoring time, frozen): when a
 *      target has a curation entry it supplies the clean accepted set (incl. natural
 *      frontings); a safety-net union keeps every fully-clean gloss alternative.
 * Also guards that `filename` is never an answer source.
 * Run: node --test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadKit,
  getAnswers,
  getAnswerKey,
  scoreRow,
  normalizeRawEntry,
  expandAnswerKey,
  needsCuration
} from '../src/index.js';

const answersFor = (gloss, pos = 'noun') => getAnswers({ gloss, pos });

// ---------------------------------------------------------------------------
// 1. Tightened mechanical fallback (no curation entry)
// ---------------------------------------------------------------------------

test('numeric homograph (1)/(2): tag dropped, bare head only', () => {
  assert.deepEqual(answersFor('ovum (1)'), ['ovum']);
  assert.ok(!answersFor('ovum (1)').some((x) => /ovum 1/.test(x)), 'no "ovum 1" form');
});

test('inflection (s): accept BOTH singular and plural', () => {
  assert.deepEqual(answersFor('breast(s)'), ['breast', 'breasts']);
});

test('inflection (es): accept BOTH singular and plural', () => {
  assert.deepEqual(answersFor('box(es)'), ['box', 'boxes']);
});

test('rule drops a descriptive tag to the bare head, it does NOT front it', () => {
  // the old rule produced "induced abortion"; the tightened rule does not invent it.
  assert.deepEqual(answersFor('abortion (induced)'), ['abortion']);
  assert.ok(!answersFor('abortion (induced)').includes('abortion (induced)'), 'no literal kept');
});

test('rule drops an UNKNOWN tag to the head, never a nonsense reorder', () => {
  assert.deepEqual(answersFor('circle (shape)'), ['circle']);
  // case is preserved in the key; the scorer lowercases at compare time.
  assert.deepEqual(answersFor('English (language)', 'noun'), ['English']);
  assert.ok(!answersFor('circle (shape)').includes('shape circle'), 'no "shape circle"');
});

test('rule preserves a real word-internal hyphen while dropping the bracketed tag', () => {
  assert.deepEqual(answersFor("brother-in-law (husband's brother)", 'person'), ['brother-in-law']);
  assert.deepEqual(answersFor('cold-blooded (animal)'), ['cold-blooded']);
});

test('rule cleans a stray " - (tag)" separator, never a dangling "yuk -"', () => {
  assert.deepEqual(answersFor('yuk - (exclamatory)', 'expression'), ['yuk']);
  assert.deepEqual(answersFor('no - (exclamatory)', 'expression'), ['no']);
  assert.ok(!answersFor('yuk - (exclamatory)', 'expression').some((x) => /-/.test(x)), 'no hyphen survives');
});

test('rule cleans across comma alternatives, keeping the clean ones', () => {
  assert.deepEqual(getAnswers({ gloss: 'ugh, yuk - (exclamatory)', pos: 'expression' }), ['ugh', 'yuk']);
});

test('a comma INSIDE a parenthetical tag is not split into broken fragments', () => {
  // "doctor (rehab, hab)" must stay one base ("(rehab" / "hab)" would be junk); the rule
  // strips the whole tag to the head. Real comma-separated alternatives still split.
  assert.deepEqual(answersFor('doctor (rehab, hab)', 'noun'), ['doctor']);
  assert.deepEqual(answersFor('kebab (UK, NL)', 'noun'), ['kebab']);
  assert.deepEqual(getAnswers({ gloss: 'marsupial (animal), pouched mammal', pos: 'noun' }), ['marsupial', 'pouched mammal']);
});

test('directional tag is unrecoverable: strip to head ("into")', () => {
  assert.deepEqual(answersFor('into (leftwards)'), ['into']);
});

test('verb sense disambiguator resolves to the bare infinitive; no reorder', () => {
  assert.deepEqual(answersFor('to bury (person)', 'action'), ['to bury']);
});

test('dialect: the other-dialect spelling is accepted (rule path)', () => {
  assert.ok(answersFor('behaviour').includes('behavior'));
  assert.ok(answersFor('resource centre').includes('resource center'));
  assert.ok(answersFor('caesarean section').includes('cesarean section'));
});

// ---------------------------------------------------------------------------
// 2. needsCuration: the rule-vs-model split (one source of truth)
// ---------------------------------------------------------------------------

test('needsCuration: clean / numeric / inflection are rule-safe; everything else needs the model', () => {
  assert.equal(needsCuration(['cat']), false);
  assert.equal(needsCuration(['egg', 'ovum (1)']), false, 'numeric tag is rule-safe');
  assert.equal(needsCuration(['breast(s)']), false, 'inflection tag is rule-safe');
  assert.equal(needsCuration(['abortion (induced)']), true, 'a descriptive tag needs judgement');
  assert.equal(needsCuration(['yuk - (exclamatory)']), true, 'a stray separator needs judgement');
  assert.equal(needsCuration(['apparent(ly)']), true, 'a (ly) suffix needs judgement');
});

// ---------------------------------------------------------------------------
// 3. Curated layer: prefers the model's clean set, never drops a clean answer
// ---------------------------------------------------------------------------

test('expandAnswerKey: a curated answer set replaces the rule and is marked source:curated', () => {
  const { answers, source } = expandAnswerKey(['ugh', 'yuk - (exclamatory)'], ['ugh', 'yuk']);
  assert.deepEqual(answers, ['ugh', 'yuk']);
  assert.equal(source, 'curated');
  assert.ok(!answers.some((x) => /\(|-/.test(x)), 'no junk literal survives the curated set');
});

test('expandAnswerKey: the rule path is marked source:rule', () => {
  assert.equal(expandAnswerKey(['cat']).source, 'rule');
});

test('curated safety net: a fully-clean gloss alternative is never dropped', () => {
  // the model forgot "ugh"; the clean literal is unioned back in.
  const { answers } = expandAnswerKey(['ugh', 'yuk - (exclamatory)'], ['yuk']);
  assert.ok(answers.includes('ugh'), 'clean alternative preserved');
  assert.ok(answers.includes('yuk'));
});

test('curated layer supports natural fronting the rule refuses to invent', () => {
  const { answers } = expandAnswerKey(['abortion (induced)'], ['abortion', 'induced abortion']);
  assert.ok(answers.includes('abortion') && answers.includes('induced abortion'));
});

test('dialect still applies on top of a curated set', () => {
  const { answers } = expandAnswerKey(['centre (sport)'], ['centre']);
  assert.ok(answers.includes('center'), 'dialect variant added to the curated head');
});

// ---------------------------------------------------------------------------
// 4. getAnswerKey wiring: id selects a curation entry (injectable for tests)
// ---------------------------------------------------------------------------

test('getAnswerKey: a curation entry (by targetId) is preferred, with note + source', () => {
  const curation = { B999: { answers: ['yuk'], note: 'drop exclamatory tag; clean stray hyphen' } };
  const key = getAnswerKey({ id: 'B999', gloss: 'yuk - (exclamatory)', pos: 'expression' }, curation);
  assert.deepEqual(key.base, ['yuk - (exclamatory)']);
  assert.deepEqual(key.answers, ['yuk']);
  assert.equal(key.source, 'curated');
  assert.equal(key.note, 'drop exclamatory tag; clean stray hyphen');
  assert.ok(key.added.some((r) => r.form === 'yuk'));
});

test('getAnswerKey: no curation entry falls back to the tightened rule (source:rule)', () => {
  const key = getAnswerKey({ id: 'B1', gloss: 'abortion (induced)', pos: 'noun' }, {});
  assert.deepEqual(key.answers, ['abortion']);
  assert.equal(key.source, 'rule');
  assert.equal('note' in key, false, 'no note on a rule row');
});

// ---------------------------------------------------------------------------
// 5. filename is NEVER an answer source (guard), unchanged contract
// ---------------------------------------------------------------------------

test('filename is NEVER an answer source (guard)', () => {
  const e = normalizeRawEntry({ id: 1, code: 'B1/B2', gloss: 'cat', filename: 'cat_(old)-(to)', isWord: true });
  assert.equal('filename' in e, false, 'filename dropped at ingestion');
  assert.deepEqual(getAnswers({ gloss: 'value', filename: 'IGNORED_(to)' }), ['value']);
});

// ---------------------------------------------------------------------------
// 6. End-to-end: a plain correct guess scores top-1
// ---------------------------------------------------------------------------

test('end-to-end: a plain correct guess scores top-1', () => {
  // rule path: bare head accepted
  const key = { targetId: 'B1164', pos: 'noun', answers: answersFor('abortion (induced)') };
  assert.equal(scoreRow(['abortion', 'termination', 'miscarriage', 'x', 'y'], key).top1, true);

  // curated path: the natural fronted phrase is accepted too
  const ckey = {
    targetId: 'B1164',
    pos: 'noun',
    answers: expandAnswerKey(['abortion (induced)'], ['abortion', 'induced abortion']).answers
  };
  assert.equal(scoreRow(['induced abortion'], ckey).top1, true);

  // verb: gloss "to approve"; a bare "approve" guess matches via verb-infinitive
  const vkey = { targetId: 'Bx', pos: 'action', answers: answersFor('to approve', 'action') };
  assert.deepEqual(vkey.answers, ['to approve'], 'gloss is the only source');
  assert.equal(scoreRow(['approve'], vkey).top1, true);
});

// ---------------------------------------------------------------------------
// 7. Real-kit invariants: curation coverage + no junk in any accepted form
// ---------------------------------------------------------------------------

test('real kit: every suspect eligible target has a curated judgement (no silent gaps)', async () => {
  const kit = await loadKit();
  const ds = kit.dataset;
  const gaps = [];
  for (const t of ds.getEligibleTargets()) {
    const key = getAnswerKey(ds.getEntry(t.targetId));
    if (needsCuration(key.base) && key.source !== 'curated') gaps.push(t.targetId);
  }
  assert.equal(gaps.length, 0, `suspect targets lacking curation: ${gaps.slice(0, 12).join(', ')}${gaps.length > 12 ? ' …' : ''}`);
});

test('real kit: no accepted answer (rule or curated) contains a leftover tag or stray hyphen', async () => {
  const kit = await loadKit();
  const ds = kit.dataset;
  const junk = (a) => /[()]/.test(a) || /\s-(\s|$)/.test(a) || /(^|\s)-\s/.test(a) || /-\s*$/.test(a) || /_/.test(a) || a.trim() === '';
  const bad = [];
  for (const t of ds.getEligibleTargets()) {
    for (const a of getAnswers(ds.getEntry(t.targetId))) if (junk(a)) bad.push(`${t.targetId}:${JSON.stringify(a)}`);
  }
  assert.equal(bad.length, 0, `junk answers: ${bad.slice(0, 12).join(', ')}${bad.length > 12 ? ' …' : ''}`);
});
