# SLM System Prompt Decoupling + json_structured Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow each prompt template to declare its own system prompt (stored once as a `_meta` line in the generated JSONL), update both runners to use it, and add a `json_structured` template that builds a rich structured-JSON user prompt for Blissymbolics interpretation.

**Architecture:** `prompt-templates.js` gains an optional `systemPrompt` field per template. `gen-prompts.js` emits a `{"_meta":true,"systemPrompt":"..."}` header line when the field is present. Both runners (`test_ollama.js` and `test_slm.py`) detect this header and use the extracted system prompt; templates without the field fall back to the existing hard-coded default.

**Tech Stack:** Node.js ESM (test_models JS files), Python 3 (test_slm.py), `node:test` for JS tests, plain `assert` for Python tests.

---

## Baseline notes

- `node --test` currently has 5 failing tests: 3 in `gen-prompts.test.js` caused by a stray `break` in `buildPromptRows`, 2 unrelated (`buildContextFromSpelling` / caps). We fix the 3; we do not touch the 2.
- Python tests in `tests/test_run_slm.py` cannot run because `test_slm.py` imports `transformers` at module level. Task 3 moves those imports inside `load_model()` so the module is importable without the library.

---

## File map

| File | Action | What changes |
|---|---|---|
| `test_models/gen-prompts.js` | Modify | Fix `break` + dead code; export `buildFileContent`; call it in `main()` |
| `test_models/test_ollama.js` | Modify | Export `readSystemPrompt`; use it in `main()` |
| `test_models/test_slm.py` | Modify | Move transformers imports inside `load_model`; add `read_system_prompt`; pass it through `generate_response` and `main()` |
| `test_models/prompt-templates.js` | Modify | Add `json_structured` template |
| `tests/gen-prompts.test.js` | Modify | Add `buildFileContent` tests |
| `tests/test_ollama.test.js` | Modify | Add `readSystemPrompt` tests |
| `tests/test_run_slm.py` | Modify | Add `read_system_prompt` tests; import it |
| `tests/prompt-templates.test.js` | Create | Tests for `json_structured` build function |
| `docs/test-slms.md` | Modify | Document new template field, JSONL format, and template |

---

## Task 1: Fix `buildPromptRows` and export `buildFileContent` in gen-prompts.js

**Files:**
- Modify: `test_models/gen-prompts.js`
- Modify: `tests/gen-prompts.test.js`

- [ ] **Step 1: Write failing tests for `buildFileContent`**

Add at the bottom of `tests/gen-prompts.test.js` (after the existing 4 tests):

```js
import { buildPromptRows, buildFileContent } from '../test_models/gen-prompts.js';

// ... (existing tests unchanged) ...

test('buildFileContent: no systemPrompt produces plain JSONL', () => {
  const rows = [{ targetId: 'B1', prompt: 'hello' }];
  const result = buildFileContent(rows);
  assert.equal(result, '{"targetId":"B1","prompt":"hello"}\n');
});

test('buildFileContent: with systemPrompt adds _meta line first', () => {
  const rows = [{ targetId: 'B1', prompt: 'hello' }];
  const result = buildFileContent(rows, 'My system prompt');
  const lines = result.trim().split('\n');
  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[0]), { _meta: true, systemPrompt: 'My system prompt' });
  assert.deepEqual(JSON.parse(lines[1]), { targetId: 'B1', prompt: 'hello' });
});

test('buildFileContent: empty systemPrompt is falsy, no _meta line', () => {
  const rows = [{ targetId: 'B1', prompt: 'hello' }];
  const result = buildFileContent(rows, '');
  assert.equal(result, '{"targetId":"B1","prompt":"hello"}\n');
});
```

- [ ] **Step 2: Run new tests to confirm they fail**

```bash
node --test tests/gen-prompts.test.js
```

Expected: `buildFileContent` tests fail with "buildFileContent is not a function" (or similar). The existing 3 `buildPromptRows` tests also still fail because of the `break`.

- [ ] **Step 3: Fix `buildPromptRows` and add `buildFileContent` in gen-prompts.js**

