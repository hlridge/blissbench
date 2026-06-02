# blissbench Contract

> **Generated file, do not edit by hand.** Regenerate with `node bin/build-manifest.js`.
> Every rule below is generated from the executable rule registries in `src/rules/`,
> so this document and the kit's behavior can never disagree.

## Snapshot

- Source: `data/blissary-bliss-dictionary-export-2026-05-23.json`
- SHA-256: `b54a1ec3bf215f3d85de3a44daf0f6de4fda173d7d74707ad787fe5e6ecfa164`
- Kit version: `0.1.0`
- Entries: **6420** total → **4186** eligible targets

Scores are comparable only across runs that share the same SHA-256 (and set seed).

## What the model may see (information sealing)

The target entry is **off-bounds for information seeking**. Anything in the target's own
dictionary entry (gloss, explanation, derivation, part-of-speech, filename) could be a
tell, so the kit never exposes it when building context. A prompt may use only:

- the canonical **spelling** (the question itself) and facts derived from it;
- **modifier** sequences (each with `gloss`, the symbol's own dictionary meaning, and
  `asPrefix`, how it reads when prefixing what follows) and **indicator** meanings, from the
  kit's curated references (general symbol knowledge, see the reference sections below);
- **subword helpers**: other *preferred* dictionary entries that match a contiguous subword;
- **siblings**: other *preferred* entries with the same glyphs but different indicators;
- **neighbours**: other *preferred* entries that share an AFFIX with the target, the same
  leading run of glyphs (which often, but not always, carries the head/classifier) or a
  shared trailing run, but are neither a fragment
  (subword) nor a same-base variant (sibling). Ranked longest-shared-first; `buildContext`
  caps each group with an `omitted` count, and the full set is available via `neighboursOf`.

Subword/sibling/neighbour matching is **indicator-agnostic**: it compares the base character
sequence, ignoring sense (`;B97`/`;B6436`) and grammatical (`;;…`) indicators, so a fragment
finds grammatical and sense variants of those glyphs. A helper, sibling, or neighbour from
*another* entry may legitimately reveal an answer (e.g. "murder" helps "to murder"); this is
allowed and symmetric: composing meaning from such evidence is exactly the task. Only the
target's OWN entry is sealed.

The dictionary is human-curated, **not an oracle**: its glosses, derivations and coverage are
uneven and can be wrong or inconsistent. So the helpers/siblings/neighbours it yields shape,
and limit, how well any method can do: a thinly-covered subject surfaces few or conflicting
hints. Treat a gloss as evidence, not ground truth.

`kit.dataset.buildContext(targetId)` returns exactly this leak-free view. The raw accessors
(`getEntry`, `answerKeyOf`, `derivationOf`) expose target-private data and must not feed prompts.

For interpreting an **arbitrary spelling that need not be a target** (the real goal, an unseen
Bliss word), `kit.dataset.buildContextFromSpelling(spelling)` returns the same building blocks
from the spelling alone, plus an `exactMatch` flag (whether it is already a known word). It has
no "self" to seal, so it is an interpretation aid, **not** a benchmark scoring path.

## What we test: eligibility rules

An entry is an eligible target only if it **passes every** rule below.

### 1. Indicators are not targets  `#exclude-indicators`
- **Rule:** Entries flagged `isIndicator` are ineligible.
- **Why:** Indicators (tense, plural, part-of-speech markers, ...) are grammatical operators attached to other symbols, not standalone words to interpret.

### 2. Single Bliss characters are not targets  `#exclude-characters`
- **Rule:** Entries flagged `isChar` are ineligible.
- **Why:** A character (isChar) is an atomic glyph (its `code` is a shape, e.g. "VL6:0,8;DOT:0,16"). Interpreting it tests vocabulary recall, not the interpretation of composed meaning.

### 3. Only dictionary words are targets  `#require-word`
- **Rule:** Entries must be flagged `isWord`.
- **Why:** The task is "interpret this Bliss WORD". Entries the dictionary does not mark as a word are out of scope.

