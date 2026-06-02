<!--
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at https://mozilla.org/MPL/2.0/.
-->
# blissbench: design decisions & rationale

A plain-English companion to [`CONTRACT.md`](../CONTRACT.md). `CONTRACT.md` is the
*generated rulebook* (every eligibility and scoring rule, emitted from the code so it
can't drift). **This** file explains the **why** behind the whole kit (the judgement
calls a generated file can't capture), so the design doesn't have to be re-explained by hand.

> One-line summary: **two things are frozen and shared (the eligible target set + the
> scorer); everything in between (model, prompt, language rules, how the context is laid
> out) is configurable per run.** Same questions, same ruler, different middle.

---

## 1. The shape: frozen ends, free middle

```
 ┌─ FROZEN (shared) ─────────┐   ┌─ FREE (configurable) ─┐   ┌─ FROZEN (shared) ──┐
 │ the eligible target set   │ ▶ │ the model, prompt,    │ ▶ │ the scorer          │
 │ + the query API           │   │ language rules,       │   │ top-1 / top-5 / MRR │
 └───────────────────────────┘   │ context layout, …     │   └─────────────────────┘
                                  └───────────────────────┘
```

**Why.** A benchmark is only comparable if both runs answer the *same questions* and are
graded by the *same ruler*. Freeze those two and nothing else, and the score difference
is attributable to the part we actually want to study: the pipeline (prompt + model +
how the available evidence is presented). Freezing more than that would smuggle one
run's prompt-design opinions into the "comparable" core; freezing less would make scores
incomparable.

## 2. Information sealing: the target's own entry is off-bounds

The task is *interpret this Bliss word from its parts*. Anything in the **target's own**
dictionary entry (gloss, explanation, part-of-speech, `derivationParts`, filename) is a
direct tell, so the kit never exposes it when building context.

`kit.dataset.buildContext(targetId)` is the **blessed, leak-free** path. It returns only:
spelling-derived facts, curated modifier/indicator meanings, subword helpers, and
siblings (all defined below). The raw accessors `getEntry` / `answerKeyOf` /
`derivationOf` exist for inspection and scoring but must **never** feed a prompt.

**Why a "blessed path" rather than trust?** It removes a whole class of accidental
leakage and makes "is this a clean, comparable run?" answerable by "did you build from
`buildContext()`?", instead of an honour-system audit of each prompt.

## 3. The answer key is not a secret: integrity comes from discipline

The bundled dictionary contains every word's gloss, so in principle anyone could look up
any target's answer. That's unavoidable: the dictionary is the shared reference, and not an
infallible one (it has errors, internal inconsistencies, and uneven coverage). So integrity
comes from **discipline, not concealment**: build from `buildContext()`
and don't look up the target's own gloss. This is an honest comparison of pipelines,
not a locked-down exam. (Sealing the target entry in the API is what makes that
discipline easy to keep.)

## 4. What counts as an eligible target (the 8 rules)

Full text + per-rule exclusion counts are in `CONTRACT.md`. The intent behind them:

- **Test interpretation, not recall.** Single characters (`min-two-characters`,
  `exclude-characters`) and bare indicators (`exclude-indicators`) have no internal
  composition: guessing them measures vocabulary memory, not interpretation.
- **Test *words*.** `require-word` + `valid-bcode-spelling` keep us to dictionary words
  with real B-code spellings (not shape/primitive drawing codes).
- **Test compositions, not structural vocabulary.** `exclude-full-modifier` drops words
  whose *entire* spelling is one operator sequence ("the", "not", "many"): their meaning
  *is* the operator, so there is nothing to compose.
- **Be scoreable.** `require-answer` drops entries with no English gloss to grade against.
- **Don't double-count concepts.** `exclude-non-preferred` (see §5).

Result on the pinned snapshot: **4186 eligible targets of 6420 entries.**

## 5. Non-preferred entries are excluded: as targets *and* as helpers

Non-preferred entries are deprecated/alternative spellings of a preferred symbol.
Including them as **targets** would double-count concepts and make a score depend on
which spelling variant a pipeline happened to hit. Excluding them as **helpers** too
(the lookup index skips them) keeps the evidence consistent.

**Status: discussable.** It's a single rule; flip it if a round wants variants in. It is
on by default because comparability matters more than coverage here.

## 6. Helper/sibling answer leakage is *fair game*: it's the task

A contiguous subword (or a same-glyph sibling) that is *another* dictionary entry can
have a gloss that is a synonym of the whole target. We measured this on the full set:

- **64 of 4186 targets (1.5%)** have a subword helper whose gloss, under the scorer's
  exact normalization, equals an accepted answer. **All 64 are content glyphs; none leak
  through a modifier or indicator.**
- The pattern is *compositional*, not cheating: e.g. *female genitals* = `B349 genitals`
  + a female marker; *medicine* = … + `B958 medicine`; and morphological families like
  *murder* / *to murder* / *murderer* share a root span.

**Decision: leave it as-is, no diagnostic flag, no exclusion.** Reading a subword and
synthesising the right meaning from it *is* the interpretation skill we want to reward.
A pipeline *should* exploit a morphological family. The only thing sealed is the target's
**own** entry; evidence from *other* entries is allowed and symmetric (every run sees the
same helpers). 1.5% is small, mostly legitimate, and excluding it would bake a
contestable "what counts as a synonym" judgement into eligibility for little gain.

## 7. Subword & sibling matching is indicator-agnostic

Indicators are grammatical diacritics (`;B97` concrete, `;B6436` abstract, `;;B81`
action, `;;B86` description, …). The original matcher compared *exact* spellings, which
silently dropped a whole class of useful evidence: a fragment never matched an entry that
carried a different indicator (so the verb form `to kill, to murder` was invisible when
the target was a noun, and vice-versa).

**Decision: match on the *base character sequence*, ignoring all indicators**: both
sense markers (`B97`/`B6436`) and word-level grammatical indicators. Two consequences,
both intended:

- **`subwordsOf`** (proper sub-spans) now surfaces grammatical and sense variants of a
  fragment. Measured effect: **+2487 helper matches across the set; 3691 of 4186 targets
  gain at least one helper.** The sense/role isn't lost, it's reported separately in
  `indicators`.
- **`siblings`** (new): entries whose *entire* base sequence equals the target's,
  differing only by indicator (target *to murder* `B206/B259/B532;;B81` ↔ sibling
  *murder* `B206/B259/B532`; or concrete ↔ abstract). These are presented as a **separate
  `siblings` field**, not folded into `subwords`, because a same-length variant isn't a
  "sub-word", and a prompt-builder may legitimately want to weight "same glyphs,
  different grammar" differently from "a fragment of the word".

Two lookups make this explicit: `findBySpelling` stays an **exact** match;
`findByBaseSpelling` is the **agnostic** one.

*(This is presentation only: it does not change eligibility, the 4186-target set, or the
snapshot hash.)*

## 8. Curated modifier & indicator references: a higher-quality knowledge source

Modifiers and indicators are two small, closed sets of grammatically-significant tokens
that are *crucial* to reading a composed word. The kit treats them as a **curated
knowledge source**, deliberately better than what BCI-AV provides.

- **Kit-owned set; dictionary gloss + prefix readings.** The modifier set lives in
  `src/modifiers/bliss-modifiers.js`; its membership, tiers, and conditional exceptions
  originate from the BCI-AV head-glyph exclusions in bliss-svg-builder (referenced, not
  vendored; see §11 and NOTICE). Each entry exposes two readings: **`gloss`**, the symbol's
  OWN dictionary meaning, taken straight from the snapshot like any other entry (data-driven,
  not invented; e.g. B368 → "group of, much of, many of, quantity of"). A source entry may set
  `gloss` to override that default, e.g. to drop a prefix-only sense ("opposite of", "part of")
  from the standalone meaning. The other reading is **`asPrefix`**, how it reads when prefixing
  what follows ("[group of][houses] = village"; "[any][one] = anyone"), a hand-curated list in
  the source (these glyphs' grammatical roles vary, see `category`, but they all act as
  prefixes). Both live in `src/modifiers/bliss-modifiers.js`; edit there and regenerate.
- **Cleaned for prompting.** The head-selection `tier` (e.g. "absolute-never-head") is
  internal and **not** surfaced: it's irrelevant in a head-free benchmark and would be
  noise. (By *head* we mean the glyph that would carry the grammatical indicators and anchor
  the meaning, close to the *classifier* in Bliss terms; this kit is **head-free**, it never
  tries to pick that single glyph, and instead uses leading and trailing runs of glyphs as
  evidence.) Bliss-internal mnemonics ("many/much x2 (ocean, town)") are dropped; meaningful
  disambiguators ("out of (forward)") are kept.
- **Indicators come from us, not BCI-AV.** BCI-AV under-explains indicators (gloss
  "indicator (action)") and even **mis-marks** several as non-preferred. The kit's
  `src/indicators/bliss-indicators.js` (transcribed from the bliss-svg-builder Indicators
  Reference: 41 indicators across Nominal / Verbal / Adjectival / Not-planned-for-Unicode)
  is the authoritative source. The build cross-checks against the snapshot and reports
  what it overrides (9 mis-marked non-preferred, 1 not flagged as an indicator at all).
- **In practice only 6 indicators appear** in eligible targets (B81 action, B86
  description, B97 thing, B99 plural, B84/B85 description before/after the fact), high
  frequency, tiny surface. The other 35 are curated for completeness and future snapshots.

## 9. Scoring: how a guess is graded

Detail in `CONTRACT.md`; the reasoning:

- **Comma/semicolon/pipe-separated glosses are *alternatives*.** "abuse, assault,
  violence" lists synonyms; matching any one is correct.
- **Bracketed disambiguators don't have to be guessed** (the head word, plural, reordered,
  and dialect spellings are all accepted); see §15, logged per target in
  `data/answer-aliases.jsonl`.