Replace the entire `buildPromptRows` function and add `buildFileContent`. Also fix `main()` to use `buildFileContent`.

The current `buildPromptRows` (lines 37–62) has a stray `break` and dead code after it. Replace the full function and update `main()`:

```js
/**
 * Core logic — pure, no file I/O, testable.
 * @param {Array<{name: string, build: (ctx) => string}>} templates
 * @param {Array<{targetId: string}>} targets
 * @param {{ buildContext: (id: string) => object }} dataset
 * @returns {Map<string, Array<{targetId: string, prompt: string}>>}
 */
export function buildPromptRows(templates, targets, dataset) {
  const result = new Map();
  for (const tmpl of templates) {
    const rows = [];
    for (const target of targets) {
      const context = dataset.buildContext(target.targetId);
      rows.push({ targetId: target.targetId, prompt: tmpl.build(context) });
    }
    result.set(tmpl.name, rows);
  }
  return result;
}

/**
 * Serialise rows to JSONL, prepending a _meta line when systemPrompt is provided.
 * @param {Array<{targetId: string, prompt: string}>} rows
 * @param {string} [systemPrompt]
 * @returns {string}
 */
export function buildFileContent(rows, systemPrompt) {
  const lines = [];
  if (systemPrompt) {
    lines.push(JSON.stringify({ _meta: true, systemPrompt }));
  }
  for (const row of rows) {
    lines.push(JSON.stringify(row));
  }
  return lines.join('\n') + '\n';
}
```

Also update `main()` — replace the file-writing loop (currently lines 85–88):

```js
  mkdirSync(outputDir, { recursive: true });
  for (const [name, rows] of promptMap) {
    const tmpl = templates.find(t => t.name === name);
    const outPath = resolve(outputDir, `${name}.jsonl`);
    writeFileSync(outPath, buildFileContent(rows, tmpl?.systemPrompt), "utf8");
    process.stderr.write(`Wrote ${rows.length} rows → ${outPath}\n`);
  }
```

- [ ] **Step 4: Run tests to confirm all gen-prompts tests pass**

```bash
node --test tests/gen-prompts.test.js
```

Expected: all 7 tests pass (the original 4 now pass since `break` is gone, plus the 3 new ones).

- [ ] **Step 5: Commit**

```bash
git add test_models/gen-prompts.js tests/gen-prompts.test.js
git commit -m "feat: export buildFileContent from gen-prompts, fix buildPromptRows break"
```

---

## Task 2: Export `readSystemPrompt` from test_ollama.js and use in `main()`

**Files:**
- Modify: `test_models/test_ollama.js`
- Modify: `tests/test_ollama.test.js`

- [ ] **Step 1: Write failing tests for `readSystemPrompt`**

Add to `tests/test_ollama.test.js` (after the existing imports and tests):

```js
import { extractCandidates, readSystemPrompt } from '../test_models/test_ollama.js';

// ... existing tests unchanged ...

const FALLBACK = 'default system prompt';

test('readSystemPrompt: _meta line → extracts systemPrompt, rest returned as dataLines', () => {
  const meta = JSON.stringify({ _meta: true, systemPrompt: 'custom prompt' });
  const data = JSON.stringify({ targetId: 'B1', prompt: 'hi' });
  const { systemPrompt, dataLines } = readSystemPrompt([meta, data], FALLBACK);
  assert.equal(systemPrompt, 'custom prompt');
  assert.deepEqual(dataLines, [data]);
});

test('readSystemPrompt: no _meta line → fallback used, all lines returned', () => {
  const data = JSON.stringify({ targetId: 'B1', prompt: 'hi' });
  const { systemPrompt, dataLines } = readSystemPrompt([data], FALLBACK);
  assert.equal(systemPrompt, FALLBACK);
  assert.deepEqual(dataLines, [data]);
});

test('readSystemPrompt: empty input → fallback, empty dataLines', () => {
  const { systemPrompt, dataLines } = readSystemPrompt([], FALLBACK);
  assert.equal(systemPrompt, FALLBACK);
  assert.deepEqual(dataLines, []);
});

test('readSystemPrompt: non-JSON first line → fallback, all lines returned', () => {
  const { systemPrompt, dataLines } = readSystemPrompt(['not json', 'more'], FALLBACK);
  assert.equal(systemPrompt, FALLBACK);
  assert.deepEqual(dataLines, ['not json', 'more']);
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
node --test tests/test_ollama.test.js
```