### 4. Spelling must be a B-code word  `#valid-bcode-spelling`
- **Rule:** The entry's `code` must parse as a B-code word spelling.
- **Why:** Only B-code word spellings (e.g. "B804/B401") have the character structure this benchmark is about. Shape/primitive codes are drawing instructions, not interpretable words.

### 5. At least two characters  `#min-two-characters`
- **Rule:** The parsed spelling must contain >= 2 characters.
- **Why:** A one-character word has no internal composition to interpret. A correct guess would measure recall, not interpretation, so single-character words are excluded.

### 6. Pure modifier words are not targets  `#exclude-full-modifier`
- **Rule:** The full spelling must NOT match a single modifier sequence (data/modifiers.json).
- **Why:** A word whose entire spelling is one modifier/operator sequence (e.g. "the", "not", "many") is structural vocabulary. Its meaning is the modifier itself, so it is not a composition to interpret.

### 7. Must have a scoreable answer  `#require-answer`
- **Rule:** The entry must yield at least one non-empty English answer.
- **Why:** With no English gloss there is nothing to score a guess against, so the entry cannot contribute a meaningful, comparable result.

### 8. Exclude non-preferred spellings  `#exclude-non-preferred`
- **Rule:** Entries flagged `isNonPreferred` are ineligible.
- **Why:** Non-preferred entries are deprecated or alternative spellings of a preferred symbol. Including them double-counts concepts and makes scores depend on which variant a pipeline happened to hit. (Discussable: toggle if you want them in.)

### Exclusions by rule (this snapshot)

**Primary reason** attributes each excluded entry to the *first* rule it fails (so the
column sums to total − eligible). **Fails rule** counts every entry that fails each rule
independently (these overlap, e.g. a character also lacks a B-code spelling).

| Rule | Primary reason | Fails rule (independent) |
| --- | ---: | ---: |
| `#exclude-indicators` | 40 | 40 |
| `#exclude-characters` | 1165 | 1205 |
| `#require-word` | 293 | 1490 |
| `#valid-bcode-spelling` | 188 | 1334 |
| `#min-two-characters` | 400 | 1814 |
| `#exclude-full-modifier` | 14 | 37 |
| `#require-answer` | 0 | 0 |
| `#exclude-non-preferred` | 134 | 167 |
| **eligible** | **4186** | |

## How we score

### Answer key

- **Comma-separated glosses are alternatives** `#comma-alternatives`: Split the gloss on "," ";" "|" into separate answers; matching any one scores.  
  *Why:* A gloss like "abuse, assault, violence" lists synonyms. Any one of them is a correct interpretation, so they are split into separate acceptable answers.
- **A bracketed tag is stripped to the bare head (mechanical rule)** `#disambiguator-strip`: For "X (Y)" accept the bare head "X" (cleaning any stray " - " separator); drop every tag. Word-internal hyphens ("brother-in-law") are preserved.  
  *Why:* Raw glosses glue a tag onto the head word ("abortion (induced)", "circle (shape)", "yuk - (exclamatory)"). The head is the real meaning, and the tag, a sense, domain, usage label, grammatical sub-sense, a numeric homograph index ("bassoon (1)/(2)" are two spellings of the SAME word), or a direction, is either not recoverable from the symbols or not an English spelling difference. A regex cannot tell a real adjective from a label, so the rule only ever drops to the head (and cleans a stray " - " separator); it never fronts a tag or keeps the "X (Y)" literal. Natural frontings come from the curated layer below.
- **Singular and plural both accepted for "(s)"** `#inflection-both-forms`: For "X(s)" / "X(es)" accept both the singular "X" and the plural "Xs" / "Xes".  
  *Why:* A "(s)" tag ("breast(s)", "chair(s)") marks an optional plural; both the singular and the plural are correct English answers.