- **Normalization is applied identically to answers and candidates** (lowercase,
  strip punctuation to spaces, collapse whitespace) so the comparison is
  apples-to-apples and not tripped up by formatting.
- **Verbs are compared in `to …` form.** The dictionary glosses action words as infinitives;
  normalising both sides to `to drive` keeps verb scoring consistent however a pipeline
  phrases it.
- **Three metrics:** top-1 (strict headline), top-5 (rewards a correct-but-not-first
  guess), MRR (rewards ranking the right answer higher). Five candidates per target.
- **One row per target, enforced by the scorer.** JSON Schema can't express cross-row
  uniqueness for JSONL, so duplicate `targetId` rows (from appends/retries) would silently
  inflate the denominator and make the score non-comparable. The scorer keeps the last row,
  flags the duplicates, and refuses to call the run `official`.
- **Provenance + per-pos breakdown.** Each summary is stamped with `manifestSha256`,
  `setSeed`, `kitVersion`, and `runner`, so "are two runs comparable?" is answerable by
  diffing summaries. A `byPos` breakdown is reported alongside the aggregate because the set
  is noun-heavy and an aggregate can mask per-part-of-speech performance.
- **A deterministic, no-AI baseline** (`examples/baseline.example.js`, `npm run baseline`)
  guesses straight from helper/sibling glosses, a floor that confirms the whole
  kit→context→submission→scorer loop works without an API key. `bin/show-context.js` prints
  one target's `buildContext` for eyeballing.