Expected: new tests fail with "readSystemPrompt is not a function".

- [ ] **Step 3: Add `readSystemPrompt` to test_ollama.js and update `main()`**

In `test_models/test_ollama.js`, rename the constant and add the new export after `extractCandidates`:

```js
const SYSTEM_PROMPT_FALLBACK = "You are a helpful assistant for solving linguistic puzzles.";

export function readSystemPrompt(lines, fallback) {
  if (lines.length > 0) {
    try {
      const first = JSON.parse(lines[0]);
      if (first._meta === true && typeof first.systemPrompt === 'string') {
        return { systemPrompt: first.systemPrompt, dataLines: lines.slice(1) };
      }
    } catch { /* not JSON */ }
  }
  return { systemPrompt: fallback, dataLines: lines };
}
```

Update `main()` — replace the two lines that read the file and the reference to `SYSTEM_PROMPT`:

```js
  const rawLines = readFileSync(resolve(promptsPath), "utf8").split("\n").filter(Boolean);
  const { systemPrompt, dataLines: lines } = readSystemPrompt(rawLines, SYSTEM_PROMPT_FALLBACK);
```

Then in the `ollama.chat` call, the `messages` array already uses `systemPrompt` as variable name — keep it:

```js
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
```

Remove the old `const SYSTEM_PROMPT = ...` line and replace with `const SYSTEM_PROMPT_FALLBACK = ...` as shown above.

- [ ] **Step 4: Run tests to confirm all test_ollama tests pass**

```bash
node --test tests/test_ollama.test.js
```

Expected: all tests pass (existing 12 + new 4 = 16).

- [ ] **Step 5: Commit**

```bash
git add test_models/test_ollama.js tests/test_ollama.test.js
git commit -m "feat: export readSystemPrompt from test_ollama, use dynamic system prompt"
```

---

## Task 3: Add `read_system_prompt` to test_slm.py and update `main()`

**Files:**
- Modify: `test_models/test_slm.py`
- Modify: `tests/test_run_slm.py`

- [ ] **Step 1: Write failing tests for `read_system_prompt`**

In `tests/test_run_slm.py`, update the import line and add new tests:

```python
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'test_models'))

from test_slm import extract_candidates, read_system_prompt

# ... existing tests unchanged ...

FALLBACK = "default system prompt"

def test_read_system_prompt_with_meta():
    import json
    meta = json.dumps({"_meta": True, "systemPrompt": "custom prompt"})
    data = json.dumps({"targetId": "B1", "prompt": "hi"})
    system_prompt, data_lines = read_system_prompt([meta, data], FALLBACK)
    assert system_prompt == "custom prompt", system_prompt
    assert data_lines == [data], data_lines

def test_read_system_prompt_no_meta():
    import json
    data = json.dumps({"targetId": "B1", "prompt": "hi"})
    system_prompt, data_lines = read_system_prompt([data], FALLBACK)
    assert system_prompt == FALLBACK, system_prompt
    assert data_lines == [data], data_lines

def test_read_system_prompt_empty():
    system_prompt, data_lines = read_system_prompt([], FALLBACK)
    assert system_prompt == FALLBACK, system_prompt
    assert data_lines == [], data_lines

def test_read_system_prompt_non_json():
    system_prompt, data_lines = read_system_prompt(["not json", "more"], FALLBACK)
    assert system_prompt == FALLBACK, system_prompt
    assert data_lines == ["not json", "more"], data_lines
```

- [ ] **Step 2: Run tests to confirm import works and new tests fail**

```bash
python tests/test_run_slm.py
```

Expected: currently fails with `ModuleNotFoundError: No module named 'transformers'` — that's the bug we fix next.

