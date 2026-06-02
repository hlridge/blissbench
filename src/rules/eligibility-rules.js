/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
/**
 * Eligibility rules: the "what we test" half of the contract.
 *
 * This registry is the SINGLE SOURCE OF TRUTH. Each rule co-locates its
 * human-readable explanation (`title`, `why`, `rule`) with its executable
 * `test`. CONTRACT.md is generated from these objects, so the prose and the
 * behavior can never drift apart.
 *
 * A rule's `test(subject)` returns true when the entry PASSES that rule.
 * An entry is eligible only if it passes every rule.
 *
 * `subject` is precomputed once per entry by evaluateEligibility():
 *   { entry, parsed, answers, fullModifier }
 */
import { parseBCodeWord } from '../lib/bcode.js';
import { getAnswers } from '../lib/entry.js';
import { findFullModifierMatch } from '../modifiers/match.js';

// Rule order matters only for reporting: each excluded entry is attributed to
// the FIRST rule it fails. The order below is chosen so each excluded population
// lands in its most meaningful bucket (indicators and characters before the
// generic "not a B-code word" rule, since their codes are shape codes).
export const eligibilityRules = [
  {
    id: 'exclude-indicators',
    applies: 'target-eligibility',
    title: 'Indicators are not targets',
    why:
      'Indicators (tense, plural, part-of-speech markers, ...) are grammatical operators ' +
      'attached to other symbols, not standalone words to interpret.',
    rule: 'Entries flagged `isIndicator` are ineligible.',
    test: (subject) => subject.entry.isIndicator !== true
  },
  {
    id: 'exclude-characters',
    applies: 'target-eligibility',
    title: 'Single Bliss characters are not targets',
    why:
      'A character (isChar) is an atomic glyph (its `code` is a shape, e.g. "VL6:0,8;DOT:0,16"). ' +
      'Interpreting it tests vocabulary recall, not the interpretation of composed meaning.',
    rule: 'Entries flagged `isChar` are ineligible.',
    test: (subject) => subject.entry.isChar !== true
  },
  {
    id: 'require-word',
    applies: 'target-eligibility',
    title: 'Only dictionary words are targets',
    why:
      'The task is "interpret this Bliss WORD". Entries the dictionary does not mark as a ' +
      'word are out of scope.',
    rule: 'Entries must be flagged `isWord`.',
    test: (subject) => subject.entry.isWord === true
  },
  {
    id: 'valid-bcode-spelling',
    applies: 'target-eligibility',
    title: 'Spelling must be a B-code word',
    why:
      'Only B-code word spellings (e.g. "B804/B401") have the character structure this ' +
      'benchmark is about. Shape/primitive codes are drawing instructions, not interpretable words.',
    rule: 'The entry\'s `code` must parse as a B-code word spelling.',
    test: (subject) => subject.parsed !== null
  },
  {
    id: 'min-two-characters',
    applies: 'target-eligibility',
    title: 'At least two characters',
    why:
      'A one-character word has no internal composition to interpret. A correct guess would ' +
      'measure recall, not interpretation, so single-character words are excluded.',
    rule: 'The parsed spelling must contain >= 2 characters.',
    test: (subject) => subject.parsed !== null && subject.parsed.characters.length >= 2
  },
  {
    id: 'exclude-full-modifier',
    applies: 'target-eligibility',
    title: 'Pure modifier words are not targets',
    why:
      'A word whose entire spelling is one modifier/operator sequence (e.g. "the", "not", ' +
      '"many") is structural vocabulary. Its meaning is the modifier itself, so it is not a ' +
      'composition to interpret.',
    rule: 'The full spelling must NOT match a single modifier sequence (data/modifiers.json).',
    test: (subject) => subject.fullModifier === null
  },
  {
    id: 'require-answer',
    applies: 'target-eligibility',
    title: 'Must have a scoreable answer',
    why:
      'With no English gloss there is nothing to score a guess against, so the entry cannot ' +
      'contribute a meaningful, comparable result.',
    rule: 'The entry must yield at least one non-empty English answer.',
    test: (subject) => subject.answers.length >= 1
  },
  {
    id: 'exclude-non-preferred',
    applies: 'target-eligibility',
    title: 'Exclude non-preferred spellings',
    why:
      'Non-preferred entries are deprecated or alternative spellings of a preferred symbol. ' +
      'Including them double-counts concepts and makes scores depend on which variant a ' +
      'pipeline happened to hit. (Discussable: toggle if you want them in.)',
    rule: 'Entries flagged `isNonPreferred` are ineligible.',
    test: (subject) => subject.entry.isNonPreferred !== true
  }
];

/**
 * Evaluate every rule against a normalized entry.
 * Returns { eligible, passed[], failed[] } where failed[] lists rule ids.
 */
export const evaluateEligibility = (entry) => {
  let parsed = null;
  try {
    parsed = parseBCodeWord(entry.spelling);
  } catch {
    parsed = null;
  }
  const subject = {
    entry,
    parsed,
    answers: getAnswers(entry),
    fullModifier: parsed ? findFullModifierMatch(parsed) : null
  };

  const passed = [];
  const failed = [];
  for (const rule of eligibilityRules) {
    (rule.test(subject) ? passed : failed).push(rule.id);
  }

  return { eligible: failed.length === 0, passed, failed, parsed };
};
