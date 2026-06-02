/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
/**
 * Answer aliases: the "one or more spellings that should match" layer.
 *
 * A raw dictionary gloss often glues a disambiguator onto the head word
 * (`abortion (induced)`, `bassoon (2)`, `breast(s)`, `yuk - (exclamatory)`). Taken
 * literally these become the ONLY accepted answer, so an obvious-but-plain correct
 * guess fails. Two layers fix that:
 *
 *   1. The tightened mechanical RULE (this file). For a gloss a rule can read safely
 *      it strips every `(...)` tag to the bare head, cleans a stray ` - ` separator,
 *      adds the plural for an inflection `(s)/(es)` tag, and adds the other-dialect
 *      spelling. It deliberately NEVER fronts a tag ("induced abortion") or keeps an
 *      "X (Y)" literal: a regex can't tell a real adjective from a usage label, so it
 *      would invent junk ("shape circle", "exclamatory yuk -"). It only ever drops to
 *      the head, which is always safe.
 *
 *   2. The per-entry CURATED layer (`src/rules/answer-alias-curation.js`). A model read
 *      each messy gloss at AUTHORING time and froze the clean accepted set, including
 *      the natural frontings the rule refuses to guess. When a target has a curation
 *      entry, `getAnswerKey` uses it; a safety net still unions back every fully-clean
 *      gloss alternative so a correct answer is never dropped. The model NEVER runs in
 *      the build path, so `answers.jsonl` stays a pure function of (snapshot + curation).
 *
 * `needsCuration` is the single source of truth for the rule-vs-model split, used both
 * here and by the build to verify no suspect target silently falls back to the rule.
 * Every accepted form is reported (`added`, with a reason and a `source` marker) so
 * `bin/build-manifest.js` can emit the transparent `data/answer-aliases.jsonl` log.
 */

const collapse = (value) => `${value || ''}`.replace(/\s+/g, ' ').trim();
const PAREN_GLOBAL = /\s*\([^)]*\)\s*/g;

/** Inner parenthetical tags of a value, lowercased (`"egg (boiled)"` -> `["boiled"]`). */
const innerParens = (value) =>
  [...`${value}`.matchAll(/\(([^)]*)\)/g)].map((match) => match[1].trim().toLowerCase());

/**
 * The bare head of an answer: every `(...)` tag removed AND any stray separator hyphen
 * cleaned. A separator hyphen is ALWAYS space-flanked (`"yuk - (exclamatory)"` ->
 * `"yuk"`, `"myself - (feminine)"` -> `"myself"`); a real word-internal hyphen is
 * unspaced (`"brother-in-law"`, `"cold-blooded"`) and is preserved untouched.
 */
const headOf = (value) => {
  let s = collapse(`${value || ''}`.replace(PAREN_GLOBAL, ' '));
  s = s.replace(/\s+-\s+/g, ' '); // " - " separator between words -> space
  s = s.replace(/\s+-\s*$/g, ''); // trailing " -"
  s = s.replace(/^\s*-\s+/g, ''); // leading "- "
  return collapse(s);
};

/** True if a value carries a space-flanked separator hyphen (a gloss artifact). */
const hasStraySeparator = (value) => {
  const withoutTags = collapse(`${value || ''}`.replace(PAREN_GLOBAL, ' '));
  return /\s-(\s|$)/.test(withoutTags) || /(^|\s)-\s/.test(withoutTags);
};

// Inflection tags add an explicit plural form (the only tag the rule keeps a form for).
const INFLECTION = new Set(['s', 'es', 'pl', 'plural']);
const pluralOf = (head, tag) => {
  if (!head) return null;
  if (tag === 'es') return `${head}es`;
  return `${head}s`; // s / pl / plural
};

// A parenthetical tag a rule CAN handle on its own: a bare number ("(1)"/"(2)", two
// spellings of the same English word, drop it) or an inflection ("(s)"/"(es)").
const SAFE_TAG = (tag) => /^\d+$/.test(tag) || tag === 's' || tag === 'es';

/** A base answer a rule cannot safely expand (needs per-entry model judgement). */
const isSuspectBase = (base) =>
  hasStraySeparator(base) || innerParens(base).some((tag) => !SAFE_TAG(tag));