- [ ] **Step 3: Update test_slm.py — move heavy imports, add `read_system_prompt`, update signatures**

In `test_models/test_slm.py`:

**a) Remove top-level heavy imports** (lines 27–28):
```python
# DELETE these two lines from the top of the file:
from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig
import torch
```

**b) Add them inside `load_model`** (the function that actually uses them):
```python
def load_model(model_path: str, quantize: bool):
    """Load tokenizer and model from a local HuggingFace checkpoint."""
    from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig
    import torch

    print("Loading tokenizer from path: ", model_path)
    tokenizer = AutoTokenizer.from_pretrained(model_path)
    # ... rest of function unchanged ...
```

**c) Add `SYSTEM_PROMPT_FALLBACK` constant and `read_system_prompt` function** after the imports block:

```python
SYSTEM_PROMPT_FALLBACK = "You are a helpful assistant for solving linguistic puzzles."


def read_system_prompt(lines, fallback):
    """Return (system_prompt, data_lines): extract _meta header if present."""
    if lines:
        try:
            first = json.loads(lines[0])
            if first.get('_meta') is True and isinstance(first.get('systemPrompt'), str):
                return first['systemPrompt'], lines[1:]
        except (json.JSONDecodeError, ValueError):
            pass
    return fallback, lines
```

**d) Update `generate_response` signature** to accept `system_prompt`:

```python
def generate_response(model, tokenizer, prompt: str, system_prompt: str) -> str:
    """Tokenize prompt, generate until the model's natural stop, decode new tokens only."""
    text = tokenizer.apply_chat_template(
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ],
        add_generation_prompt=True,
        tokenize=False,
    )
    # ... rest of function unchanged ...
```

**e) Update `main()`** — read all lines first, extract system prompt, iterate over data lines:

Replace the file-reading + loop block in `main()`:

```python
    with open(args.prompts, encoding="utf-8") as f_in:
        all_lines = [line.strip() for line in f_in if line.strip()]

    system_prompt, data_lines = read_system_prompt(all_lines, SYSTEM_PROMPT_FALLBACK)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    count = 0
    with open(output_path, "w", encoding="utf-8") as f_out:
        for line in data_lines:
            row = json.loads(line)
            target_id = row["targetId"]
            prompt = row["prompt"]

            raw = generate_response(model, tokenizer, prompt, system_prompt)
            candidates = extract_candidates(raw)

            out_row = {
                "targetId": target_id,
                "rawResponseText": raw,
                "candidates": candidates,
                "runner": runner,
                "promptVersion": prompt_version,
            }
            f_out.write(json.dumps(out_row) + "\n")
            f_out.flush()

            count += 1
            print(f"[{count}] {target_id}: {candidates[:2]}", file=sys.stderr)
```

- [ ] **Step 4: Run tests to confirm all Python tests pass**

```bash
python tests/test_run_slm.py
```

Expected output:
```
  PASS  test_json_array_bare
  PASS  test_json_array_embedded_in_prose
  PASS  test_json_array_caps_at_n
  PASS  test_json_array_fewer_than_n
  PASS  test_json_array_preferred_over_numbered_list
  PASS  test_numbered_list
  PASS  test_numbered_list_with_parens
  PASS  test_numbered_list_caps_at_n
  PASS  test_fallback_first_lines
  PASS  test_fallback_skips_empty_lines
  PASS  test_numbered_list_preferred_over_fallback
  PASS  test_returns_fewer_than_n_if_model_gave_less
  PASS  test_read_system_prompt_with_meta
  PASS  test_read_system_prompt_no_meta
  PASS  test_read_system_prompt_empty
  PASS  test_read_system_prompt_non_json

16 passed, 0 failed
```

- [ ] **Step 5: Commit**

```bash
git add test_models/test_slm.py tests/test_run_slm.py
git commit -m "feat: add read_system_prompt to test_slm, move transformers import to load_model"
```

---

## Task 4: Add `json_structured` template to prompt-templates.js

**Files:**
- Create: `tests/prompt-templates.test.js`
- Modify: `test_models/prompt-templates.js`

