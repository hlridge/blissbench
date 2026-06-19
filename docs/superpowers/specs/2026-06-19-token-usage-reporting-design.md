# Token Usage Reporting

Track input/output/total token counts per record across runners, surface averages in scorer output.

## Data Shape

Every runner emits an optional `tokens` field per JSONL row:

```json
{
  "targetId": "B1234",
  "rawResponseText": "...",
  "candidates": ["..."],
  "runner": "...",
  "promptVersion": "...",
  "tokens": { "input": 512, "output": 87, "total": 599 }
}
```

All three sub-fields are integers. The field is optional — older submission files without it are handled gracefully.

## Runner Changes

### test_slm.py (HuggingFace)

- `generate_response()` returns a tuple `(response_text, token_counts)` instead of just a string.
  - `input`: `inputs["input_ids"].shape[-1]` (already computed as `input_len`)
  - `output`: `outputs[0].shape[-1] - input_len`
  - `total`: `input + output`
- Output JSONL row includes `"tokens": {"input": N, "output": N, "total": N}`.
- Per-record stderr line updated: `[count] targetId: candidates (N tokens)`.
- End-of-run summary prints total and average token counts.

### test_ollama.js (Ollama)

- Ollama chat response provides `prompt_eval_count` (input) and `eval_count` (output).
- Output JSONL row includes `"tokens": {"input": N, "output": N, "total": N}`.
- Per-record stderr line updated: `[count] targetId: candidates (N tokens)`.
- End-of-run summary prints total and average token counts.

## Scorer Changes

### src/report.js — createReport()

- After building the `scored` array, iterate over submission rows (from `byId`) that are in the universe and have a valid `tokens` object.
- Accumulate sums for input/output/total token counts. Track how many rows contributed.
- Add to `summary`:

```json
"tokens": {
  "avgInput": 512.3,
  "avgOutput": 87.1,
  "avgTotal": 599.4,
  "totalInput": 512300,
  "totalOutput": 87100,
  "totalTotal": 599400,
  "rowsWithTokenData": 1000
}
```

- When no rows have token data, `summary.tokens` is `null`.

### src/report.js — formatReport()

- When `summary.tokens` is not null, append one line:

```
  tokens  avg input=512  output=87  total=599  (from 1000 rows)
```

- Average values rounded to nearest integer for display.

### bin/score.js

No changes. Already passes summary to `formatReport()`.

## What Stays Untouched

- `scoreRow()`, `summarizeScores()` in scoring-rules.js — tokens are informational metadata, not scoring input.
- `scored` array row shape — token data lives in summary aggregates only, not per-scored-row.
- Existing tests — backward compatible since `tokens` field is optional.
- Frozen data artifacts in `data/` — no changes.

## Files Modified

| File | Change |
|------|--------|
| `test_models/test_slm.py` | `generate_response()` returns token counts; output row includes `tokens`; stderr updated |
| `test_models/test_ollama.js` | Read token counts from Ollama response; output row includes `tokens`; stderr updated |
| `src/report.js` | `createReport()` aggregates token stats; `formatReport()` displays them |
