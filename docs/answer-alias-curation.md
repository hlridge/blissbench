<!--
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at https://mozilla.org/MPL/2.0/.
-->
# Answer-alias curation: per-entry model judgement

> How the messy-gloss answer key is built, and how to regenerate it. Companion to
> `DECISIONS.md §15` (the *why*) and `CONTRACT.md` (the generated rulebook).

## The problem

A dictionary gloss often glues a disambiguator onto the head word: `abortion (induced)`,
`circle (shape)`, `yuk - (exclamatory)`, `apparent(ly)`, `Friday (day5)`. Taken literally
each becomes the *only* accepted answer, so an obvious correct guess fails. A pure regex
can clean the easy cases but garbles the tail: it kept a dangling separator (`yuk -`) and
fronted usage labels as if they were adjectives (`exclamatory yuk`, `shape circle`),
because a regex can't tell a real adjective (`induced`) from a label (`exclamatory`).

## The split: rule for the clean majority, model for the messy tail

`needsCuration(baseForms)` (in `src/rules/answer-aliases.js`) is the **single source of
truth** for which glosses a rule can safely handle:

| | count | handled by |
| --- | ---: | --- |
| clean glosses (no parens) | 3358 | mechanical rule (pass-through) |
| numeric `(1)/(2)` or inflection `(s)/(es)` only | 107 | mechanical rule |
| **everything else** (a tag outside that whitelist, a stray ` - `, a `(ly)` suffix, a multi-word tag) | **721** | **per-entry model judgement** |

The **mechanical rule** (`expandAnswerKey`) is deliberately blunt and safe: it strips every
`(...)` tag to the bare head, cleans a stray ` - ` separator (preserving real word-internal
hyphens like `brother-in-law`), adds the plural for `(s)/(es)`, and adds dialect variants.
It **never** fronts a tag or keeps an `X (Y)` literal.

The **curated layer** (`src/rules/answer-alias-curation.js`) holds a model's per-entry
decision for each of the 721 suspect targets, keyed by `targetId`. `getAnswerKey` prefers a
curated entry when present (a safety net still unions back every fully-clean gloss
alternative so a correct answer is never dropped), and falls back to the rule otherwise.

## Determinism (the hard rule)

The model runs **once, at authoring time**, never in the build path. Its decisions are
frozen in `answer-alias-curation.js` and merged deterministically by `getAnswerKey`, so
`data/answers.jsonl` stays a pure, reproducible function of *(snapshot + curation)*. This
mirrors the modifier/indicator curation (`DECISIONS §11`): curated source under `src/`,
merged at build, generated artifact under `data/`.

## The judging taxonomy

For a tag `X (Y)` the model classifies `Y` and acts:

- **sense / domain / topic** (`sport`, `shape`, `language`, `planet`, `medical`, `horse`, …)
  → bare head `X`. No fronting. (`circle (shape)` → `circle`)
- **usage / register** (`exclamatory`, `spoken`, `general`, `loud`, …) → drop, head `X`.
- **metadata / provenance** (`ckb`, `bci`, `etc`, `in combinations`, `day5`, …) → drop, head `X`.
- **grammatical sub-sense** (`feminine`, `question`, `plural`, `ordinal`, …) → drop, head `X`
  (gender/number isn't an English spelling difference).
- **numeric** `(1)/(2)/(3)` → drop, head `X` (two Bliss spellings of the same English word).
- **directional** (`forward`, `leftwards`, …) → drop, head `X`.
- **suffix** `(ly)` → the adverb, spelling fixed (`apparent(ly)` → `apparently`).
- **inflection** `(s)/(es)` → both singular and plural.
- **measurement / state / preparation** (`dried`, `minced`, `sliced`, `boiled`, …) → head,
  plus the natural fronted phrase when it reads naturally (`apricot (dried)` → `apricot`,
  `dried apricot`).
- **genuine adjective** (`induced`, `female`, …) → head + fronted phrase
  (`abortion (induced)` → `abortion`, `induced abortion`).

Verbs (`pos: action`) keep the `to …` infinitive and are never reordered. Every entry
records a one-line **rationale** (the tag kind judged + what was cleaned), carried into the
audit log.

## Regenerating

The curation was produced by a fan-out workflow (one agent per batch of glosses, each
applying the taxonomy above and writing structured judgements to disk), then assembled with
a deterministic validator that rejects any answer containing `(`, `)`, ` - `, a dangling
hyphen, or an empty token, and checks that every suspect target is covered exactly once. To
re-run after a snapshot swap:

1. Enumerate the suspect work-list (`needsCuration` over the eligible targets' glosses).
2. Fan out judgement (batched), apply the taxonomy, collect `{ targetId, answers, rationale }`.
3. Validate (deterministic junk scan + full coverage) and freeze into
   `src/rules/answer-alias-curation.js`.
4. `node bin/build-manifest.js`: it **warns** if any suspect target lacks a curated entry,
   so the curation can never be silently incomplete.

## Invariants (must hold after any regeneration)

- `data/targets.jsonl`, `data/sets/*`, and the snapshot `sha256` (`b54a1ec3…`) stay
  **byte-identical**: answer text is not part of the frozen set or the hash.
- Answers are **gloss-only** (`filename` is never an answer source; a guard test enforces it).
- Every accepted form is logged per target in `data/answer-aliases.jsonl` with a
  `source: "rule" | "curated"` marker (and the rationale for curated rows).
- `node --test` stays green.