## 10. Test sets: iterate cheap, score official

Fixed **nested** subsets (50 ⊂ 100 ⊂ 300 ⊂ 1000 ⊂ all), built with seed `blissbench-v1`
and **stratified by part-of-speech** so even the 50-set broadly mirrors the dominant mix (the
rarest pos classes appear only in the larger sets). Same seed →
every run gets identical sets. Iterate on a small set; an **official** score is
`--set all` with full coverage (the scorer says so explicitly). CIs are listed so you
don't over-read sub-CI differences as signal.

## 11. How the data is built (and a hard rule)

**Never hand-edit the snapshot or any generated `data/*.json`.** All curation lives in
hand-authored **source** files under `src/`; build scripts merge them into the frozen
`data/` artifacts:

| Source (edit this) | Build script | Output (generated) |
| --- | --- | --- |
| `src/indicators/bliss-indicators.js` | `bin/build-indicators.js` | `data/indicators.json` |
| `src/modifiers/bliss-modifiers.js` | `bin/build-modifiers.js` | `data/modifiers.json` |
| `src/rules/answer-alias-curation.js` (frozen model judgement) + `src/rules/*` + the snapshot | `bin/build-manifest.js` | `targets`, `answers`, `answer-aliases`, `sets/*`, `manifest`, `CONTRACT.md` |

