/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
/**
 * Scoring rules: the "comparable result" half of the contract.
 *
 * Two registries, both human-readable and explained:
 *   normalizationRules  how a string is canonicalized before answers/candidates are compared
 *   metrics             what is reported (top-1, top-5, MRR)
 *
 * The normalization pipeline IS the registry: normalizeForScoring() reduces a
 * value through `normalizationRules[].apply`, so the documented steps and the
 * executed steps are the same objects.
 */

const VERB_PARTS_OF_SPEECH = new Set(['action', 'verb']);
export const isVerbPartOfSpeech = (pos) =>
  VERB_PARTS_OF_SPEECH.has(`${pos || ''}`.trim().toLowerCase());

/**
 * Ordered normalization steps. Each is applied to BOTH the answer key and the
 * model's candidates, so the comparison is apples-to-apples.
 */
export const normalizationRules = [
  {
    id: 'lowercase',
    title: 'Case-insensitive',
    why: 'Capitalization is not part of the meaning; "Drive" and "drive" should match.',
    rule: 'Lowercase the value.',
    apply: (value) => `${value || ''}`.toLowerCase()
  },
  {
    id: 'strip-punctuation',
    title: 'Ignore punctuation',
    why:
      'Trailing periods, brackets, quotes etc. are noise ("drive." matches "drive"). An ' +
      'apostrophe joins a word rather than separating it, so it is dropped, not split: ' +
      '"let\'s" matches "lets" and "o\'clock" matches "oclock", not two separate tokens.',
    rule:
      'Drop apostrophes, then replace every remaining character except a-z, 0-9, whitespace ' +
      'and hyphen with a space.',
    apply: (value) =>
      `${value || ''}`
        .replace(/['’]/g, '')
        .replace(/[^a-z0-9\s-]/g, ' ')
  },
  {
    id: 'collapse-whitespace',
    title: 'Collapse whitespace',
    why: 'Spacing differences are not meaningful; "ice  cream" should match "ice cream".',
    rule: 'Collapse runs of whitespace to a single space and trim.',
    apply: (value) => value.replace(/\s+/g, ' ').trim()
  },
  {
    id: 'verb-infinitive',
    title: 'Verbs compared in "to ..." form',
    why:
      'The dictionary glosses action words as infinitives ("to drive"). Requiring the same form ' +
      'on both sides keeps verb scoring consistent regardless of how a pipeline phrases it.',
    rule:
      'If the target part-of-speech is action/verb, prefix non-empty values that do not ' +
      'already start with "to " with "to ".',
    apply: (value, ctx) => {
      if (!value || !isVerbPartOfSpeech(ctx && ctx.pos)) return value;
      return value.startsWith('to ') ? value : `to ${value}`;
    }
  }
];

/**
 * Answer-key construction rule (applied earlier, in lib/entry.js#getAnswers):
 * comma/semicolon/pipe separated glosses are ALTERNATIVE answers, any of which
 * counts as correct, not one combined phrase. Documented here for CONTRACT.md.
 */
export const answerKeyRules = [
  {
    id: 'comma-alternatives',
    applies: 'answer-key',
    title: 'Comma-separated glosses are alternatives',
    why:
      'A gloss like "abuse, assault, violence" lists synonyms. Any one of them is a correct ' +
      'interpretation, so they are split into separate acceptable answers.',
    rule: 'Split the gloss on "," ";" "|" into separate answers; matching any one scores.'
  },
  {
    id: 'disambiguator-strip',
    applies: 'answer-key',
    title: 'A bracketed tag is stripped to the bare head (mechanical rule)',
    why:
      'Raw glosses glue a tag onto the head word ("abortion (induced)", "circle (shape)", ' +
      '"yuk - (exclamatory)"). The head is the real meaning, and the tag, a sense, domain, usage ' +
      'label, grammatical sub-sense, a numeric homograph index ("bassoon (1)/(2)" are two spellings ' +
      'of the SAME word), or a direction, is either not recoverable from the symbols or not an ' +
      'English spelling difference. A regex cannot tell a real adjective from a label, so the rule ' +
      'only ever drops to the head (and cleans a stray " - " separator); it never fronts a tag or ' +
      'keeps the "X (Y)" literal. Natural frontings come from the curated layer below.',
    rule:
      'For "X (Y)" accept the bare head "X" (cleaning any stray " - " separator); drop every tag. ' +
      'Word-internal hyphens ("brother-in-law") are preserved.'
  },
  {
    id: 'inflection-both-forms',
    applies: 'answer-key',
    title: 'Singular and plural both accepted for "(s)"',
    why:
      'A "(s)" tag ("breast(s)", "chair(s)") marks an optional plural; both the singular and the ' +
      'plural are correct English answers.',
    rule: 'For "X(s)" / "X(es)" accept both the singular "X" and the plural "Xs" / "Xes".'
  },
  {
    id: 'curated-aliases',
    applies: 'answer-key',
    title: 'Messy glosses get per-entry model judgement, frozen at authoring time',
    why:
      'The mechanical rule is safe but blunt: it cannot decide when fronting a descriptor is natural ' +
      'English ("induced abortion", "dried apricot") versus nonsense ("shape circle"), nor read the ' +
      'more than 300 distinct disambiguator tags. So for every target a rule cannot safely handle (a tag ' +
      'outside numeric/inflection, a stray " - " separator, a "(ly)" suffix), a model read the gloss ' +
      'ONCE at authoring time and decided the clean accepted spellings. Those decisions are frozen in ' +
      'src/rules/answer-alias-curation.js and merged deterministically, the model never runs in the ' +
      'build, so answers.jsonl stays reproducible. A safety net unions back every fully-clean gloss ' +
      'alternative so a correct answer is never dropped.',
    rule:
      'When a target has a curated entry, its model-judged spellings replace the mechanical expansion ' +
      '(clean gloss alternatives still kept); logged with source:"curated" + a rationale in ' +
      'data/answer-aliases.jsonl. Otherwise the mechanical rule applies (source:"rule").'
  },
  {
    id: 'dialect-variants',
    applies: 'answer-key',
    title: 'British and American spellings both accepted',
    why:
      'The dataset leans British ("behaviour", "centre"); a model spelling the American form ' +
      'should not be penalized. The mapping is a small curated table of the stems present, applied ' +
      'whole-word in both directions.',
    rule: 'Add the other-dialect spelling of any answer token in the curated BrE<->AmE table.'
  }
];

export const metrics = [
  {
    id: 'top1',
    title: 'Top-1 accuracy',
    why: 'Did the single best guess match? The strictest, most legible headline number.',
    rule: 'Fraction of targets whose rank-1 candidate matches any accepted answer.'
  },
  {
    id: 'top5',
    title: 'Top-5 accuracy',
    why: 'Did any of the five candidates match? Rewards a correct-but-not-first answer.',
    rule: 'Fraction of targets with a matching answer in candidates 1..5.'
  },
  {
    id: 'mrr',
    title: 'Mean Reciprocal Rank',
    why: 'Rewards ranking the right answer higher; 1/rank averaged over all targets.',
    rule: 'Mean of 1/rank (0 if no candidate in the first 5 matches).'
  }
];

const normalizeForScoring = (value, ctx) =>
  normalizationRules.reduce((acc, rule) => rule.apply(acc, ctx), value);

/**
 * Score one submission row against its answer key.
 * `candidates` is the model's best-first list; only the first 5 are considered.
 */
export const scoreRow = (candidates, answerKey) => {
  const ctx = { pos: answerKey.pos };
  const accepted = new Set(
    (answerKey.answers || [])
      .map((answer) => normalizeForScoring(answer, ctx))
      .filter(Boolean)
  );
  const considered = (candidates || []).slice(0, 5);
  const normalizedCandidates = considered.map((candidate) =>
    normalizeForScoring(candidate, ctx)
  );
  const index = normalizedCandidates.findIndex((candidate) => accepted.has(candidate));
  const rank = index === -1 ? null : index + 1;

  return {
    targetId: answerKey.targetId,
    pos: answerKey.pos || '',
    rank,
    top1: rank === 1,
    top5: rank !== null && rank <= 5,
    reciprocalRank: rank === null ? 0 : 1 / rank,
    acceptedAnswers: [...accepted],
    normalizedCandidates
  };
};

const aggregate = (rows) => {
  const n = rows.length;
  const sum = (values) => values.reduce((acc, value) => acc + value, 0);
  return {
    total: n,
    top1: n === 0 ? 0 : sum(rows.map((s) => (s.top1 ? 1 : 0))) / n,
    top5: n === 0 ? 0 : sum(rows.map((s) => (s.top5 ? 1 : 0))) / n,
    mrr: n === 0 ? 0 : sum(rows.map((s) => s.reciprocalRank)) / n
  };
};

/**
 * Aggregate metrics over all scored rows, plus a `byPos` breakdown. The
 * top-level total/top1/top5/mrr are unchanged (backward-compatible); `byPos`
 * is additive: useful because the eligible set is pos-skewed (mostly nouns),
 * so an aggregate can mask per-part-of-speech performance.
 */
export const summarizeScores = (scores) => {
  const groups = new Map();
  for (const s of scores) {
    const key = s.pos || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  const byPos = Object.fromEntries(
    [...groups.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([pos, rows]) => [pos, aggregate(rows)])
  );
  return { ...aggregate(scores), byPos };
};
