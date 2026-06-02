/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
/**
 * Curated pre-head operator reference: the kit's authoritative list of the
 * sequences that may sit BEFORE the head of a spelling (negation, relations,
 * determiners, quantifiers, …). Their grammatical role varies (see `category`);
 * what they share is that they all read as a PREFIX on what follows.
 *
 * Origin of the SET: membership, tiers, and conditional exceptions are the BCI-AV
 * "head-glyph exclusions" as defined by bliss-svg-builder
 * (https://github.com/hlridge/bliss-svg-builder, MPL-2.0), referenced, not
 * vendored. `bin/build-modifiers.js` compiles this into the frozen
 * `data/modifiers.json` (never hand-edit that generated file).
 *
 * Each entry carries two readings, EDIT BOTH HERE, then run `node bin/build-modifiers.js`:
 *   asPrefix  (required) how the glyph reads when it PREFIXES what follows
 *             ("[group of][houses] = village", "[any][one] = anyone"). A hand-curated
 *             LIST: put ONLY prefix readings here. e.g. B100 is "any" as a prefix, NOT
 *             the standalone articles "a"/"an" (those belong to the gloss, not here).
 *   gloss     (OPTIONAL override) the symbol's STANDALONE / core meaning. By default
 *             `build-modifiers.js` fills it from the snapshot dictionary (data-driven, so
 *             it can't drift). Add a `gloss: '...'` field to OVERRIDE that default, e.g.
 *             to drop a prefix-only sense ("opposite of", "part of") from the standalone
 *             meaning, leaving it in `asPrefix` only. Omit it to keep the dictionary gloss.
 *
 * Fields: { spelling, category, tier, asPrefix, gloss? }
 *         (tier: regular | low-priority | absolute-never-head)
 */

// [excludedCode, notExcludedWhenImmediatelyFollowedBy]
export const conditionalExceptions = [['B10', 'B4']];

// Tokens noted as not-yet-available upstream in the head-glyph-exclusion source.
export const knownGaps = ['few (not yet in the head-glyph-exclusion source)'];

