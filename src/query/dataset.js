/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
/**
 * Dataset & querying layer.
 *
 * Environment-agnostic: give it the raw entry array and the modifier reference,
 * get back an indexed dataset with efficient lookups. File loading lives in
 * src/index.js (loadKit) so this module stays pure and testable.
 *
 * This is the surface used to ASSEMBLE context however the caller likes, the kit
 * does not dictate prompt shape, only provides the building blocks.
 */
import {
  parseBCodeWord,
  normalizeSpelling
} from '../lib/bcode.js';
import { normalizeRawEntry, getAnswers, getAnswerKey, getExplanation } from '../lib/entry.js';
import { evaluateEligibility } from '../rules/eligibility-rules.js';
import {
  setModifierReference,
  findModifierMatches,
  findLeadingModifierRun,
  findFullModifierMatch
} from '../modifiers/match.js';

const canonicalSpellingsOf = (entry) => {
  const spellings = [entry.id];
  try {
    spellings.push(normalizeSpelling(entry.spelling));
  } catch {
    // shape/primitive codes are not word spellings; addressable only by B{id}
  }
  return [...new Set(spellings)];
};

// Base-character sequence of a spelling: each character's `baseSpelling` joined,
// with ALL indicators stripped: both the true-character sense markers
// (;B97 concrete / ;B6436 abstract) and word-level grammatical indicators
// (;;B81 action, ;;B86 description, ...). This is the key for indicator-AGNOSTIC
// subword/helper matching: "to murder" and "murder" share base B206/B259/B532.
// Returns null for shape/primitive codes that are not B-code word spellings.
const baseArrayOf = (spelling) => {
  try {
    return parseBCodeWord(spelling).characters.map((c) => c.baseSpelling);
  } catch {
    return null;
  }
};

const baseSequenceOf = (spelling) => {
  const arr = baseArrayOf(spelling);
  return arr ? arr.join('/') : null;
};

// --- Neighbour helpers (the third match group: shared-affix words) -----------
// Longest-shared-affix model: a shared-START neighbour shares a leading run with
// the target then diverges/extends by at most MAX_START_TAIL glyphs; a shared-END
// neighbour shares a trailing run with a head of at most MAX_END_HEAD glyphs. The
// bounds keep neighbours "near" the target; see docs/DECISIONS.md "Neighbours".
const MAX_START_TAIL = 3;
const MAX_END_HEAD = 2;
// buildContext keeps only the top neighbours of each group (the full, uncapped
// set is always available via neighboursOf). Neighbours are sorted deepest-shared
// first, so this keeps essentially all high-signal matches and trims the long
// single-glyph tail; an `omitted` count makes the truncation explicit, not silent.
const NEIGHBOUR_CONTEXT_LIMIT = 8;

const commonPrefixLen = (a, b) => {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i += 1;
  return i;
};

const commonSuffixLen = (a, b) => {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[a.length - 1 - i] === b[b.length - 1 - i]) i += 1;
  return i;
};

// Every contiguous span (incl. the full word) of a base array, as joined strings.
// A neighbour whose base is in this set is a subword (any span) or the target's
// sibling (the full span), excluded so the three match groups stay disjoint.
const spanBaseSet = (baseArr) => {
  const set = new Set();
  for (let start = 0; start < baseArr.length; start += 1) {
    for (let end = start + 1; end <= baseArr.length; end += 1) {
      set.add(baseArr.slice(start, end).join('/'));
    }
  }
  return set;
};

// Ordered contiguous spans (singles and longer, up to the whole array) of a base
// array, as joined strings. Used to decode a neighbour's non-shared part into the
// dictionary words it contains, exactly like subwords decode the target.
const contiguousSpansOf = (baseArr) => {
  const spans = [];
  for (let start = 0; start < baseArr.length; start += 1) {
    for (let end = start + 1; end <= baseArr.length; end += 1) {
      spans.push(baseArr.slice(start, end).join('/'));
    }
  }
  return spans;
};

