# blissbench

Can an AI read a Blissymbolics word it has never seen?

A Bliss word is written as a sequence of **Blissary IDs**, the character codes used on
[blissary.com](https://blissary.com) and in
[Bliss SVG Builder](https://github.com/hlridge/bliss-svg-builder), joined by `/`, e.g.
`B398/B688/B999`. (They are Blissary IDs, not BCI-AV codes; each dictionary entry also carries
a separate `bciAvId`.) The task is to turn that spelling into English.

The words already in the dictionary aren't the point, they give us a **scored benchmark to
measure and refine the method**. By *the method* we mean the whole pipeline you build: for a
given spelling, gather the relevant pieces of the dictionary, structure them, together with
what you know about Blissymbolics and English, into a prompt, send it to an AI, and read back
a suggested meaning. The real goal is interpreting spellings that *aren't* in the dictionary,
by composing meaning from their parts; a high score is a proxy for a good method, not the end.

The kit freezes the two things a **comparable** result needs: the same questions and the same
ruler, so any score difference comes from the method, not from the questions or the ruler.
Everything in between is yours:

```
 ┌─ FROZEN (shared) ─────────┐   ┌─ FREE (configurable) ─┐   ┌─ FROZEN (shared) ──┐
 │ the eligible target set   │ ▶ │ the model, prompt,    │ ▶ │ the scorer          │
 │ (data/targets.jsonl)      │   │ language rules,       │   │ (bin/score.js)      │
 │ + the query API           │   │ context layout, …     │   │ top-1 / top-5 / MRR │
 └───────────────────────────┘   └───────────────────────┘   └─────────────────────┘
```

Same targets, same scorer; the prompt, model and context in between are what you vary. Plain
Node (>= 18), no dependencies, no build step, the frozen `data/` is committed.

> Experimental, throwaway kit, not maintained after the comparison is done.

> **The hints are only as good as the dictionary.** Every clue the kit surfaces, subword
> glosses, siblings, neighbours, modifier and indicator readings, comes from one snapshot of
> the **Blissary Bliss dictionary** (its symbol meanings draw on BCI-AV's authorized
> vocabulary). It is human-curated, **not an oracle**: it has errors, internal inconsistencies,
> and uneven topic coverage. Two entries can gloss the same idea differently (so hints
> conflict), a derivation may be debatable, and a spelling about a thinly-covered subject yields
> few hints or none. So the dictionary's quality, consistency and coverage are part of what any
> score reflects: reading a word well sometimes means reasoning *past* noisy or sparse hints.
> Don't treat a gloss as ground truth.

## Quickstart

```bash
git clone https://github.com/hlridge/blissbench.git
cd blissbench
# Nothing to install or build: zero dependencies, and data/ is committed.

# 1. Watch the whole loop run offline (context → prompt → stub model → score):
npm run example

# 2. See what the kit hands your pipeline for ANY spelling, including one that is
#    not in the dictionary (that is the actual task):
node bin/show-context.js B398/B688/B999

# 3. Produce a submission (here, the no-API baseline) and score it. `npm run baseline`
#    answers every target (--set all by default), so score against the same --set all:
npm run baseline
node bin/score.js --submission results/baseline.jsonl --set all
```

(Scoring a submission against a smaller `--set` than it answered is fine too: the scorer
just notes how many rows fall outside that set and grades the rest. Pass the **same** set to
both commands to avoid that note.)

`npm run example` is the whole pipeline in one file (`examples/end-to-end.example.js`): it
builds context for a small test set (set 50 by default), turns each into a prompt, calls a trivial offline stub in
place of a model, and scores the result. Replace the one `callModel` function with a real API
call and you have a working pipeline.

To use the kit as a dependency instead of cloning:

```bash
npm install git+https://github.com/hlridge/blissbench.git
# then:  import { loadKit } from 'blissbench';
```

## What you get

The kit hands your pipeline one context object and nothing else; you decide what to do with
it. For a benchmark target:

```js
const kit = await loadKit();
const context = kit.dataset.buildContext('B4945');   // by target id or code
```

`context` holds only things derived from the spelling, plus evidence from *other* dictionary
entries (only as reliable as the dictionary itself, see the note above). The target's own
meaning is never included: that would be the answer. The fields:

| Field | What it is |
| --- | --- |
| `spelling`, `charCount` | the canonical spelling and how many characters it has |
| `modifiers` | pre-head operators in the spelling (negation, "inside", "opposite of", quantifiers, …), detected by sequence (so one may instead carry the meaning in a given word), each with its dictionary `gloss` and its `asPrefix` reading |
| `indicators` | grammar markers on the characters (tense, number, part of speech), with their meaning |
| `subwords` | contiguous fragments of the word that are themselves dictionary words |
| `siblings` | other words with the same base glyphs but different indicators (the grammar / sense markers), e.g. *murder* ↔ *to murder* (action indicator) |
| `neighbours` | other words sharing a leading run of glyphs (which often, but not always, carries the head/classifier) or a trailing run, ranked by how much they share |
| `legend` | the words inside the neighbours' **non-shared** parts — the symbols that differ from the target, decoded as single glyphs and multi-glyph sequences (like `subwords`), so those codes aren't opaque |

For a spelling that may not be a dictionary word (the unknown-word case), use
`buildContextFromSpelling(spelling)`. It returns the same fields plus `exactMatch`: if the
spelling is already a known word, its meaning is there (no need to guess); if `exactMatch` is
empty, you are genuinely interpreting from parts. Inspect any of this with
`node bin/show-context.js <id|spelling>`.

### The score

`bin/score.js` (and `createReport` underneath it) grades five guesses per target:

```
Set "50": scored 50 of 50 targets
  top1 6.0%   top5 10.0%   MRR 0.0767
  ✓ full coverage of set "50" (official score requires --set all)
```

- **top1**: share of targets whose first guess was right.
- **top5**: share with a correct guess anywhere in the five.
- **MRR**: mean of 1/rank; rewards ranking the right answer higher.
- **coverage**: how many targets in the chosen set you actually answered.

The printed report also breaks the numbers down by part of speech. The summary `.json` adds a
provenance stamp (`manifestSha256`, `setSeed`, `kitVersion`, `runner`) so two runs can be
checked for comparability. A run counts as **official** only at `--set all`, with full
coverage and no duplicate rows.

## Where things live

| I want to… | Look at |
| --- | --- |
| know the rules (eligibility + scoring) | `CONTRACT.md`, generated from the code, so it can't drift |
| know *why* the kit is shaped this way | `docs/DECISIONS.md` |
| build context for a word | `kit.dataset.buildContext` / `buildContextFromSpelling` (`src/`) |
| see one word's context | `node bin/show-context.js <id\|spelling>` |
| score a submission | `node bin/score.js` |
| run the whole loop as a demo | `npm run example` (`examples/end-to-end.example.js`) |
| the frozen questions / hidden answers | `data/targets.jsonl` / `data/answers.jsonl` |

Full file list:

| Path | What it is |
| --- | --- |
| `CONTRACT.md` | every eligibility + scoring rule, generated from the rule registries |
| `docs/DECISIONS.md` | the design rationale, in plain English |
| `data/blissary-…-2026-05-23.json` | the pinned Blissary dictionary snapshot, meanings draw on BCI-AV vocabulary (swappable) |
| `data/targets.jsonl` | the frozen eligible targets, what we test |
| `data/answers.jsonl` | the hidden answer key, used only by the scorer |
| `data/manifest.json` | snapshot hash + counts; runs must share the same `sha256` |
| `data/modifiers.json`, `data/indicators.json` | curated references (gloss + readings) |
| `src/` | the Kit API you import |
| `bin/score.js` | the shared scorer |
| `bin/show-context.js` | print one word's context |
| `examples/end-to-end.example.js` | the whole loop in one file (`npm run example`) |
| `examples/build-method.example.js` | the smallest worked method: hints → a prompt string (`npm run method`) |
| `examples/collect.example.js` | a minimal submission template (`npm run demo`) |
| `examples/baseline.example.js` | a no-API helper-gloss baseline, a floor to clear (`npm run baseline`) |
| `schemas/submission.schema.json` | the result format your pipeline emits |
| `src/lib/run-record.js` | `recordRun()` — saves a method copy + run details + prompts/answers |
| `runs/<name>.<timestamp>.run.json` (+ `.interactions.jsonl`) | the durable, timestamped record of what produced a score (kept, not gitignored) |

## The Kit API

```js
import { loadKit } from 'blissbench'; // or: from './src/index.js'

const kit = await loadKit();
for (const target of kit.dataset.getEligibleTargets()) {
  // target = { targetId, spelling, charCount }   ← sealed: no gloss/pos/explanation
  const context = kit.dataset.buildContext(target.targetId);
  // → shape into your prompt, call your model, emit a row:
  //   { targetId, candidates: [5 strings], runner, promptVersion }
}
```

Everything on `kit.dataset`:

| Method | Returns |
| --- | --- |
| `getEligibleTargets()` | the frozen target list (sealed), stable B-id order |
| `buildContext(idOrCode)` | leak-free context for a target, the fields above |
| `buildContextFromSpelling(spelling)` | the same for an arbitrary spelling, plus `exactMatch`; not sealed, for interpreting unseen words |
| `subwordsOf(idOrCode)` | contiguous proper subwords + their preferred-entry helpers, indicator-agnostic |
| `siblingsOf(idOrCode)` | preferred entries with the same base glyphs but different indicators |
| `neighboursOf(idOrCode)` | `{ sharedStart, sharedEnd }`, ranked longest-shared-first |
| `sharedStartOf` / `sharedEndOf(idOrCode)` | the two halves of `neighboursOf` |
| `modifiersOf(spelling)` | modifier sequences found in a spelling |
| `indicatorsOf(spelling)` | indicators in a spelling, resolved to their curated meaning |
| `findBySpelling` / `findByBaseSpelling(spelling)` | preferred entries matching a spelling exactly / ignoring indicators |
| `getEntry` / `derivationOf` / `answerKeyOf(idOrCode)` | full entry data, inspection/scoring only, never feed to a prompt |
| `eligibilityReport()` | counts of eligible / excluded |

The target entry is sealed deliberately: its gloss, explanation, part of speech and
derivation are tells, so `getEligibleTargets()` and `buildContext()` never expose them. Build
prompts from those methods, not from `getEntry` / `answerKeyOf` / `derivationOf`.

## Build your method

The "middle" is the part you own: take what `buildContext` hands you and turn it into a prompt.
There is no required shape — you pick which hints to use and how to phrase them.
`examples/build-method.example.js` (`npm run method`) is the smallest honest version: a two-line
task, then it concatenates *some* of the hints (and skips the rest on purpose).

```js
const buildPrompt = (c) => {
  const out = [];
  out.push('Interpret this Blissymbolics word. Reply with your 5 best English guesses, best first, as a JSON array.');
  out.push(`Word: ${c.spelling}  (${c.charCount} symbols)`);
  if (c.subwords.length) {
    out.push('\nParts of it that are themselves words:');
    for (const s of c.subwords) out.push(`  ${s.spelling} = ${s.helpers.map(h => h.gloss).join('; ')}`);
  }
  const related = c.neighbours.sharedStart.concat(c.neighbours.sharedEnd).slice(0, 6);
  if (related.length) {
    out.push('\nRelated words that share symbols with it:');
    for (const n of related) out.push(`  ${n.spelling} = ${n.gloss}`);
  }
  if (c.legend.length) {
    out.push('\nWhat the other symbols in those related words mean:');
    for (const p of c.legend.slice(0, 10)) out.push(`  ${p.spelling} = ${p.gloss}`);
  }
  return out.join('\n');               // ← send this string to your model
};
```

Run it and you see the **materialized** prompt — exactly what those variables expand to, for
`B1175` (`B426/B643`):

```text
Interpret this Blissymbolics word. Reply with your 5 best English guesses, best first, as a JSON array.
Word: B426/B643  (2 symbols)

Parts of it that are themselves words:
  B426 = limited time, interval, period, awhile, for a while; temporary
  B643 = teenager, adolescent, youth

Related words that share symbols with it:
  B426/B562 = rest period, break
  B426/B412 = lesson, lecture, class
  B426/B420 = long time
  …

What the other symbols in those related words mean:
  B392/B106 = activity centre
  B412/B719 = sport (class)
  B106 = activity, male gender (in combinations)
  B392 = house, building, dwelling, residence
  …
```

That is the whole idea: the codes arrive as evidence (`B426 = period`, `B643 = youth`), the
`legend` decodes the symbols *inside* the related words, and a reader needs no prior Bliss to
follow it. This is **one** example, not part of the frozen contract — change the task line, use
more or fewer hints, add the modifier/indicator readings, lay it out differently. Swap the final
`return`/`console.log` for your API call and you have a pipeline; wire it into the submission loop
in the next section.

## Run a set and score it

Your pipeline writes a **submission**: one JSONL row per target you answered
(`schemas/submission.schema.json`):

```json
{"targetId":"B1167","candidates":["abuse","violence","force","assault","harm"],"runner":"my-run","promptVersion":"v1"}
```

`results/my-run.jsonl` is simply **that file, your pipeline's output**, and the name is yours.
You don't write the rows by hand: `examples/collect.example.js` is the submission **harness** —
it loops the targets of a chosen set, hands each `buildContext` to a `callYourModel` stub, and
writes the rows. (The prompt-building seam itself is **Build your method** above; here it's just
a stub so the template runs.) So a full run is two commands:

```bash
# 1. write a submission for set 50 (edit collect.example.js: plug in your model):
node examples/collect.example.js --set 50 --output results/my-run.jsonl
# 2. score that file against the same set:
node bin/score.js --submission results/my-run.jsonl --set 50
```

A **set** is just a fixed list of test words: `50` is one specific list of 50 words, `100` a
specific 100, and so on, the same list for everyone, so results line up. Step 1 answers the
words in set 50; step 2 grades those answers against set 50. Pass the **same** `--set` to both
commands and the report shows full `coverage` (you answered every word it checked).

```bash
node bin/score.js --list-sets                                 # which sets exist
node bin/score.js --submission results/my-run.jsonl --set all # the official run
```

The sets are fixed and **nested**: the 50-word list sits inside the 100, the 100 inside the
300, and so on up to `all` (every target). Try a small one while you iterate, then run `all` for
a real score. Each list is balanced by part of speech and word length, so even the 50 broadly
mirrors the dominant pos/length mix (the rarest classes appear only in the larger sets).

| Set | Targets | ~95% CI | Use |
| --- | ---: | ---: | --- |
| `50` | 50 | ±13.9% | smoke check |
| `100` | 100 | ±9.8% | rough |
| `300` | 300 | ±5.7% | close runs start to separate |
| `1000` | 1000 | ±3.1% | solid |
| `all` | 4186 | 0 (census) | official |

The CI applies to the proper subsets, which are samples of the eligible set. `all` is every
eligible target, so the official score is a census, not a sample: it has no sampling error and
is exact for the snapshot (a sampling CI says nothing about whether the snapshot or answer key
is right, which is the only uncertainty left at `--set all`).

The same scoring is available as a function: `createReport(submission, answers, { set,
universe, manifest })` returns `{ summary, scored }`, and `formatReport(summary)` renders it.
For a no-API sanity check, `npm run baseline` guesses straight from helper glosses, a floor
to improve on.

## Keep your method (reproducibility is half yours)

The kit freezes the questions and the scorer — but **not your method**. Your method is your
code (the prompt-builder + model call), and the kit can't store or version it for you. So
reproducing a score needs three things: the same **data** (the `sha256` proves it), the same
**set** (the seed), and **your method** — and only you can keep that last one. Edit the file and
re-run and the earlier score's recipe is gone unless you saved it.

To make that automatic, `collect.example.js` writes a **run record** next to every run, in a
kept `runs/` folder (not throwaway `results/`). The file name carries the timestamp, so
re-running never overwrites an earlier record:

- `runs/<name>.<timestamp>.run.json` — the date, the set, the snapshot `sha256` + kit version,
  your `runner` and `promptVersion`, the model (if you name it), and **a copy of your method
  file** (with its own hash), so the recipe is literally in the record — no copy-paste.
- `runs/<name>.<timestamp>.interactions.jsonl` — the exact **prompt sent and the answer** for
  each word. This is the real reproduce/re-grade material: you can inspect or re-score it
  without calling the model again.

> **It's a record, not a replay button.** A method usually calls a model over the network, which
> can change, be retired, or answer differently next time — so a saved record can't guarantee the
> same numbers later. What it guarantees is that you can always see *exactly* what produced a
> score. (`recordRun()` in `src/lib/run-record.js`; call it from your own runner too.)

## Ground rules

- Two runs compare only if they share the same `manifest.sha256` and the same set seed.
- A score is **official** only at `--set all`, with full coverage and no duplicate rows; the
  scorer says so explicitly.
- The middle is free, but don't feed the model the target's own entry (gloss, explanation,
  pos, derivation); `buildContext` seals these for you. Subwords, siblings and neighbours
  from *other* entries may reveal an answer (e.g. *murder* helps *to murder*); that is allowed
  and symmetric: composing meaning from them is the task.

The answer key isn't a secret: the bundled dictionary contains every word's gloss, so anyone
could look one up. Integrity comes from discipline, not concealment: build from
`buildContext()` and don't read the target's own gloss.

## Swapping the snapshot

Drop a newer Blissary dictionary export (same shape) into `data/`, point `loadKit`/scripts at
it, and run `npm run build`. You get a new frozen set with a new `sha256`; agree on which
snapshot a round uses. All runs in a round share that hash and the set seed.

## License

- **Code:** Mozilla Public License 2.0 (`LICENSE`). Import it anywhere; MPL only asks that
  edits to MPL files stay open.
- **Bundled dictionary data** (`data/*.json`, `*.jsonl`): Creative Commons Attribution-ShareAlike
  4.0, © Blissymbolics Communication International and Blissary (Hannes Ljusås). See `NOTICE`.
- The modifier **set** (which sequences are modifiers, their tiers and conditional exceptions)
  originates from the BCI-AV head-glyph exclusions in
  [bliss-svg-builder](https://github.com/hlridge/bliss-svg-builder) (MPL-2.0), referenced, not
  vendored; the kit owns its curated copy in `src/modifiers/bliss-modifiers.js`.