export const modifiers = [
  // Structural markers
  { spelling: 'B233', category: 'Structural markers', tier: 'absolute-never-head', asPrefix: ['combine marker'] }, // dict: "combine marker"

  // Pragmatic lexical markers
  { spelling: 'B401', category: 'Pragmatic lexical markers', tier: 'low-priority', asPrefix: ['exclamation'] }, // dict: "intensity"
  { spelling: 'B699', category: 'Pragmatic lexical markers', tier: 'low-priority', asPrefix: ['question'] }, // dict: "what, question mark (small)"

  // Scalar degree operators
  { spelling: 'B937', category: 'Scalar degree operators', tier: 'regular', asPrefix: ['more'] }, // dict: "comparative more"
  { spelling: 'B968', category: 'Scalar degree operators', tier: 'regular', asPrefix: ['most'], gloss: 'maximum'}, // dict: "superlative most"
  { spelling: 'B6438', category: 'Scalar degree operators', tier: 'regular', asPrefix: ['less'] }, // dict: "comparative less"
  { spelling: 'B6321', category: 'Scalar degree operators', tier: 'regular', asPrefix: ['least'], gloss: 'minimum'}, // dict: "minimum (2)"

  // Identity-affecting operators
  { spelling: 'B449/B401', category: 'Identity-affecting operators', tier: 'regular', asPrefix: ['not'] }, // dict: "not, negative, no, don't, doesn't"
  { spelling: 'B486', category: 'Identity-affecting operators', tier: 'regular', asPrefix: ['opposite of'], gloss: 'opposite meaning, opposite' }, // gloss override: dropped the prefix-only "opposite of" // dict: "opposite meaning, opposite of, opposite"

  // Concept-transforming operators
  { spelling: 'B1060/B578/B608/B292', category: 'Concept-transforming operators', tier: 'regular', asPrefix: ['rhymes with'] }, // dict: "rhyme"
  { spelling: 'B1060/B578/B303', category: 'Concept-transforming operators', tier: 'regular', asPrefix: ['looks similar to', "looks almost the same as"] }, // dict: "similar looking, looks similar"
  { spelling: 'B1060/B578/B608', category: 'Concept-transforming operators', tier: 'regular', asPrefix: ['sounds similar to', "sounds almost the same as"] }, // dict: "similar sound, sounds like"
  { spelling: 'B1060/B578/B374', category: 'Concept-transforming operators', tier: 'regular', asPrefix: ['feels similar to', "feels almost the same as"], gloss: 'similar feeling' }, // gloss override: nominal sense (composite not in BCI-AV)
  { spelling: 'B1060/B578/B473', category: 'Concept-transforming operators', tier: 'regular', asPrefix: ['smells similar to', "smells almost the same as"], gloss: 'similar smell' }, // gloss override: nominal sense (composite not in BCI-AV)
  { spelling: 'B1060/B578/B642', category: 'Concept-transforming operators', tier: 'regular', asPrefix: ['tastes similar to', "tastes almost the same as"], gloss: 'similar taste' }, // gloss override: nominal sense (composite not in BCI-AV)
  { spelling: 'B1060/B578', category: 'Concept-transforming operators', tier: 'regular', asPrefix: ['similar to', "almost the same as"] }, // dict: "similar, like, alike"
  { spelling: 'B578/B303', category: 'Concept-transforming operators', tier: 'regular', asPrefix: ['looks like', 'looks the same as'], gloss: 'same appearance' }, // gloss override: nominal sense (composite not in BCI-AV)
  { spelling: 'B578/B608', category: 'Concept-transforming operators', tier: 'regular', asPrefix: ['sounds like', 'sounds the same as'] }, // dict: "same sound"
  { spelling: 'B578/B374', category: 'Concept-transforming operators', tier: 'regular', asPrefix: ['feels like', 'feels the same as'], gloss: 'same feeling' }, // gloss override: nominal sense (composite not in BCI-AV)
  { spelling: 'B578/B473', category: 'Concept-transforming operators', tier: 'regular', asPrefix: ['smells like', 'smells the same as'], gloss: 'same smell' }, // gloss override: nominal sense (composite not in BCI-AV)
  { spelling: 'B578/B642', category: 'Concept-transforming operators', tier: 'regular', asPrefix: ['tastes like', 'tastes the same as'], gloss: 'same taste' }, // gloss override: nominal sense (composite not in BCI-AV)
  { spelling: 'B348', category: 'Concept-transforming operators', tier: 'regular', asPrefix: ['generalization of'] }, // dict: "generalization"
  { spelling: 'B444', category: 'Concept-transforming operators', tier: 'regular', asPrefix: ['metaphor for'] }, // dict: "metaphor"

  // Relational operators
  { spelling: 'B449', category: 'Relational operators', tier: 'regular', asPrefix: ['without'] }, // dict: "minus, no, without"
  { spelling: 'B578', category: 'Relational operators', tier: 'regular', asPrefix: ['same as'] }, // dict: "same, equal, equality"
  { spelling: 'B502/B167', category: 'Relational operators', tier: 'regular', asPrefix: ['part of Blissymbol', 'part of Bliss word'] }, // dict: "blissymbol part"
  { spelling: 'B502', category: 'Relational operators', tier: 'regular', asPrefix: ['part of'], gloss: 'part, bit, piece, portion' }, // gloss override: dropped the prefix-only "part of" // dict: "part, bit, piece, portion, part of"
  { spelling: 'B102', category: 'Relational operators', tier: 'regular', asPrefix: ['about', 'concerning', 'regarding', 'in relation to'] }, // dict: "about, concerning, regarding, in relation to, of, on"
  { spelling: 'B104', category: 'Relational operators', tier: 'regular', asPrefix: ['across'] }, // dict: "across"
  { spelling: 'B109', category: 'Relational operators', tier: 'regular', asPrefix: ['after', 'behind'] }, // dict: "after, behind"
  { spelling: 'B111', category: 'Relational operators', tier: 'regular', asPrefix: ['against'] }, // dict: "against, opposed to"
  { spelling: 'B120/B120', category: 'Relational operators', tier: 'regular', asPrefix: ['along with'] }, // dict: "along with"
  { spelling: 'B162/B368', category: 'Relational operators', tier: 'regular', asPrefix: ['among'] }, // dict: "among, amongst"
  { spelling: 'B134', category: 'Relational operators', tier: 'regular', asPrefix: ['around'] }, // dict: "around"
  { spelling: 'B135', category: 'Relational operators', tier: 'regular', asPrefix: ['at'] }, // dict: "at"
  { spelling: 'B158', category: 'Relational operators', tier: 'regular', asPrefix: ['before', 'in front of', 'prior to'] }, // dict: "before, in front of, prior to"
  { spelling: 'B162', category: 'Relational operators', tier: 'regular', asPrefix: ['between'] }, // dict: "between"
  { spelling: 'B195', category: 'Relational operators', tier: 'regular', asPrefix: ['by'] }, // dict: "by, by means of, of"
  { spelling: 'B482', category: 'Relational operators', tier: 'regular', asPrefix: ['on'] }, // dict: "on"
  { spelling: 'B491', category: 'Relational operators', tier: 'regular', asPrefix: ['out of (forward)'] }, // dict: "out of, exit (forward)"
  { spelling: 'B492', category: 'Relational operators', tier: 'regular', asPrefix: ['out of (downward)'] }, // dict: "out of, exit (downward)"
  { spelling: 'B977', category: 'Relational operators', tier: 'regular', asPrefix: ['out of (upward)'] }, // dict: "out of (upward)"
  { spelling: 'B976', category: 'Relational operators', tier: 'regular', asPrefix: ['out of (backward)'] }, // dict: "out of (backward)"
  { spelling: 'B402', category: 'Relational operators', tier: 'regular', asPrefix: ['into (forward)'] }, // dict: "into, entrance"
  { spelling: 'B1124', category: 'Relational operators', tier: 'regular', asPrefix: ['into (downward)'] }, // dict: "into (downward)"
  { spelling: 'B1125', category: 'Relational operators', tier: 'regular', asPrefix: ['into (upward)'] }, // dict: "into (upward)"
  { spelling: 'B1123', category: 'Relational operators', tier: 'regular', asPrefix: ['into (backward)'] }, // dict: "into (backward)"
  { spelling: 'B490', category: 'Relational operators', tier: 'regular', asPrefix: ['outside'] }, // dict: "out, exterior, external, outside"
  { spelling: 'B398', category: 'Relational operators', tier: 'regular', asPrefix: ['inside'] }, // dict: "in, inside, interior, internal"
  { spelling: 'B493', category: 'Relational operators', tier: 'regular', asPrefix: ['over', 'above', 'superior to'] }, // dict: "over, above, superior"
  { spelling: 'B676', category: 'Relational operators', tier: 'regular', asPrefix: ['under', 'below', "inferior to"] }, // dict: "under, below, inferior"
  { spelling: 'B1102', category: 'Relational operators', tier: 'regular', asPrefix: ['under (ground level)'] }, // dict: "under (ground level)"
  { spelling: 'B331', category: 'Relational operators', tier: 'regular', asPrefix: ['instead of', 'in exchange for'] }, // dict: "for (in exchange for), instead"
  { spelling: 'B332', category: 'Relational operators', tier: 'regular', asPrefix: ['for the purpose of'] }, // dict: "for (the purpose of), in order to"
  { spelling: 'B337', category: 'Relational operators', tier: 'regular', asPrefix: ['from'] }, // dict: "from"
  { spelling: 'B657', category: 'Relational operators', tier: 'regular', asPrefix: ['to', 'toward'] }, // dict: "to, toward, towards"
  { spelling: 'B653', category: 'Relational operators', tier: 'regular', asPrefix: ['through'] }, // dict: "through"
  { spelling: 'B677', category: 'Relational operators', tier: 'regular', asPrefix: ['until'] }, // dict: "until, till, to"
  { spelling: 'B160', category: 'Relational operators', tier: 'regular', asPrefix: ['belongs to'] }, // dict: "belongs to, of (possessive)"

  // Determiners
  { spelling: 'B100', category: 'Determiners', tier: 'regular', asPrefix: ['any', 'unspecific to'] }, // "any" is the prefix (anyone/anyday); "a"/"an" are standalone, kept in gloss // dict: "a, an, any"
  { spelling: 'B647', category: 'Determiners', tier: 'regular', asPrefix: ['specific to'] }, // dict: "the"

  // Quantifiers
  { spelling: 'B368/B368/B368', category: 'Quantifiers', tier: 'regular', asPrefix: ['very very much', 'very very many'], gloss: 'very very much, very very many' }, // gloss override: nominal sense (composite not in BCI-AV)
  { spelling: 'B368/B368', category: 'Quantifiers', tier: 'regular', asPrefix: ['very much', 'very many'] }, // dict: "very much, very many"
  { spelling: 'B368', category: 'Quantifiers', tier: 'regular', asPrefix: ['group of', 'much', 'many'] }, // dict: "group of, much of, many of, quantity of"
  { spelling: 'B117', category: 'Quantifiers', tier: 'regular', asPrefix: ['all', 'every'] }, // dict: "all, every, everything, total, whole"
  { spelling: 'B11/B117', category: 'Quantifiers', tier: 'regular', asPrefix: ['both'] }, // dict: "both"
  { spelling: 'B10/B117', category: 'Quantifiers', tier: 'regular', asPrefix: ['each', 'every'] }, // dict: "each, every"
  { spelling: 'B286', category: 'Quantifiers', tier: 'regular', asPrefix: ['either'] }, // dict: "either"
  { spelling: 'B449/B286', category: 'Quantifiers', tier: 'regular', asPrefix: ['neither'] }, // dict: "neither"
  { spelling: 'B951', category: 'Quantifiers', tier: 'regular', asPrefix: ['half of'] }, // dict: "half, one-half"
  { spelling: 'B962', category: 'Quantifiers', tier: 'regular', asPrefix: ['one quarter of'] }, // dict: "quarter, one quarter"
  { spelling: 'B1151', category: 'Quantifiers', tier: 'regular', asPrefix: ['one third of'] }, // dict: "one third"
  { spelling: 'B1152', category: 'Quantifiers', tier: 'regular', asPrefix: ['two thirds of'] }, // dict: "two thirds"
  { spelling: 'B1153', category: 'Quantifiers', tier: 'regular', asPrefix: ['three quarters of'] }, // dict: "three quarters"
  { spelling: 'B559/B11', category: 'Quantifiers', tier: 'regular', asPrefix: ['several'] }, // dict: "several"
  { spelling: 'B9', category: 'Quantifiers', tier: 'regular', asPrefix: ['zero (quantifier)'], gloss: 'zero, 0, zero (digit), zero (index: the 0th)' }, // dict: "zero (digit), 0"
  { spelling: 'B10', category: 'Quantifiers', tier: 'regular', asPrefix: ['one (quantifier)'], gloss: 'one, 1, one (digit), one (index: the 1st)' }, // dict: "one (digit), 1, modifier (first person)"
  { spelling: 'B11', category: 'Quantifiers', tier: 'regular', asPrefix: ['two (quantifier)'], gloss: 'two, 2, two (digit), two (index: the 2nd)' }, // dict: "two (digit), 2, modifier (second person)"
  { spelling: 'B12', category: 'Quantifiers', tier: 'regular', asPrefix: ['three (quantifier)'], gloss: 'three, 3, three (digit), three (index: the 3rd)' }, // dict: "three (digit), 3, modifier (third person)"
  { spelling: 'B13', category: 'Quantifiers', tier: 'regular', asPrefix: ['four (quantifier)'], gloss: 'four, 4, four (digit), four (index: the 4th)' }, // dict: "four (digit), 4"
  { spelling: 'B14', category: 'Quantifiers', tier: 'regular', asPrefix: ['five (quantifier)'], gloss: 'five, 5, five (digit), five (index: the 5th)' }, // dict: "five (digit), 5"
  { spelling: 'B15', category: 'Quantifiers', tier: 'regular', asPrefix: ['six (quantifier)'], gloss: 'six, 6, six (digit), six (index: the 6th)' }, // dict: "six (digit), 6"
  { spelling: 'B16', category: 'Quantifiers', tier: 'regular', asPrefix: ['seven (quantifier)'], gloss: 'seven, 7, seven (digit), seven (index: the 7th)' }, // dict: "seven (digit), 7"
  { spelling: 'B17', category: 'Quantifiers', tier: 'regular', asPrefix: ['eight (quantifier)'], gloss: 'eight, 8, eight (digit), eight (index: the 8th)' }, // dict: "eight (digit), 8"
  { spelling: 'B18', category: 'Quantifiers', tier: 'regular', asPrefix: ['nine (quantifier)'], gloss: 'nine, 9, nine (digit), nine (index: the 9th)' } // dict: "nine (digit), 9"
];