- **Messy glosses get per-entry model judgement, frozen at authoring time** `#curated-aliases`: When a target has a curated entry, its model-judged spellings replace the mechanical expansion (clean gloss alternatives still kept); logged with source:"curated" + a rationale in data/answer-aliases.jsonl. Otherwise the mechanical rule applies (source:"rule").  
  *Why:* The mechanical rule is safe but blunt: it cannot decide when fronting a descriptor is natural English ("induced abortion", "dried apricot") versus nonsense ("shape circle"), nor read the more than 300 distinct disambiguator tags. So for every target a rule cannot safely handle (a tag outside numeric/inflection, a stray " - " separator, a "(ly)" suffix), a model read the gloss ONCE at authoring time and decided the clean accepted spellings. Those decisions are frozen in src/rules/answer-alias-curation.js and merged deterministically, the model never runs in the build, so answers.jsonl stays reproducible. A safety net unions back every fully-clean gloss alternative so a correct answer is never dropped.
- **British and American spellings both accepted** `#dialect-variants`: Add the other-dialect spelling of any answer token in the curated BrE<->AmE table.  
  *Why:* The dataset leans British ("behaviour", "centre"); a model spelling the American form should not be penalized. The mapping is a small curated table of the stems present, applied whole-word in both directions.

### Normalization (applied to answers AND candidates, in order)

1. **Case-insensitive** `#lowercase`: Lowercase the value.  
   *Why:* Capitalization is not part of the meaning; "Drive" and "drive" should match.
2. **Ignore punctuation** `#strip-punctuation`: Drop apostrophes, then replace every remaining character except a-z, 0-9, whitespace and hyphen with a space.  
   *Why:* Trailing periods, brackets, quotes etc. are noise ("drive." matches "drive"). An apostrophe joins a word rather than separating it, so it is dropped, not split: "let's" matches "lets" and "o'clock" matches "oclock", not two separate tokens.
3. **Collapse whitespace** `#collapse-whitespace`: Collapse runs of whitespace to a single space and trim.  
   *Why:* Spacing differences are not meaningful; "ice  cream" should match "ice cream".
4. **Verbs compared in "to ..." form** `#verb-infinitive`: If the target part-of-speech is action/verb, prefix non-empty values that do not already start with "to " with "to ".  
   *Why:* The dictionary glosses action words as infinitives ("to drive"). Requiring the same form on both sides keeps verb scoring consistent regardless of how a pipeline phrases it.

### Metrics reported

- **Top-1 accuracy** `#top1`: Fraction of targets whose rank-1 candidate matches any accepted answer.  
  *Why:* Did the single best guess match? The strictest, most legible headline number.
- **Top-5 accuracy** `#top5`: Fraction of targets with a matching answer in candidates 1..5.  
  *Why:* Did any of the five candidates match? Rewards a correct-but-not-first answer.
- **Mean Reciprocal Rank** `#mrr`: Mean of 1/rank (0 if no candidate in the first 5 matches).  
  *Why:* Rewards ranking the right answer higher; 1/rank averaged over all targets.

The scorer also reports a **per-part-of-speech (`byPos`) breakdown** (the eligible set
is pos-skewed, so an aggregate can mask per-pos performance) and stamps each summary
with provenance: `manifestSha256`, `setSeed`, `kitVersion`, `runner`, so two summaries
can be checked for comparability. A run is `official` only at `--set all` with full
coverage and no duplicate rows.

### Answer aliases (the spellings that should match)

A raw gloss often glues a disambiguator onto the head word, which would fail an obvious
correct guess. A mechanical rule strips a bracketed tag to the bare head (plus the other
plural/dialect spelling); for the messy tail a rule cannot read safely, a per-entry **model
judgement**, frozen at authoring time and merged deterministically (the model never runs in
the build), supplies the clean accepted spellings, including natural frontings like "induced
abortion". **Every change is logged, per target, in `data/answer-aliases.jsonl`** with a
`source: "rule" | "curated"` marker (and a rationale for curated rows), so the expansion is
fully auditable. See `docs/answer-alias-curation.md`.

- **876** of 4186 targets gain ≥1 accepted spelling, adding **1051** extra spellings in total; **721** of those targets were model-curated (the rest expanded by the mechanical rule).

| Target | Raw gloss | Also accepted |
| --- | --- | --- |
| `B1164` | abortion (induced) | abortion, induced abortion |
| `B3996` | bassoon (2) | bassoon |
| `B1280` | behaviour | behavior |
| `B1200` | marsupial (animal), pouched mammal | marsupial |
| `B1349` | brussels sprout(s) | brussels sprout, brussels sprouts |