export const createDataset = ({ entries, modifiers, indicators }) => {
  setModifierReference(modifiers);
  // Curated indicator meaning (authoritative; NOT the dictionary gloss).
  const indicatorByCode = new Map(((indicators && indicators.entries) || []).map((e) => [e.code, e]));

  const normalized = entries.map(normalizeRawEntry);
  const byId = new Map();
  const bySpelling = new Map();
  const byBaseSpelling = new Map();
  // Neighbour indexes (preferred-only): first/last BASE glyph -> [{ entry, baseArr }].
  const byLeadingBaseChar = new Map();
  const byTrailingBaseChar = new Map();

  const pushTo = (map, key, entry) => {
    if (!key) return;
    const bucket = map.get(key) || [];
    bucket.push(entry);
    map.set(key, bucket);
  };

  for (const entry of normalized) {
    byId.set(entry.id, entry);
    // Non-preferred entries are deprecated/alternative spellings. Never offer them
    // as helper subwords or indicator meanings (rule: exclude-non-preferred applies
    // to HELP subjects too, not just targets).
    if (entry.isNonPreferred) continue;
    for (const spelling of canonicalSpellingsOf(entry)) {
      pushTo(bySpelling, spelling, entry);
    }
    // Indicator-AGNOSTIC index. Addressable by id (so a single-code span matches a
    // glyph entry as today) AND by base sequence (so grammatical/sense variants of
    // the same glyphs match regardless of indicators). A Set dedups the case where
    // id and base coincide (a single-character word).
    for (const key of new Set([entry.id, baseSequenceOf(entry.spelling)])) {
      pushTo(byBaseSpelling, key, entry);
    }
    // Neighbour indexes: bucket by the first and last BASE glyph so shared-affix
    // lookups only scan words that share the target's leading/trailing glyph.
    const baseArr = baseArrayOf(entry.spelling);
    if (baseArr && baseArr.length > 0) {
      pushTo(byLeadingBaseChar, baseArr[0], { entry, baseArr });
      pushTo(byTrailingBaseChar, baseArr[baseArr.length - 1], { entry, baseArr });
    }
  }

  const resolveId = (idOrCode) => {
    if (idOrCode && typeof idOrCode === 'object') return idOrCode.id;
    const value = `${idOrCode}`.trim();
    if (/^\d+$/.test(value)) return `B${Number(value)}`;
    if (/^B\d+$/i.test(value)) return `B${Number(value.slice(1))}`;
    return value;
  };

  const getEntry = (idOrCode) => byId.get(resolveId(idOrCode)) || null;

  const findBySpelling = (spelling) => {
    try {
      return bySpelling.get(normalizeSpelling(spelling)) || [];
    } catch {
      return [];
    }
  };

  // Indicator-AGNOSTIC lookup: preferred entries whose BASE character sequence
  // matches `spelling` ignoring all indicators (sense + grammatical). So
  // findByBaseSpelling('B206/B259/B532') returns both the noun and the verb form.
  const findByBaseSpelling = (spelling) => byBaseSpelling.get(baseSequenceOf(spelling)) || [];

  const helperView = (entry) => ({
    id: entry.id,
    gloss: entry.gloss,
    pos: entry.pos,
    answers: getAnswers(entry),
    explanation: getExplanation(entry)
  });

  // Distinct preferred entries sharing a base sequence, excluding the target,
  // as helper views. Shared by subwordsOf (per span) and siblingsOf (full word).
  const helpersForBase = (base, selfId) => {
    const seen = new Set();
    const helpers = [];
    for (const candidate of byBaseSpelling.get(base) || []) {
      if (candidate.id === selfId || seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      helpers.push(helperView(candidate));
    }
    return helpers;
  };

  /**
   * Contiguous PROPER subwords of a target that exist as their own dictionary
   * entries. Matching is indicator-AGNOSTIC (on the base character sequence), so
   * a fragment matches grammatical/sense variants of those glyphs regardless of
   * indicators. The full word is excluded here (see siblingsOf); self is excluded.
   */
  const subwordSpansFor = (spelling, selfId) => {
    let chars;
    try {
      chars = parseBCodeWord(spelling).characters;
    } catch {
      return [];
    }
    const spans = [];
    for (let start = 0; start < chars.length; start += 1) {
      for (let end = start + 1; end <= chars.length; end += 1) {
        if (start === 0 && end === chars.length) continue; // proper subwords only
        const base = chars.slice(start, end).map((c) => c.baseSpelling).join('/');
        spans.push({ span: [start, end], spelling: base, length: end - start, helpers: helpersForBase(base, selfId) });
      }
    }
    return spans;
  };

  const subwordsOf = (idOrCode) => {
    const entry = getEntry(idOrCode);
    return entry ? subwordSpansFor(entry.spelling, entry.id) : [];
  };

  /**
   * Full-base inflectional/sense SIBLINGS: other entries whose ENTIRE base
   * sequence equals the target's, differing only by indicators (e.g. target
   * "to murder" B206/B259/B532;;B81 ↔ sibling "murder" B206/B259/B532, or
   * concrete X;B97 ↔ abstract X;B6436). Self excluded. Fair game as helpers.
   */
  const siblingHelpersFor = (spelling, selfId) => {
    const base = baseSequenceOf(spelling);
    return base ? helpersForBase(base, selfId) : [];
  };

  const siblingsOf = (idOrCode) => {
    const entry = getEntry(idOrCode);
    return entry ? siblingHelpersFor(entry.spelling, entry.id) : [];
  };

  // Neighbour view: a helper view PLUS the neighbour's own base spelling and how
  // much it shares with the target (longest shared affix). Fair game like any
  // helper: it is ANOTHER preferred entry, never the target's own (sealed) data.
  const neighbourView = (entry, sharedLen, sharedSpelling) => ({
    id: entry.id,
    spelling: baseSequenceOf(entry.spelling),
    sharedLen,
    sharedSpelling,
    gloss: entry.gloss,
    pos: entry.pos,
    answers: getAnswers(entry),
    explanation: getExplanation(entry)
  });

  const sortNeighbours = (found) =>
    found.sort(
      (a, b) =>
        b.sharedLen - a.sharedLen || // most-shared first
        a.total - b.total || // then the tightest match (fewest extra glyphs)
        a.entry.id.localeCompare(b.entry.id, 'en', { numeric: true }) // stable order
    );

  /**
   * SHARED-START neighbours: other preferred entries that share a leading run with
   * the target then diverge or extend (non-shared tail <= MAX_START_TAIL glyphs).
   * Matching is indicator-AGNOSTIC (base sequences). Disjoint from subwords and
   * siblings: any entry whose base is a contiguous span of the target is skipped.
   * Ordered most-shared-first (longest shared affix), then tightest, then by id.
   */
  const sharedStartFor = (spelling, selfId) => {
    const target = baseArrayOf(spelling);
    if (!target || target.length === 0) return [];
    const spans = spanBaseSet(target);
    const found = [];
    for (const { entry: candidate, baseArr } of byLeadingBaseChar.get(target[0]) || []) {
      if (candidate.id === selfId) continue;
      if (spans.has(baseArr.join('/'))) continue; // a subword span or the sibling
      const shared = commonPrefixLen(target, baseArr);
      const tail = baseArr.length - shared;
      if (tail < 1 || tail > MAX_START_TAIL) continue;
      found.push({ entry: candidate, sharedLen: shared, sharedSpelling: target.slice(0, shared).join('/'), total: baseArr.length });
    }
    return sortNeighbours(found).map((f) => neighbourView(f.entry, f.sharedLen, f.sharedSpelling));
  };

  const sharedStartOf = (idOrCode) => {
    const entry = getEntry(idOrCode);
    return entry ? sharedStartFor(entry.spelling, entry.id) : [];
  };

  /**
   * SHARED-END neighbours: other preferred entries that share a trailing run with
   * the target but lead with a different, short head (<= MAX_END_HEAD glyphs).
   * Indicator-agnostic; disjoint from subwords and siblings (see sharedStartOf).
   */
  const sharedEndFor = (spelling, selfId) => {
    const target = baseArrayOf(spelling);
    if (!target || target.length === 0) return [];
    const spans = spanBaseSet(target);
    const found = [];
    for (const { entry: candidate, baseArr } of byTrailingBaseChar.get(target[target.length - 1]) || []) {
      if (candidate.id === selfId) continue;
      if (spans.has(baseArr.join('/'))) continue;
      const shared = commonSuffixLen(target, baseArr);
      const head = baseArr.length - shared;
      if (head < 1 || head > MAX_END_HEAD) continue;
      found.push({ entry: candidate, sharedLen: shared, sharedSpelling: target.slice(target.length - shared).join('/'), total: baseArr.length });
    }
    return sortNeighbours(found).map((f) => neighbourView(f.entry, f.sharedLen, f.sharedSpelling));
  };

  const sharedEndOf = (idOrCode) => {
    const entry = getEntry(idOrCode);
    return entry ? sharedEndFor(entry.spelling, entry.id) : [];
  };

  /**
   * NEIGHBOURS: the third match group, bundling shared-start + shared-end. A
   * neighbour shares an AFFIX with the target (the same leading run of glyphs,
   * which often carries the head/classifier, or a shared tail) but is neither a
   * contiguous fragment (subword) nor a
   * same-base variant (sibling). Compositional evidence, especially for spellings
   * not in the snapshot, where subwords/siblings may be thin.
   */
  const neighboursFor = (spelling, selfId) => ({
    sharedStart: sharedStartFor(spelling, selfId),
    sharedEnd: sharedEndFor(spelling, selfId)
  });

  const neighboursOf = (idOrCode) => {
    const entry = getEntry(idOrCode);
    return entry ? neighboursFor(entry.spelling, entry.id) : { sharedStart: [], sharedEnd: [] };
  };

  // The buildContext view of neighbours: each group capped to the top
  // NEIGHBOUR_CONTEXT_LIMIT (deepest-shared first), plus how many were omitted.
  const capNeighbours = ({ sharedStart, sharedEnd }) => ({
    sharedStart: sharedStart.slice(0, NEIGHBOUR_CONTEXT_LIMIT),
    sharedEnd: sharedEnd.slice(0, NEIGHBOUR_CONTEXT_LIMIT),
    omitted: {
      sharedStart: Math.max(0, sharedStart.length - NEIGHBOUR_CONTEXT_LIMIT),
      sharedEnd: Math.max(0, sharedEnd.length - NEIGHBOUR_CONTEXT_LIMIT)
    }
  });

  /**
   * Decode the SHOWN neighbours: the dictionary words found inside each neighbour's
   * NON-SHARED portion (the glyph(s) that differ from the target), as single glyphs
   * AND multi-glyph contiguous sequences, exactly like subwords decode the target.
   * So a neighbour B1/B2/B5/B6 of target B1/B2/B3/B4 contributes B5, B6 and (if it is
   * a word) B5/B6, not just an opaque code. Deduped across neighbours, and excluding
   * any part the target's own subwords already explain, so nothing is repeated.
   * Leak-safe: every part is ANOTHER preferred entry (selfId is never offered); the
   * target's sealed gloss is untouched. Only the capped neighbours are decoded, so
   * the work is tiny: each non-shared part is <= MAX_START_TAIL / MAX_END_HEAD glyphs.
   */
  const legendFor = (spelling, selfId, capped) => {
    const targetSpans = spanBaseSet(baseArrayOf(spelling) || []); // already shown via subwords
    const seenPart = new Set();
    const legend = [];
    const harvest = (neighbours, side) => {
      for (const nb of neighbours) {
        const nbBase = (nb.spelling || '').split('/').filter(Boolean);
        if (!nbBase.length) continue;
        const off = side === 'start'
          ? nbBase.slice(nb.sharedLen)                     // tail after the shared prefix
          : nbBase.slice(0, nbBase.length - nb.sharedLen); // head before the shared suffix
        for (const part of contiguousSpansOf(off)) {
          if (targetSpans.has(part) || seenPart.has(part)) continue;
          seenPart.add(part);
          for (const h of helpersForBase(part, selfId)) {
            legend.push({ spelling: part, length: part.split('/').length, id: h.id, gloss: h.gloss, pos: h.pos });
          }
        }
      }
    };
    harvest(capped.sharedStart, 'start');
    harvest(capped.sharedEnd, 'end');
    // Longest sequences first (the most informative), then stable by spelling + id.
    return legend.sort(
      (a, b) =>
        b.length - a.length ||
        a.spelling.localeCompare(b.spelling, 'en', { numeric: true }) ||
        a.id.localeCompare(b.id, 'en', { numeric: true })
    );
  };

  const modifiersOf = (spelling) => {
    const parsed = parseBCodeWord(spelling);
    return {
      matches: findModifierMatches(parsed),
      leadingRun: findLeadingModifierRun(parsed),
      full: findFullModifierMatch(parsed)
    };
  };

  /**
   * Indicators present in a spelling, resolved to their CURATED meaning
   * (data/indicators.json, the kit's authoritative reference, not the BCI-AV
   * dictionary, which under-explains indicators and mis-marks some).
   */
  const indicatorsOf = (spelling) => {
    const parsed = parseBCodeWord(spelling);
    return parsed.indicators.map((indicator) => {
      const ref = indicatorByCode.get(indicator.spelling);
      return {
        spelling: indicator.spelling,
        scope: indicator.scope,
        ...(indicator.characterIndex === undefined
          ? {}
          : { characterIndex: indicator.characterIndex }),
        name: ref ? ref.name : '',
        group: ref ? ref.group : '',
        purpose: ref ? ref.purpose : ''
      };
    });
  };

  // WARNING: a target's own derivationParts describe how THIS word was built
  // ("force + intensity"), a direct tell. Do not feed derivationOf(target) into a
  // prompt. Kept for inspection only; buildContext() never uses it.
  const derivationOf = (idOrCode) => {
    const entry = getEntry(idOrCode);
    if (!entry) return [];
    return entry.derivationParts.map((part) => ({
      id: part.id,
      code: part.code,
      gloss: part.gloss,
      bciAvId: part.bciAvId
    }));
  };

  // The shared building blocks for a spelling (modifiers / indicators / subwords /
  // siblings / neighbours). `selfId` is the entry excluded as its own helper, the
  // target's id for buildContext, or null for an arbitrary spelling with no "self".
  const assembleBlocks = (spelling, selfId) => {
    const parsed = parseBCodeWord(spelling);
    const neighbours = capNeighbours(neighboursFor(spelling, selfId));
    return {
      spelling,
      charCount: parsed.characters.length,
      // Pre-head operator sequences, each with two readings: `gloss` (the symbol's
      // own dictionary gloss, its recorded standalone sense, data-driven) and
      // `asPrefix` (how it reads when prefixing what follows, a list). `tier` (a
      // head-selection concern) is intentionally not surfaced: internal to the matcher.
      modifiers: findModifierMatches(parsed).map((m) => ({
        spelling: m.spelling,
        codes: m.codes,
        gloss: m.gloss,
        asPrefix: m.asPrefix,
        category: m.category,
        span: m.span
      })),
      indicators: indicatorsOf(spelling),
      subwords: subwordSpansFor(spelling, selfId).filter((s) => s.helpers.length > 0),
      siblings: siblingHelpersFor(spelling, selfId),
      // Third match group: shared-affix words (same leading run, which often carries
      // the head/classifier, or shared tail), capped per group with an `omitted`
      // count, full set via neighboursOf.
      neighbours,
      // Decoded parts of those neighbours: dictionary words inside each neighbour's
      // non-shared portion (single glyphs AND multi-glyph sequences, like subwords),
      // so the codes that differ from the target are not opaque. Deduped; leak-safe.
      legend: legendFor(spelling, selfId, neighbours)
    };
  };

  /**
   * Leak-free context for a TARGET (by id/code): the shared building blocks, with the
   * target's OWN entry sealed: excluded as its own helper/sibling, and none of its
   * gloss / explanation / derivation / part-of-speech is read. Anything in the target
   * entry could be a tell. This is the blessed benchmark path for building prompts.
   */
  const buildContext = (idOrCode) => {
    const entry = getEntry(idOrCode);
    if (!entry) return null;
    return { targetId: entry.id, ...assembleBlocks(normalizeSpelling(entry.spelling), entry.id) };
  };

  /**
   * Context for an ARBITRARY raw spelling that need not be a dictionary entry: the
   * real goal: interpret an unseen Bliss word from its parts. Same building blocks as
   * buildContext, computed from the spelling alone (no "self" to seal), PLUS
   * `exactMatch`: known word(s) whose canonical spelling equals this one, empty when
   * the spelling is genuinely novel (a real interpretation, not just a lookup).
   * Throws if the input is not a B-code word spelling.
   */
  const buildContextFromSpelling = (rawSpelling) => {
    let spelling;
    try {
      spelling = normalizeSpelling(rawSpelling);
    } catch {
      throw new Error(`Not a B-code word spelling: ${JSON.stringify(rawSpelling)}`);
    }
    const exactMatch = findBySpelling(spelling).map((e) => ({
      id: e.id,
      spelling: normalizeSpelling(e.spelling),
      pos: e.pos,
      gloss: e.gloss,
      answers: getAnswers(e),
      explanation: getExplanation(e)
    }));
    return { ...assembleBlocks(spelling, null), exactMatch };
  };

  const answerKeyOf = (idOrCode) => {
    const entry = getEntry(idOrCode);
    if (!entry) return null;
    return {
      targetId: entry.id,
      spelling: normalizeSpelling(entry.spelling),
      pos: entry.pos,
      answers: getAnswers(entry),
      explanation: getExplanation(entry)
    };
  };

  /**
   * Transparent record of how a target's accepted-answer set was expanded beyond
   * its raw gloss: `base` (the gloss alternatives), `added` (extra accepted spellings
   * each with a reason). Feeds `data/answer-aliases.jsonl`. Returns null for entries
   * with no expansion (so the emitted file lists only the targets that changed).
   */
  const answerAliasOf = (idOrCode) => {
    const entry = getEntry(idOrCode);
    if (!entry) return null;
    const { base, answers, added, source, note } = getAnswerKey(entry);
    // Log a row when the answer set was widened, OR whenever a human/model judged it
    // (a curated entry is worth showing even if it only cleaned, adding nothing).
    if (added.length === 0 && source !== 'curated') return null;
    const row = { targetId: entry.id, source, base, answers, added };
    if (note) row.note = note;
    return row;
  };

  /**
   * The frozen eligible target set, in stable B-id order. These are the words
   * every run tests. No answers here: those live in the hidden key.
   */
  const getEligibleTargets = () => {
    const targets = [];
    for (const entry of normalized) {
      const verdict = evaluateEligibility(entry);
      if (!verdict.eligible) continue;
      // Sealed: targets expose ONLY spelling-derived facts, never the target
      // entry's gloss / pos / explanation (those live in the hidden answer key).
      targets.push({
        targetId: entry.id,
        spelling: normalizeSpelling(entry.spelling),
        charCount: verdict.parsed.characters.length
      });
    }
    return targets.sort((a, b) => a.targetId.localeCompare(b.targetId, 'en', { numeric: true }));
  };

  const eligibilityReport = () => {
    const counts = { total: normalized.length, eligible: 0, byFailedRule: {}, byRuleIndependent: {} };
    for (const entry of normalized) {
      const verdict = evaluateEligibility(entry);
      if (verdict.eligible) {
        counts.eligible += 1;
        continue;
      }
      // byFailedRule: attribute each excluded entry to its FIRST failed rule, so
      // the buckets PARTITION the excluded set (they sum to total - eligible).
      const firstFailed = verdict.failed[0];
      counts.byFailedRule[firstFailed] = (counts.byFailedRule[firstFailed] || 0) + 1;
      // byRuleIndependent: how many entries fail each rule regardless of order
      // (these overlap, so they sum to MORE than the excluded count).
      for (const ruleId of verdict.failed) {
        counts.byRuleIndependent[ruleId] = (counts.byRuleIndependent[ruleId] || 0) + 1;
      }
    }
    return counts;
  };

  return {
    entries: normalized,
    size: normalized.length,
    getEntry,
    findBySpelling,
    findByBaseSpelling,
    subwordsOf,
    siblingsOf,
    sharedStartOf,
    sharedEndOf,
    neighboursOf,
    modifiersOf,
    indicatorsOf,
    derivationOf,
    buildContext,
    buildContextFromSpelling,
    answerKeyOf,
    answerAliasOf,
    getEligibleTargets,
    eligibilityReport
  };
};