To change anything, edit a source file and regenerate (`npm run build`). This is what
keeps `CONTRACT.md` honest and the artifacts reproducible.

## 12. Swapping the snapshot

Drop a newer Blissary dictionary export (same shape) into `data/`, point `loadKit`/scripts at it,
and re-run the builds. You get a new frozen set with a new `sha256`; agree on which snapshot a
round uses. All runs must share the same hash **and** seed for scores to compare.

## 13. Neighbours: the third match group (shared-affix words)

`subwords` are contiguous *fragments* of the target; `siblings` share its *entire*
base sequence (differing only by indicators). Neither captures a large, useful class
of evidence: other words built on the **same leading glyph(s)** (the leading run often, but
not always, carries the head/classifier), or sharing a **trailing run**. Those are
**neighbours**: the third group.

- **Shared-start**: another preferred entry that shares a leading run with the target
  then diverges or extends, with a short non-shared tail (≤ 3 glyphs).
- **Shared-end**: shares a trailing run with the target but leads with a different,
  short head (≤ 2 glyphs).

Matching is **indicator-agnostic** (base sequences), like subwords/siblings, and the
three groups are kept **disjoint**: any entry whose base is a contiguous span of the
target (a subword) or equals it (a sibling) is excluded from neighbours. The same
fair-game leak policy applies (§3, §6): neighbours are *other* preferred entries; the
target's own entry stays sealed.

**Why bounded and ranked, not exhaustive.** A single shared classifier glyph can be
shared by hundreds of words (on the pinned snapshot 96% of targets have a shared-start
neighbour; some have 100+). So each neighbour is tagged with how many glyphs it shares
and ordered **longest-shared-first**: the deep overlaps are the signal (*murder* →
*murderer*; *service* → *ritual*, *religious service*), the single-glyph tail is weak.
`neighboursOf` returns the full ranked set; `buildContext` keeps the top few per group
with an `omitted` count, so the truncation is explicit, never silent.

