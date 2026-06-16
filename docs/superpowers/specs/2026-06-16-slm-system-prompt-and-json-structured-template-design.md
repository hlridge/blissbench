# Design: SLM System Prompt Decoupling + json_structured Template

**Date:** 2026-06-16

## Problem

Two issues in `test_models/`:

1. `test_slm.py` and `test_ollama.js` use a hard-coded system prompt that cannot vary per template. There is no mechanism for a template to declare its own system prompt.

2. No template exists for the structured JSON prompt format needed to test Blissymbolics interpretation with rich contextual hints.

## Solution Overview

### Issue 1 — Per-template system prompt

Add an optional `systemPrompt` field to the template object in `prompt-templates.js`. When present, `gen-prompts.js` writes it as a metadata line at the top of the JSONL output. Runners detect and consume this line before inference.

### Issue 2 — `json_structured` template

Add a new template that builds a rich JSON user prompt and carries the Blissymbolics interpretation system prompt.

---

## Design Detail

### Template shape (prompt-templates.js)

```js
{
  name: "json_structured",           // → prompts/json_structured.jsonl
  systemPrompt: "You interpret...",  // optional; omit for existing templates
  build: (context) => { ... }        // returns user prompt string
}
```

`systemPrompt` is optional. Existing templates (`simple`, `narrative`) omit it and runners fall back to the current hard-coded default.

### Generated JSONL format (gen-prompts.js)

When a template has `systemPrompt`, line 0 of the JSONL is a metadata object:

```jsonl
{"_meta":true,"systemPrompt":"You interpret one Blissymbolics word..."}
{"targetId":"B1164","prompt":"{\"inputIds\":[...], ...}"}
{"targetId":"B1165","prompt":"..."}
```

Templates without `systemPrompt` produce JSONL with no metadata line (unchanged from current behavior).

### Runner changes (test_slm.py and test_ollama.js)

Both runners:
1. Read the first line of the prompt JSONL.
2. If `_meta: true` → extract `systemPrompt`, advance to next line for inference.
3. Otherwise use existing hard-coded fallback: `"You are a helpful assistant for solving linguistic puzzles."`

The extracted `systemPrompt` is passed into every chat call for that file, replacing the hard-coded value.

### json_structured template — build function

The `build(context)` function returns a JSON string (the user message) with this shape:

```json
{
  "inputIds": [17717, 12374, 13366, 24895, 8993],
  "indicatorEffects": [
    {"id": "8993", "gloss": "indicator (action)"}
  ],
  "annotations": [
    {
      "id": "17717",
      "gloss": "thing,object",
      "explanation": "(symbol suggests the two dimensional outline of a crystal) - Character"
    }
  ],
  "subwordMatches": [
    {
      "subSequence": [17717, 12374, 13366],
      "matchedGloss": "accessory",
      "matchedExplanation": "(thing + plus + clothing: something added to one's clothing)"
    }
  ]
}
```

Followed by a trailing instruction line:

```
Return JSON array of candidate interpretations.
```

#### Field derivation rules

| Field | Source in `context` |
|---|---|
| `inputIds` | Parse `context.spelling`: strip `"B"` prefix, split on `/` `;` `;;` → `number[]` (includes indicator codes) |
| `indicatorEffects[].id` | `context.indicators[].spelling` with `"B"` stripped (string) |
| `indicatorEffects[].gloss` | `context.indicators[].purpose` |
| `annotations` | For each base-character code (inputIds minus indicator codes): find in `context.subwords` where the subword `spelling` matches the single character; use `helpers[0].gloss` and `helpers[0].explanation`. Skip if no match found. |
| `subwordMatches` | From `context.subwords` where span has more than one character; `subSequence` = numeric codes of that spelling; `matchedGloss` / `matchedExplanation` from `helpers[0]` |
| `modifierEffects` | Only included when `context.modifiers.length > 1`; each modifier → `{id: codes[0] stripped, gloss}` — same structure as `indicatorEffects` |

#### System prompt (verbatim from spec)

```
You interpret one Blissymbolics word into ranked natural-language candidates.

Input is a single Bliss word as a flat array of BCI-AV symbol IDs. The word may flatten multiple sub-words;
you must decide sub-word boundaries using the structured hints provided.

Bliss structural rule for a word including sub-words and the word at the top level:
  (0+ modifiers) + (1 classifier) + (0 or 1 indicator) + (0+ specifiers / modifiers)

Composition patterns:

- Classifier + specifier produces a hyponym of the classifier. Example: citrus_fruit/small -> clementine.
- A modifier transforms the classifier. Example: opposite_of/hot -> cold.

Role rules by position:

- Some symbols can act as either a modifier or a specifier. Example:
meat/part -> diced meat; part/year -> season

Use the provided context fields:

- "annotations" gives gloss, explanation, and (when relevant) role semantics per ID, in the same order
  as "inputIds". Derive first / last position from the array index when needed. "modifier.roleAmbiguous=true"
  means you must pick the role from context.
- "indicatorEffects" is the merged grammatical effect (POS, tense, etc.) that applies at the WHOLE-WORD
  level.
- "subwordMatches" lists contiguous ID slices that match a known dictionary symbol (indicators already
  stripped). Use as hints for sub-word boundaries; multiple overlapping matches may appear - pick the most
  plausible decomposition.

Translate the final interpretation into: English.

Return ONLY a JSON array of 5 candidate words or phrases, best-first. No prose, no commentary.
```

---

## Files Changed

| File | Change |
|---|---|
| `test_models/prompt-templates.js` | Add `json_structured` template with `systemPrompt` and `build` |
| `test_models/gen-prompts.js` | Write `_meta` line when template has `systemPrompt` |
| `test_models/test_ollama.js` | Read `_meta` line; use dynamic system prompt or fallback |
| `test_models/test_slm.py` | Same as above |
| `docs/test-slms.md` | Document `systemPrompt` template field, `_meta` JSONL format, new template |

## Out of Scope

- No changes to `src/`, `data/`, `bin/`, or scoring logic.
- No changes to `simple` or `narrative` templates or their existing prompt files.
- Tests: only `.js` and `.py` files in `test_models/` are tested.