## Test sets

Fixed, **nested** subsets (files in `data/sets/`; `node bin/score.js --list-sets`) let you
iterate cheaply, then run the full set for an official score. Built with seed `blissbench-v1`,
**stratified by part-of-speech AND word length** (2 / 3 / 4 / 5+ characters) so every prefix
mirrors both the pos mix and the length mix, and each smaller set is a prefix of the larger.

| Set | Targets | File | 95% CI* |
| --- | ---: | --- | ---: |
| `50` | 50 | `data/sets/set-50.jsonl` | ±13.9% |
| `100` | 100 | `data/sets/set-100.jsonl` | ±9.8% |
| `300` | 300 | `data/sets/set-300.jsonl` | ±5.7% |
| `1000` | 1000 | `data/sets/set-1000.jsonl` | ±3.1% |
| `all` | 4186 | `data/sets/set-all.jsonl` | 0 (census) |

*Rough worst-case 95% confidence half-width (≈0.98/√n) for an accuracy measured on a
PROPER SUBSET, which is a sample of the eligible population. A set of 50 is a smoke check
only; differences smaller than its CI are noise. Score over a set with
`node bin/score.js --submission <file> --set 300`. The **official** `--set all` score is a
census of every eligible target, not a sample, so it carries no sampling error: its CI is 0
and the number is exact for this snapshot (what can still be off is the snapshot and answer
key themselves, which a sampling CI does not measure).

## Modifier reference

Modifiers are detected as character sequences (no head-glyph detection). The set is
**kit-owned and curated** (`src/modifiers/bliss-modifiers.js`); its membership, tiers, and
conditional exceptions originate from the BCI-AV head-glyph exclusions in bliss-svg-builder
(MPL-2.0), referenced not vendored.

- 85 modifier sequences across 8 categories: Structural markers, Pragmatic lexical markers, Scalar degree operators, Identity-affecting operators, Concept-transforming operators, Relational operators, Determiners, Quantifiers.
- Each entry has `gloss`, the symbol's own **dictionary** gloss, as recorded (its standalone
  sense; data-driven from the snapshot, e.g. B368 "group of, much of, many of, quantity of",
  but a curated override in the source may drop prefix-only senses), and `asPrefix`, how it
  reads **when prefixing** what follows (a hand-curated list; e.g. B100 → "any").
- Conditional exceptions: B10 is not a modifier before B4.
- `tier` (head-selection priority) is internal to the matcher/eligibility and is **not**
  surfaced in `buildContext`.
- Known coverage gaps: `few (not yet in the head-glyph-exclusion source)`, not yet recognized as a modifier (missing in the upstream head-glyph-exclusion source).

## Indicator reference

Indicators are the grammatical diacritics on a Bliss character (tense, number, part of
speech, ...). Their meaning is taken from the kit's **curated** reference, NOT the BCI-AV
dictionary (which under-explains indicators and mis-marks some as non-preferred).
Source: `src/indicators/bliss-indicators.js: curated from the bliss-svg-builder "Indicators Reference". This is the AUTHORITATIVE source of indicator meaning for the kit (NOT the BCI-AV dictionary).`

- 41 indicators across 4 groups: Nominal, Verbal, Adjectival, Not planned for Unicode.
- Each carries `{ code, group, name, purpose }`; `buildContext().indicators` resolves the
  indicators present in a spelling to these.

## Submission format

Each pipeline emits JSONL rows matching `schemas/submission.schema.json`:

```json
{"targetId":"B1167","candidates":["abuse","violence","force","assault","harm"],"runner":"my-gpt-run","promptVersion":"v1"}
```
Score with: `node bin/score.js --submission <file>.jsonl --set <50|100|300|1000|all>`

**At most one row per target**: JSON Schema can't express cross-row uniqueness for
JSONL, so the scorer enforces it: duplicates keep the last row and make the run
non-official (a duplicated denominator would not be comparable). Up to 5 candidates are
scored; rows with no parseable candidates count as a miss and are flagged.

