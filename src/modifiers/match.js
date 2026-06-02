/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
/**
 * Modifier matching: head-free.
 *
 * Modifiers are detected purely as SEQUENCES OF CHARACTERS, using the reference
 * built from the BCI-AV head-glyph exclusions (data/modifiers.json). There is no
 * head-glyph detection and no dependency on bliss-svg-builder.
 *
 * Three views are offered:
 *   findModifierMatches(parsed)     all known modifier sequences anywhere in the word
 *   findLeadingModifierRun(parsed)  the prefix run of modifiers ("modifiers before the concept")
 *   findFullModifierMatch(parsed)   true if the ENTIRE word is one modifier sequence
 */

let MODIFIERS = null;

/**
 * Provide the modifier reference (the parsed contents of data/modifiers.json).
 * The query layer calls this once at load; callers normally never touch it.
 */
export const setModifierReference = (modifiers) => {
  const conditional = modifiers.conditionalExceptions || [];
  // Sort by descending code-length so greedy matching prefers longer sequences
  // (e.g. 'B449/B401' = "not" wins over a bare 'B449' = "without").
  const ordered = [...modifiers.entries]
    .map((entry) => {
      const codes = entry.codes || (entry.spelling ? entry.spelling.split('/') : []);
      // A zero-length entry would match vacuously at every position and never advance
      // the cursor (an infinite loop in findLeadingModifierRun), so fail loudly, the
      // same stance lib/entry.js takes so a corrupt custom snapshot is obvious.
      if (!codes.length) {
        throw new Error(`modifiers reference entry has empty/missing codes: ${JSON.stringify(entry)}`);
      }
      return { ...entry, codes };
    })
    .sort((a, b) => b.codes.length - a.codes.length);
  MODIFIERS = { ordered, conditional };
  return MODIFIERS;
};

const ref = () => {
  if (!MODIFIERS) {
    throw new Error('Modifier reference not loaded. Call setModifierReference(modifiers) first.');
  }
  return MODIFIERS;
};

const baseCodesOf = (parsedWord) =>
  parsedWord.characters.map((character) => character.baseSpelling);

// A single-code modifier can be cancelled by a conditional exception, e.g. B10
// ("one") is NOT a modifier when immediately followed by B4.
const isCancelledByException = (entry, start, baseCodes, conditional) => {
  if (entry.codes.length !== 1) return false;
  return conditional.some(
    ([code, notWhenFollowedBy]) =>
      entry.spelling === code && baseCodes[start + 1] === notWhenFollowedBy
  );
};

const matchesAt = (codes, baseCodes, start) =>
  start + codes.length <= baseCodes.length &&
  codes.every((code, offset) => baseCodes[start + offset] === code);

const toMatch = (entry, start, parsedWord) => {
  const end = start + entry.codes.length;
  return {
    span: [start, end],
    spelling: entry.spelling,
    codes: entry.codes,
    gloss: entry.gloss || '',
    asPrefix: entry.asPrefix || [],
    category: entry.category,
    tier: entry.tier,
    matchedGlyphs: parsedWord.characters.slice(start, end).map((character) => ({
      index: character.index,
      spelling: character.spelling
    }))
  };
};

/**
 * All non-overlapping modifier sequences found anywhere in the word, left to
 * right, longest-sequence-first.
 */
export const findModifierMatches = (parsedWord) => {
  const { ordered, conditional } = ref();
  const baseCodes = baseCodesOf(parsedWord);
  const occupied = new Array(baseCodes.length).fill(false);
  const matches = [];

  for (let start = 0; start < baseCodes.length; start += 1) {
    if (occupied[start]) continue;
    const entry = ordered.find(
      (candidate) =>
        candidate.codes.every((_, offset) => !occupied[start + offset]) &&
        matchesAt(candidate.codes, baseCodes, start) &&
        !isCancelledByException(candidate, start, baseCodes, conditional)
    );
    if (!entry) continue;
    for (let i = start; i < start + entry.codes.length; i += 1) occupied[i] = true;
    matches.push(toMatch(entry, start, parsedWord));
  }

  return matches;
};

/**
 * The leading run of modifier sequences: the classic "modifiers stacked before
 * the concept". Returns the matched modifiers and `restSpan` (where the content
 * presumably begins). Empty `modifiers` means the word starts on content.
 */
export const findLeadingModifierRun = (parsedWord) => {
  const { ordered, conditional } = ref();
  const baseCodes = baseCodesOf(parsedWord);
  const modifiers = [];
  let cursor = 0;

  while (cursor < baseCodes.length) {
    const entry = ordered.find(
      (candidate) =>
        matchesAt(candidate.codes, baseCodes, cursor) &&
        !isCancelledByException(candidate, cursor, baseCodes, conditional)
    );
    if (!entry) break;
    modifiers.push(toMatch(entry, cursor, parsedWord));
    cursor += entry.codes.length;
  }

  return {
    modifiers,
    restSpan: [cursor, baseCodes.length],
    consumedAll: cursor === baseCodes.length
  };
};

/**
 * If the ENTIRE spelling is exactly one modifier sequence (e.g. "the" = B647,
 * "not" = B449/B401), return its descriptor; otherwise null. Used by the
 * eligibility layer to drop pure-modifier words as interpretation targets.
 */
export const findFullModifierMatch = (parsedWord) => {
  const { ordered, conditional } = ref();
  const baseCodes = baseCodesOf(parsedWord);
  const entry = ordered.find(
    (candidate) =>
      candidate.codes.length === baseCodes.length &&
      matchesAt(candidate.codes, baseCodes, 0) &&
      !isCancelledByException(candidate, 0, baseCodes, conditional)
  );
  return entry ? toMatch(entry, 0, parsedWord) : null;
};