/** A base answer worth keeping verbatim: no tag and no stray separator hyphen. */
const isCleanLiteral = (base) => !/\(/.test(`${base}`) && !hasStraySeparator(base);

/**
 * The rule-vs-model split, in one place. A gloss "needs curation" iff ANY of its
 * comma/semicolon-split base answers is suspect. Clean words, numeric `(1)/(2)` and
 * inflection `(s)/(es)` glosses are rule-safe; everything else (descriptive tags,
 * `(ly)` suffixes, stray separators, multi-word tags) goes to model judgement.
 */
export const needsCuration = (baseForms) => baseForms.some(isSuspectBase);

// BrE <-> AmE pairs whose stems appear in this snapshot (verified against
// data/answers.jsonl). Bidirectional so a guess in either dialect matches whichever
// spelling the gloss happened to store. Token-level (whole word) to avoid substring
// false positives (e.g. "centre" must not touch "central").
export const DIALECT_PAIRS = [
  ['centre', 'center'], ['theatre', 'theater'], ['metre', 'meter'],
  ['behaviour', 'behavior'], ['favour', 'favor'], ['favourite', 'favorite'],
  ['harbour', 'harbor'], ['labour', 'labor'], ['neighbour', 'neighbor'],
  ['armour', 'armor'], ['parlour', 'parlor'],
  ['organise', 'organize'], ['realise', 'realize'],
  ['organisation', 'organization'], ['sterilisation', 'sterilization'],
  ['oesophagus', 'esophagus'], ['anaesthesia', 'anesthesia'], ['caesarean', 'cesarean'],
  ['diarrhoea', 'diarrhea'], ['orthopaedic', 'orthopedic'], ['faeces', 'feces'],
  ['defence', 'defense'], ['licence', 'license'],
  ['counselling', 'counseling'], ['traveller', 'traveler'], ['jewellery', 'jewelry'],
  ['programme', 'program'], ['aluminium', 'aluminum'], ['plough', 'plow'],
  ['sceptical', 'skeptical'], ['storey', 'story'], ['grey', 'gray'], ['moustache', 'mustache']
];
const DIALECT = new Map();
for (const [a, b] of DIALECT_PAIRS) {
  DIALECT.set(a, b);
  DIALECT.set(b, a);
}

/** Other-dialect spelling of a phrase, or null if no token has a known variant. */
const dialectVariant = (value) => {
  let changed = false;
  const out = value
    .split(/(\s+)/)
    .map((token) => {
      const swap = DIALECT.get(token.toLowerCase());
      if (swap) {
        changed = true;
        return swap;
      }
      return token;
    })
    .join('');
  return changed ? collapse(out) : null;
};

/**
 * Expand cleaned base answers into the full accepted-answer set, with a transparent
 * record. If `curatedAnswers` is supplied (the frozen model decision for this target),
 * it REPLACES the mechanical expansion, but every fully-clean base alternative is
 * unioned back in as a safety net so a genuinely-correct gloss answer is never dropped.
 * Otherwise the tightened mechanical rule runs. Dialect variants are added on top of
 * either layer.
 *
 * @param baseForms       string[]  cleaned base answers (gloss alternatives)
 * @param curatedAnswers  string[]  optional frozen model decision for this entry
 * @returns { answers: string[], added: [{form, reason}], source: 'rule'|'curated' }
 */
export const expandAnswerKey = (baseForms, curatedAnswers) => {
  const baseSet = new Set(baseForms);
  const accepted = [];
  const reasonByForm = new Map();
  const add = (form, reason) => {
    const f = collapse(form);
    if (!f || accepted.includes(f)) return;
    accepted.push(f);
    if (!baseSet.has(f)) reasonByForm.set(f, reason);
  };

  let source;
  if (Array.isArray(curatedAnswers)) {
    source = 'curated';
    for (const base of baseForms) if (isCleanLiteral(base)) add(base, 'curated');
    for (const answer of curatedAnswers) add(answer, 'curated');
  } else {
    source = 'rule';
    for (const base of baseForms) {
      const head = headOf(base);
      if (!head) continue;
      add(head, hasStraySeparator(base) ? 'separator-clean' : 'disambiguator-strip');
      for (const tag of innerParens(base)) {
        if (INFLECTION.has(tag)) add(pluralOf(head, tag), 'inflection');
      }
    }
  }

  // Dialect variants, applied to every accepted form (additive, both layers).
  for (const form of [...accepted]) {
    const variant = dialectVariant(form);
    if (variant) add(variant, 'dialect');
  }

  const added = accepted
    .filter((form) => !baseSet.has(form))
    .map((form) => ({ form, reason: reasonByForm.get(form) || source }));
  return { answers: accepted, added, source };
};
