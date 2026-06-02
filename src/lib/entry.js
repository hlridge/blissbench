/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
/**
 * Entry normalization for the Blissary Bliss dictionary export (its symbol meanings draw on
 * BCI-AV's authorized vocabulary; the B-code `code` is a Blissary ID, the `bciAvId` is separate).
 *
 * Raw entries look like:
 *   { id, gloss, filename, isChar, pos, code, bciAvId, explanation,
 *     derivationParts, isWord, isIndicator, isNonPreferred, isDualForm, ... }
 *
 * Word entries carry the B-code spelling in `code` (e.g. "B804/B401").
 * Characters/indicators carry shape codes (e.g. "VL6:0,8;DOT:0,16") and are
 * canonically addressable as `B{id}`.
 */

import { expandAnswerKey } from '../rules/answer-aliases.js';
import { CURATED_ALIASES } from '../rules/answer-alias-curation.js';

const unique = (values) => [...new Set(values.filter(Boolean))];

const cleanText = (value) =>
  `${value || ''}`.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

export const normalizeRawEntry = (raw) => {
  const numericId = Number(raw.id);
  if (!Number.isInteger(numericId)) {
    // A bad id would otherwise become the string "BNaN" and silently collide with
    // every other malformed row: fail loudly so a corrupt custom snapshot is obvious.
    throw new Error(
      `Snapshot row has invalid id ${JSON.stringify(raw.id)} ` +
        `(gloss=${raw.gloss || ''}, code=${raw.code || ''}); expected an integer.`
    );
  }
  return {
    id: `B${numericId}`,
    numericId,
    bciAvId: raw.bciAvId,
    spelling: raw.code,
    gloss: raw.gloss || '',
    pos: raw.pos || '',
    explanation: raw.explanation || '',
    // NOTE: `raw.filename` (the symbol's IMAGE-file slug) is deliberately NOT carried.
    // It is not English meaning: it only ever contributed naming-convention artifacts
    // ("approve-(to)", underscores) and zero genuine answers. The gloss is the answer
    // source (and only as reliable as the dictionary, glosses can be uneven or wrong).
    isChar: Boolean(raw.isChar),
    isWord: Boolean(raw.isWord),
    isIndicator: Boolean(raw.isIndicator),
    isNonPreferred: Boolean(raw.isNonPreferred),
    isDualForm: Boolean(raw.isDualForm),
    isPrimitive: Boolean(raw.isPrimitive),
    derivationParts: Array.isArray(raw.derivationParts) ? raw.derivationParts : []
  };
};

// Split a gloss on "," ";" "|", but ONLY at the top level, never inside a "(...)" tag,
// so a tag that itself contains a comma ("doctor (rehab, hab)", "kebab (UK, NL)") stays one
// answer instead of breaking into unbalanced fragments ("(rehab" / "hab)").
const splitTopLevel = (value) => {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of `${value || ''}`) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === ',' || ch === ';' || ch === '|')) {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  parts.push(cur);
  return parts;
};

/** Cleaned base answers: the top-level comma/semicolon/pipe-separated alternatives in the gloss. */
const baseAnswers = (entry) => unique(splitTopLevel(entry.gloss).map(cleanText).filter(Boolean));

/**
 * The full accepted-answer key for an entry, plus a transparent record of how it was
 * expanded. `base` are the raw gloss alternatives; `answers` the accepted spellings;
 * `added` the extras (each with a reason); `source` is `"curated"` when a frozen model
 * judgement covers this target (then `note` carries its rationale), else `"rule"`.
 *
 * `curation` is injectable for testing; it defaults to the committed frozen decisions.
 * See `rules/answer-aliases.js` (policy) and `rules/answer-alias-curation.js` (the data).
 */
export const getAnswerKey = (entry, curation = CURATED_ALIASES) => {
  const base = baseAnswers(entry);
  const curated = entry && entry.id && curation ? curation[entry.id] : null;
  const { answers, added, source } = expandAnswerKey(base, curated ? curated.answers : undefined);
  const key = { base, answers, added, source };
  if (curated && curated.note) key.note = curated.note;
  return key;
};

/**
 * The set of acceptable English answers for an entry. Comma/semicolon/pipe
 * separated glosses are alternative answers, not one phrase
 * (e.g. "abuse, assault, violence" -> 3 answers); disambiguator tags are expanded
 * into the spellings a human would accept (e.g. "abortion (induced)" also accepts
 * "abortion" and "induced abortion"), see `getAnswerKey` / `rules/answer-aliases.js`.
 */
export const getAnswers = (entry) => getAnswerKey(entry).answers;

export const getExplanation = (entry) => cleanText(entry.explanation);