- [ ] **Step 1: Write failing tests for the `json_structured` build function**

Create `tests/prompt-templates.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import templates from '../test_models/prompt-templates.js';

const tmpl = templates.find(t => t.name === 'json_structured');

const mockContext = {
  targetId: 'B1234',
  spelling: 'B17717/B12374/B13366/B24895;B8993',
  charCount: 5,
  indicators: [
    { spelling: 'B8993', scope: 'word', name: 'action', group: 'verb', purpose: 'indicator (action)' }
  ],
  modifiers: [],
  subwords: [
    {
      spelling: 'B17717',
      span: [0, 1],
      helpers: [{ id: 'B17717', gloss: 'thing,object', pos: 'noun', answers: [], explanation: '(crystal outline)' }]
    },
    {
      spelling: 'B12374',
      span: [1, 2],
      helpers: [{ id: 'B12374', gloss: 'and,also,plus,too', pos: 'conjunction', answers: [], explanation: '(addition half-sized)' }]
    },
    {
      spelling: 'B13366',
      span: [2, 3],
      helpers: [{ id: 'B13366', gloss: 'clothing,clothes,garment', pos: 'noun', answers: [], explanation: '(cloth + protection)' }]
    },
    // B24895 intentionally absent — tests "skip if not found in subwords"
    {
      spelling: 'B17717/B12374/B13366',
      span: [0, 3],
      helpers: [{ id: 'B99999', gloss: 'accessory', pos: 'noun', answers: [], explanation: '(thing + plus + clothing)' }]
    },
  ],
  siblings: [],
  neighbours: { sharedStart: [], sharedEnd: [] },
  legend: [],
};

function parseOutput(ctx) {
  const output = tmpl.build(ctx);
  const splitOn = '\n\nReturn JSON array of candidate interpretations.';
  const idx = output.indexOf(splitOn);
  const jsonPart = output.slice(0, idx);
  return JSON.parse(jsonPart);
}

test('json_structured template exists with systemPrompt and build', () => {
  assert.ok(tmpl, 'json_structured template not found');
  assert.equal(typeof tmpl.build, 'function');
  assert.equal(typeof tmpl.systemPrompt, 'string');
  assert.ok(tmpl.systemPrompt.length > 0);
});

test('inputIds: all symbol codes from spelling including indicator code', () => {
  const parsed = parseOutput(mockContext);
  assert.deepEqual(parsed.inputIds, [17717, 12374, 13366, 24895, 8993]);
});

test('indicatorEffects: maps indicators to {id, gloss}', () => {
  const parsed = parseOutput(mockContext);
  assert.deepEqual(parsed.indicatorEffects, [{ id: '8993', gloss: 'indicator (action)' }]);
});

test('annotations: base chars with subword data, skips symbols with no subword entry', () => {
  const parsed = parseOutput(mockContext);
  // B24895 has no subword entry → skipped
  assert.deepEqual(parsed.annotations, [
    { id: '17717', gloss: 'thing,object', explanation: '(crystal outline)' },
    { id: '12374', gloss: 'and,also,plus,too', explanation: '(addition half-sized)' },
    { id: '13366', gloss: 'clothing,clothes,garment', explanation: '(cloth + protection)' },
  ]);
});

test('subwordMatches: multi-char subwords with subWord array and gloss/explanation', () => {
  const parsed = parseOutput(mockContext);
  assert.deepEqual(parsed.subwordMatches, [
    { subWord: [17717, 12374, 13366], matchedGloss: 'accessory', matchedExplanation: '(thing + plus + clothing)' }
  ]);
});

test('modifierEffects: absent when modifiers.length is 0', () => {
  const parsed = parseOutput(mockContext);
  assert.equal(parsed.modifierEffects, undefined);
});

test('modifierEffects: absent when modifiers.length is 1', () => {
  const ctx = {
    ...mockContext,
    modifiers: [
      { spelling: 'B449', codes: ['B449'], gloss: 'minus,no,without', asPrefix: ['non-'], category: 'negation', span: [0, 1] }
    ]
  };
  const parsed = parseOutput(ctx);
  assert.equal(parsed.modifierEffects, undefined);
});

test('modifierEffects: present when modifiers.length > 1', () => {
  const ctx = {
    ...mockContext,
    modifiers: [
      { spelling: 'B449', codes: ['B449'], gloss: 'minus,no,without', asPrefix: ['non-'], category: 'negation', span: [0, 1] },
      { spelling: 'B532', codes: ['B532'], gloss: 'opposite_of', asPrefix: ['anti-'], category: 'opposition', span: [1, 2] },
    ]
  };
  const parsed = parseOutput(ctx);
  assert.deepEqual(parsed.modifierEffects, [
    { id: '449', gloss: 'minus,no,without' },
    { id: '532', gloss: 'opposite_of' },
  ]);
});

test('output ends with trailing instruction', () => {
  const output = tmpl.build(mockContext);
  assert.ok(output.endsWith('Return JSON array of candidate interpretations.'));
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
node --test tests/prompt-templates.test.js
```