**Why this matters for the real goal.** For a spelling **not in the dictionary**,
subwords and siblings can be thin or absent, but neighbours show how the same building
blocks are used in *known* words, the closest thing to compositional priors the kit can
offer for interpreting an unseen word. Coverage is uneven, though: a subject the dictionary
covers thinly yields few or no subwords/siblings/neighbours, so some spellings simply have
little evidence to compose from, a limit of the data, not the method. *(Presentation only:
neighbours don't change eligibility, the target set, or the snapshot hash.)*

## 14. Arbitrary spellings: interpreting words not in the dictionary

The benchmark scores *known* words, but the real goal is interpreting a spelling that may
**not exist in the dictionary at all**. `buildContextFromSpelling(spelling)` builds the same blocks
(modifiers / indicators / subwords / siblings / neighbours) from the spelling alone, so an
unseen word gets the same compositional evidence a target does. Two deliberate differences
from `buildContext(targetId)`:

- **No "self" to seal.** A target's own entry is hidden because it is the answer key. A raw
  spelling has no hidden answer, so nothing is sealed: if the spelling happens to be a known
  word, it legitimately appears (in `siblings` / `exactMatch`).
- **`exactMatch`.** The result flags whether the exact spelling is already a known word, so a
  consumer can short-circuit: an exact match means *give the answer, no guessing*; an empty
  `exactMatch` means *this is a genuine interpretation from parts*. It is the one field
  `buildContext` must never expose: for a target, the exact match **is** the target (the answer).

Kept a separate method on purpose: the benchmark path stays sealed, and the interpretation
path stays honest about whether it is looking a word up or inferring it. *(Presentation only:
no effect on eligibility, the target set, or the snapshot hash.)*

## 15. Answer aliases: a plain correct guess shouldn't fail on a bracketed tag

Dictionary glosses often glue a disambiguator onto the head word: `abortion (induced)`,
`bassoon (2)`, `breast(s)`, `into (leftwards)`. Taken literally, each becomes the *only*
accepted answer, so the obvious correct guess ("abortion", "bassoon", "breast", "into") is
scored wrong. On the eligible set this hit **1160 of 4186 targets**.

**Decision: expand the answer key into the spellings a human would accept**, source-side in
`getAnswers` (so `scoreRow` stays a simple set membership test), in **two layers**: a blunt-but-
safe mechanical rule for the clean majority, and per-entry **model judgement** for the messy tail.

- **The mechanical rule** (`src/rules/answer-aliases.js`) handles glosses a regex can read safely:
  it strips every bracketed tag to the bare head (cleaning a stray ` - ` separator, preserving a
  word-internal hyphen like `brother-in-law`), adds the plural for `(s)/(es)`, and adds dialect
  variants. It deliberately **never fronts a tag** (`induced abortion`) or keeps the `X (Y)`
  literal: a regex can't tell a real adjective from a usage label, and the earlier version that
  tried produced junk: a dangling `yuk -`, a fronted usage label `exclamatory yuk`, a nonsense
  `shape circle`. Dropping to the head is always safe.
- **The curated layer** (`src/rules/answer-alias-curation.js`) covers every gloss the rule cannot
  safely read (a tag outside the numeric/inflection whitelist, a stray separator, a `(ly)` suffix,
  a multi-word or comma-bearing tag): **721 of the 4186 targets**. A model read each one *once, at
  authoring time*, and decided the clean accepted spellings: dropping sense/domain/usage/
  grammatical/metadata tags to the bare head, attaching `(ly)` as an adverb, and fronting **only**
  genuine adjectives (`induced abortion`, `dried apricot`, `female sex organs`). Each decision
  carries a one-line rationale. `getAnswerKey` prefers a curated entry when present; a safety net
  still unions back every fully-clean gloss alternative, so a correct answer is never dropped.
- **`(s)` accepts both** singular and plural; a **numeric `(1)/(2)`** or **directional** tag drops
  to the head (unrecoverable from the symbols).
- **Dialect:** a curated BrE↔AmE table (the stems present in the snapshot) accepts the other
  spelling, so a US-spelling guess isn't penalized on a British-leaning dataset.

**The answer comes from the gloss only, not the filename.** Each entry also carries a
`filename` (the symbol's image-file slug, e.g. `approve-(to)`, `abortion_(induced)`). It was
once unioned into the answer set as a fallback, but a check found it contributes **zero**
genuine spellings the gloss lacks and only naming-convention artifacts (a `-(to)` verb marker
on 417 of 420 verbs, underscores, `(OLD)` tags). So `filename` is **dropped at ingestion** and
is never an answer source; a guard test keeps it that way. Verbs still match a bare guess
because the `verb-infinitive` rule prefixes `to ` to both sides (`"approve"` → `"to approve"`),
so the filename's redundant `"approve"` form is not needed.

**Determinism: the model runs at authoring time, never in the build.** The curated decisions are
frozen in a committed source file and merged deterministically by `getAnswerKey`, so `answers.jsonl`
stays a pure, reproducible function of *(snapshot + curation)*, exactly like the modifier/indicator
curation (§11). It only *widens/cleans* what the gloss already accepts, so it can't make a
previously-correct answer wrong, and it leaves the eligibility rules, the 4186-target set, and the
snapshot `sha256` (`b54a1ec3…`) untouched: only the regenerated `answers.jsonl` moves. **Every
accepted form is logged per target in `data/answer-aliases.jsonl`** with a `source: "rule" |
"curated"` marker (and the rationale for curated rows), so the expansion is fully auditable rather
than hidden in the scorer. The authoring/regeneration recipe is `docs/answer-alias-curation.md`, and
a build-time coverage guard fails loudly if any suspect target lacks a curated entry, so the
curation can never be silently incomplete.

**Caveat (it's a matching-contract change).** Unlike the presentation-only features above, this
shifts scores, so runs are only comparable if they share it (it's part of the scoring contract,
not the snapshot hash). Settle it before comparing rounds, which is why it was decided
deliberately and frozen here.

---

### Open / revisitable

- **`exclude-non-preferred`** default-on (§5): toggle per round if wanted.
- **`few` quantifier**: missing upstream in the head-glyph-exclusion source; will be
  added when it lands there.
- **Curation content** is editable by design: the glosses/explanations are a starting
  point, not frozen prose.

> Out of scope for this kit: *how* a run turns `buildContext` into a prompt and presents it
> to a model. That's the free middle: the part each run varies.