Expected: 'json_structured template not found' assertion failure.

- [ ] **Step 3: Add `json_structured` template to prompt-templates.js**

Append to the array in `test_models/prompt-templates.js` (before the closing `];`):

```js
  {
    name: "json_structured",
    systemPrompt: `You interpret one Blissymbolics word into ranked natural-language candidates.

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

Return ONLY a JSON array of 5 candidate words or phrases, best-first. No prose, no commentary.`,
    build: (context) => {
      const inputIds = [...context.spelling.matchAll(/B(\d+)/gi)].map(m => parseInt(m[1], 10));

      const indicatorEffects = context.indicators.map(ind => ({
        id: ind.spelling.replace(/^B/i, ""),
        gloss: ind.purpose,
      }));

      const indicatorIdSet = new Set(indicatorEffects.map(e => parseInt(e.id, 10)));
      const baseIds = inputIds.filter(id => !indicatorIdSet.has(id));

      const singleCharSubword = new Map();
      for (const sw of context.subwords) {
        const codes = [...sw.spelling.matchAll(/B(\d+)/gi)].map(m => parseInt(m[1], 10));
        if (codes.length === 1) singleCharSubword.set(codes[0], sw);
      }

      const annotations = baseIds.flatMap(id => {
        const sw = singleCharSubword.get(id);
        if (!sw || !sw.helpers[0]) return [];
        const h = sw.helpers[0];
        return [{ id: String(id), gloss: h.gloss, explanation: h.explanation }];
      });

      const subwordMatches = context.subwords
        .filter(sw => {
          const codes = [...sw.spelling.matchAll(/B(\d+)/gi)].map(m => parseInt(m[1], 10));
          return codes.length > 1;
        })
        .map(sw => {
          const codes = [...sw.spelling.matchAll(/B(\d+)/gi)].map(m => parseInt(m[1], 10));
          const h = sw.helpers[0];
          return {
            subWord: codes,
            matchedGloss: h ? h.gloss : "",
            matchedExplanation: h ? h.explanation : "",
          };
        });

      const payload = { inputIds, indicatorEffects, annotations, subwordMatches };

      if (context.modifiers.length > 1) {
        payload.modifierEffects = context.modifiers.map(m => ({
          id: m.codes[0].replace(/^B/i, ""),
          gloss: m.gloss,
        }));
      }

      return JSON.stringify(payload, null, 2) + "\n\nReturn JSON array of candidate interpretations.";
    },
  },
```

- [ ] **Step 4: Run tests to confirm all prompt-templates tests pass**

```bash
node --test tests/prompt-templates.test.js
```

Expected: all 8 tests pass.

- [ ] **Step 5: Run full test suite to confirm no regressions**

```bash
node --test
```

Expected: 80+ pass, same 2 pre-existing failures (the `buildContextFromSpelling` and caps tests) and no new failures.

- [ ] **Step 6: Commit**

```bash
git add test_models/prompt-templates.js tests/prompt-templates.test.js
git commit -m "feat: add json_structured template with system prompt and structured JSON build"
```

---

## Task 5: Update docs/test-slms.md

**Files:**
- Modify: `docs/test-slms.md`

- [ ] **Step 1: Update Step 1 section to document `systemPrompt` field**

In the "Step 1 — Edit prompt templates" section, update the template example to show the optional `systemPrompt` field:

```markdown
## Step 1 — Edit prompt templates

Open `test_models/prompt-templates.js`. Each entry in the array is a template:

```js
export default [
  {
    name: 'subwords-v1',          // becomes the output filename
    systemPrompt: '...',          // optional; one system prompt for all records in this template
    build: (context) => {         // context = kit.dataset.buildContext(targetId)
      // ...build and return a prompt string
    },
  },
];
```

When `systemPrompt` is present, `gen-prompts.js` writes it once as a metadata header in the
generated JSONL (see Step 2). Both runners read it automatically. Omit the field to use the
default: `"You are a helpful assistant for solving linguistic puzzles."`.
```

- [ ] **Step 2: Update Step 2 to document the `_meta` header line**

In the "Step 2 — Generate prompt files" section, update the JSONL format description:

```markdown
This writes one JSONL file per template to `test_models/prompts/`. When the template has a
`systemPrompt`, the first line is a metadata header; the remaining lines are prompt rows:

```
{"_meta":true,"systemPrompt":"You interpret one Blissymbolics word..."}
{"targetId":"B…","prompt":"…"}
{"targetId":"B…","prompt":"…"}
```

Templates without `systemPrompt` produce JSONL with no header line (the runners fall back to
the default system prompt).
```

- [ ] **Step 3: Add `json_structured` template to the context fields table**

After the `legend[]` row in the context fields table, add:

```markdown
| `indicators[].purpose` | `string` | Curated grammatical meaning of the indicator |
| `modifiers[].codes` | `string[]` | B-code IDs of the modifier symbols |
| `modifiers[].gloss` | `string` | Dictionary gloss of the modifier |
| `subwords[].helpers[].explanation` | `string` | Dictionary explanation for that subword |
```

- [ ] **Step 4: Add `json_structured` template description before Step 4**

Add a new section after the "Step 3 (alternative) — Run via Ollama" section:

```markdown
## Available templates

| Name | Description |
|---|---|
| `simple` | Short user prompt: spelling + character glosses. No system prompt override. |
| `narrative` | User prompt with subwords, related words, and legend. No system prompt override. |
| `json_structured` | Structured JSON user prompt: `inputIds`, `annotations`, `indicatorEffects`, `subwordMatches`. Includes a detailed Blissymbolics interpretation system prompt. |
```

- [ ] **Step 5: Commit**

```bash
git add docs/test-slms.md
git commit -m "docs: update test-slms.md for systemPrompt field, _meta format, json_structured template"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Templates declare optional `systemPrompt` | Task 4 (template shape) |
| `gen-prompts.js` writes `_meta` line when `systemPrompt` present | Task 1 (`buildFileContent`) |
| `test_ollama.js` reads `_meta`, uses dynamic system prompt | Task 2 |
| `test_slm.py` reads `_meta`, uses dynamic system prompt | Task 3 |
| Existing templates fall back to hard-coded default | Task 2 + 3 (fallback param) |
| New `json_structured` template with correct system prompt | Task 4 |
| `inputIds` from spelling (all codes, including indicators) | Task 4 (build fn) |
| `indicatorEffects` from `context.indicators[].purpose` | Task 4 (build fn) |
| `annotations` from single-char subwords, skip missing | Task 4 (build fn) |
| `subwordMatches` with `subWord` array from multi-char subwords | Task 4 (build fn) |
| `modifierEffects` only when `context.modifiers.length > 1` | Task 4 (build fn) |
| Trailing instruction appended to user message | Task 4 (build fn) |
| Fix `break` in `buildPromptRows` | Task 1 |
| Python tests runnable without `transformers` | Task 3 |
| `docs/test-slms.md` updated | Task 5 |

All requirements covered. No gaps found.
