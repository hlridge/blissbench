#!/usr/bin/env node
/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
/**
 * build-manifest.js
 *
 * Regenerates the FROZEN benchmark artifacts from the bundled snapshot:
 *   data/targets.jsonl     eligible targets, sealed fields    ("what we test")
 *   data/answers.jsonl     hidden answer key (scorer-only)
 *   data/sets/set-*.jsonl  nested, stratified test subsets (50 ⊂ 100 ⊂ … ⊂ all)
 *   data/manifest.json     snapshot hash + counts + set info  (comparability stamp)
 *   CONTRACT.md            human-readable rules, generated from the rule registries
 *
 * All runs must share the SAME manifest (same sha256, same seed) so their sets and
 * scores line up. Swap the JSON, re-run this, get a new frozen round.
 *
 * Run:  node bin/build-manifest.js
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, basename } from 'node:path';
import {
  loadKit,
  KIT_VERSION,
  eligibilityRules,
  answerKeyRules,
  normalizationRules,
  metrics,
  needsCuration
} from '../src/index.js';
import { orderTargetsStratified, buildNestedSubsets } from '../src/lib/sampling.js';

const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = (p) => resolve(KIT_ROOT, p);

// Nested test-set sizes. Each smaller set is a prefix (subset) of the larger.
const SET_SIZES = [50, 100, 300, 1000, 'all'];
const SET_SEED = 'blissbench-v1';
// Stratify by the JOINT distribution of part-of-speech AND word length, so every
// nested prefix mirrors both the pos mix and the length mix of the full set.
const STRATIFY_BY = ['pos', 'charBucket'];
const charBucketOf = (charCount) => (charCount >= 5 ? '5+' : String(charCount));

const writeJsonl = async (filePath, rows) => {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');
};
const writeJson = async (filePath, value) =>
  writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const seal = ({ targetId, spelling, charCount }) => ({ targetId, spelling, charCount });
const setFileName = (size) => `set-${size}.jsonl`;

const renderContract = ({ manifest, report, modifiers, indicators, sets, aliases, aliasExamples }) => {
  const lines = [];
  const push = (...l) => lines.push(...l);

  push('# blissbench Contract', '');
  push('> **Generated file, do not edit by hand.** Regenerate with `node bin/build-manifest.js`.');
  push('> Every rule below is generated from the executable rule registries in `src/rules/`,');
  push('> so this document and the kit\'s behavior can never disagree.', '');

  push('## Snapshot', '');
  push(`- Source: \`data/${manifest.sourceFile}\``);
  push(`- SHA-256: \`${manifest.sha256}\``);
  push(`- Kit version: \`${manifest.kitVersion}\``);
  push(`- Entries: **${report.total}** total → **${report.eligible}** eligible targets`, '');
  push('Scores are comparable only across runs that share the same SHA-256 (and set seed).', '');

  push('## What the model may see (information sealing)', '');
  push('The target entry is **off-bounds for information seeking**. Anything in the target\'s own');
  push('dictionary entry (gloss, explanation, derivation, part-of-speech, filename) could be a');
  push('tell, so the kit never exposes it when building context. A prompt may use only:', '');
  push('- the canonical **spelling** (the question itself) and facts derived from it;');
  push('- **modifier** sequences (each with `gloss`, the symbol\'s own dictionary meaning, and');
  push('  `asPrefix`, how it reads when prefixing what follows) and **indicator** meanings, from the');
  push('  kit\'s curated references (general symbol knowledge, see the reference sections below);');
  push('- **subword helpers**: other *preferred* dictionary entries that match a contiguous subword;');
  push('- **siblings**: other *preferred* entries with the same glyphs but different indicators;');
  push('- **neighbours**: other *preferred* entries that share an AFFIX with the target, the same');
  push('  leading run of glyphs (which often, but not always, carries the head/classifier) or a');
  push('  shared trailing run, but are neither a fragment');
  push('  (subword) nor a same-base variant (sibling). Ranked longest-shared-first; `buildContext`');
  push('  caps each group with an `omitted` count, and the full set is available via `neighboursOf`.');
  push('- **legend**: the dictionary words inside those neighbours\' NON-SHARED parts (the glyphs that');
  push('  differ from the target), decoded as single glyphs AND multi-glyph contiguous sequences, the');
  push('  way subwords decode the target, so the differing codes are not opaque. Deduped, and excluding');
  push('  any part the target\'s own subwords already explain. Same fair-game leak policy (other entries).');
  push('');
  push('Subword/sibling/neighbour matching is **indicator-agnostic**: it compares the base character');
  push('sequence, ignoring sense (`;B97`/`;B6436`) and grammatical (`;;…`) indicators, so a fragment');
  push('finds grammatical and sense variants of those glyphs. A helper, sibling, or neighbour from');
  push('*another* entry may legitimately reveal an answer (e.g. "murder" helps "to murder"); this is');
  push('allowed and symmetric: composing meaning from such evidence is exactly the task. Only the');
  push('target\'s OWN entry is sealed.', '');
  push('The dictionary is human-curated, **not an oracle**: its glosses, derivations and coverage are');
  push('uneven and can be wrong or inconsistent. So the helpers/siblings/neighbours it yields shape,');
  push('and limit, how well any method can do: a thinly-covered subject surfaces few or conflicting');
  push('hints. Treat a gloss as evidence, not ground truth.', '');
  push('`kit.dataset.buildContext(targetId)` returns exactly this leak-free view. The raw accessors');
  push('(`getEntry`, `answerKeyOf`, `derivationOf`) expose target-private data and must not feed prompts.', '');
  push('For interpreting an **arbitrary spelling that need not be a target** (the real goal, an unseen');
  push('Bliss word), `kit.dataset.buildContextFromSpelling(spelling)` returns the same building blocks');
  push('from the spelling alone, plus an `exactMatch` flag (whether it is already a known word). It has');
  push('no "self" to seal, so it is an interpretation aid, **not** a benchmark scoring path.', '');

  push('## What we test: eligibility rules', '');
  push('An entry is an eligible target only if it **passes every** rule below.', '');
  eligibilityRules.forEach((rule, i) => {
    push(`### ${i + 1}. ${rule.title}  \`#${rule.id}\``);
    push(`- **Rule:** ${rule.rule}`);
    push(`- **Why:** ${rule.why}`, '');
  });

  push('### Exclusions by rule (this snapshot)', '');
  push('**Primary reason** attributes each excluded entry to the *first* rule it fails (so the');
  push('column sums to total − eligible). **Fails rule** counts every entry that fails each rule');
  push('independently (these overlap, e.g. a character also lacks a B-code spelling).', '');
  push('| Rule | Primary reason | Fails rule (independent) |', '| --- | ---: | ---: |');
  for (const rule of eligibilityRules) {
    push(`| \`#${rule.id}\` | ${report.byFailedRule[rule.id] || 0} | ${report.byRuleIndependent[rule.id] || 0} |`);
  }
  push(`| **eligible** | **${report.eligible}** | |`, '');

  push('## How we score', '');
  push('### Answer key', '');
  answerKeyRules.forEach((rule) => {
    push(`- **${rule.title}** \`#${rule.id}\`: ${rule.rule}  `);
    push(`  *Why:* ${rule.why}`);
  });
  push('');
  push('### Normalization (applied to answers AND candidates, in order)', '');
  normalizationRules.forEach((rule, i) => {
    push(`${i + 1}. **${rule.title}** \`#${rule.id}\`: ${rule.rule}  `);
    push(`   *Why:* ${rule.why}`);
  });
  push('');
  push('### Metrics reported', '');
  metrics.forEach((metric) => {
    push(`- **${metric.title}** \`#${metric.id}\`: ${metric.rule}  `);
    push(`  *Why:* ${metric.why}`);
  });
  push('');
  push('The scorer also reports a **per-part-of-speech (`byPos`) breakdown** (the eligible set');
  push('is pos-skewed, so an aggregate can mask per-pos performance) and stamps each summary');
  push('with provenance: `manifestSha256`, `setSeed`, `kitVersion`, `runner`, so two summaries');
  push('can be checked for comparability. A run is `official` only at `--set all` with full');
  push('coverage and no duplicate rows.', '');

  push('### Answer aliases (the spellings that should match)', '');
  push('A raw gloss often glues a disambiguator onto the head word, which would fail an obvious');
  push('correct guess. A mechanical rule strips a bracketed tag to the bare head (plus the other');
  push('plural/dialect spelling); for the messy tail a rule cannot read safely, a per-entry **model');
  push('judgement**, frozen at authoring time and merged deterministically (the model never runs in');
  push('the build), supplies the clean accepted spellings, including natural frontings like "induced');
  push('abortion". **Every change is logged, per target, in `data/answer-aliases.jsonl`** with a');
  push('`source: "rule" | "curated"` marker (and a rationale for curated rows), so the expansion is');
  push('fully auditable. See `docs/answer-alias-curation.md`.', '');
  push(`- **${aliases.count}** of ${report.eligible} targets gain ≥1 accepted spelling, adding **${aliases.formsAdded}** extra spellings in total; **${aliases.curated}** of those targets were model-curated (the rest expanded by the mechanical rule).`, '');
  if (aliasExamples && aliasExamples.length) {
    push('| Target | Raw gloss | Also accepted |', '| --- | --- | --- |');
    for (const ex of aliasExamples) push(`| \`${ex.id}\` | ${ex.base} | ${ex.extra} |`);
    push('');
  }

  push('## Test sets', '');
  push('Fixed, **nested** subsets (files in `data/sets/`; `node bin/score.js --list-sets`) let you');
  push(`iterate cheaply, then run the full set for an official score. Built with seed \`${SET_SEED}\`,`);
  push('**stratified by part-of-speech AND word length** (2 / 3 / 4 / 5+ characters) so every prefix');
  push('mirrors both the pos mix and the length mix, and each smaller set is a prefix of the larger.', '');
  push('| Set | Targets | File | 95% CI* |', '| --- | ---: | --- | ---: |');
  for (const set of sets) {
    const ciCell = set.size === 'all' ? '0 (census)' : `±${set.ci}`;
    push(`| \`${set.size}\` | ${set.count} | \`data/sets/${set.file}\` | ${ciCell} |`);
  }
  push('');
  push('*Rough worst-case 95% confidence half-width (≈0.98/√n) for an accuracy measured on a');
  push('PROPER SUBSET, which is a sample of the eligible population. A set of 50 is a smoke check');
  push('only; differences smaller than its CI are noise. Score over a set with');
  push('`node bin/score.js --submission <file> --set 300`. The **official** `--set all` score is a');
  push('census of every eligible target, not a sample, so it carries no sampling error: its CI is 0');
  push('and the number is exact for this snapshot (what can still be off is the snapshot and answer');
  push('key themselves, which a sampling CI does not measure).', '');

  push('## Modifier reference', '');
  push('Modifiers are detected as character sequences (no head-glyph detection). The set is');
  push('**kit-owned and curated** (`src/modifiers/bliss-modifiers.js`); its membership, tiers, and');
  push('conditional exceptions originate from the BCI-AV head-glyph exclusions in bliss-svg-builder');
  push('(MPL-2.0), referenced not vendored.');
  push('');
  push(`- ${modifiers.count} modifier sequences across ${modifiers.categories.length} categories: ${modifiers.categories.join(', ')}.`);
  push('- Each entry has `gloss`, the symbol\'s own **dictionary** gloss, as recorded (its standalone');
  push('  sense; data-driven from the snapshot, e.g. B368 "group of, much of, many of, quantity of",');
  push('  but a curated override in the source may drop prefix-only senses), and `asPrefix`, how it');
  push('  reads **when prefixing** what follows (a hand-curated list; e.g. B100 → "any").');
  push(`- Conditional exceptions: ${modifiers.conditionalExceptions.map(([a, b]) => `${a} is not a modifier before ${b}`).join('; ')}.`);
  push('- `tier` (head-selection priority) is internal to the matcher/eligibility and is **not**');
  push('  surfaced in `buildContext`.');
  if (modifiers.knownGaps && modifiers.knownGaps.length) {
    push(`- Known coverage gaps: \`${modifiers.knownGaps.join('`, `')}\`, not yet recognized as a modifier (missing in the upstream head-glyph-exclusion source).`);
  }
  push('');

  push('## Indicator reference', '');
  push('Indicators are the grammatical diacritics on a Bliss character (tense, number, part of');
  push('speech, ...). Their meaning is taken from the kit\'s **curated** reference, NOT the BCI-AV');
  push('dictionary (which under-explains indicators and mis-marks some as non-preferred).');
  push(`Source: \`${indicators.$source}\``);
  push('');
  push(`- ${indicators.count} indicators across ${indicators.groups.length} groups: ${indicators.groups.join(', ')}.`);
  push('- Each carries `{ code, group, name, purpose }`; `buildContext().indicators` resolves the');
  push('  indicators present in a spelling to these.');
  push('');

  push('## Submission format', '');
  push('Each pipeline emits JSONL rows matching `schemas/submission.schema.json`:', '');
  push('```json');
  push('{"targetId":"B1167","candidates":["abuse","violence","force","assault","harm"],"runner":"my-gpt-run","promptVersion":"v1"}');
  push('```');
  push('Score with: `node bin/score.js --submission <file>.jsonl --set <50|100|300|1000|all>`', '');
  push('**At most one row per target**: JSON Schema can\'t express cross-row uniqueness for');
  push('JSONL, so the scorer enforces it: duplicates keep the last row and make the run');
  push('non-official (a duplicated denominator would not be comparable). Up to 5 candidates are');
  push('scored; rows with no parseable candidates count as a miss and are flagged.', '');

  return `${lines.join('\n')}\n`;
};

const ci = (n) => (0.98 / Math.sqrt(n) * 100).toFixed(1) + '%';

const sourceArgPath = () => {
  const i = process.argv.indexOf('--source');
  return i !== -1 && process.argv[i + 1] ? resolve(process.cwd(), process.argv[i + 1]) : null;
};

const main = async () => {
  // Default to the pinned snapshot; allow `--source <path>` to swap it for a new round.
  const sourcePath = sourceArgPath() || out('data/blissary-bliss-dictionary-export-2026-05-23.json');
  const sourceBuffer = await readFile(sourcePath);
  const kit = await loadKit({ sourcePath });
  const { dataset, modifiers, indicators } = kit;

  const targets = dataset.getEligibleTargets();
  const answers = targets.map((t) => dataset.answerKeyOf(t.targetId));
  const report = dataset.eligibilityReport();

  // Transparent answer-alias log: one row per target whose accepted-answer set was
  // expanded beyond its raw gloss (see src/rules/answer-aliases.js).
  const aliasRows = targets.map((t) => dataset.answerAliasOf(t.targetId)).filter(Boolean);
  const curatedRows = aliasRows.filter((a) => a.source === 'curated');
  const aliasStats = {
    count: aliasRows.length,
    formsAdded: aliasRows.reduce((n, a) => n + a.added.length, 0),
    curated: curatedRows.length
  };
  // Coverage guard: every suspect target (a tag a rule can't safely read) MUST have a
  // frozen model judgement; otherwise it silently falls back to the lossy rule. Surface
  // any gaps loudly so the curation can never be quietly incomplete (DECISIONS §15).
  const curationGaps = aliasRows.filter((a) => a.source !== 'curated' && needsCuration(a.base));
  const aliasExample = (id) => {
    const row = aliasRows.find((a) => a.targetId === id);
    if (!row) return null;
    const extra = [...new Set(row.added.map((r) => r.form))];
    return { id, base: row.base.join(', '), extra: extra.join(', ') };
  };
  const aliasExamples = ['B1164', 'B3996', 'B1280', 'B1200', 'B1349']
    .map(aliasExample)
    .filter(Boolean);

  // Build nested, stratified-by-pos subsets. The sampler needs pos (from the
  // hidden key) to stratify; the written rows stay sealed.
  const posById = new Map(answers.map((a) => [a.targetId, a.pos]));
  const ordered = orderTargetsStratified(
    targets.map((t) => ({
      ...t,
      pos: posById.get(t.targetId) || '',
      charBucket: charBucketOf(t.charCount)
    })),
    { seed: SET_SEED, stratifyBy: STRATIFY_BY }
  );
  const subsets = buildNestedSubsets(ordered, SET_SIZES);
  const setMeta = [];
  for (const subset of subsets) {
    const file = setFileName(subset.size);
    await writeJsonl(out(`data/sets/${file}`), subset.items.map(seal));
    setMeta.push({ size: subset.size, count: subset.count, file, ci: ci(subset.count) });
  }

  const manifest = {
    kitVersion: KIT_VERSION,
    sourceFile: basename(sourcePath),
    sha256: sha256(sourceBuffer),
    generatedAt: new Date().toISOString(),
    counts: {
      total: report.total,
      eligible: report.eligible,
      excludedByPrimaryRule: report.byFailedRule,
      failsRuleIndependent: report.byRuleIndependent
    },
    sets: { seed: SET_SEED, stratifyBy: STRATIFY_BY, sizes: SET_SIZES, files: setMeta.map((s) => ({ size: s.size, count: s.count, file: s.file })) },
    modifiers: { count: modifiers.count, categories: modifiers.categories.length },
    indicators: { count: indicators.count, groups: indicators.groups.length },
    eligibilityRuleIds: eligibilityRules.map((r) => r.id),
    answerKeyRuleIds: answerKeyRules.map((r) => r.id),
    normalizationRuleIds: normalizationRules.map((r) => r.id),
    answerAliases: aliasStats
  };

  await writeJsonl(out('data/targets.jsonl'), targets);
  await writeJsonl(out('data/answers.jsonl'), answers);
  await writeJsonl(out('data/answer-aliases.jsonl'), aliasRows);
  await writeJson(out('data/manifest.json'), manifest);
  await writeFile(
    out('CONTRACT.md'),
    renderContract({ manifest, report, modifiers, indicators, sets: setMeta, aliases: aliasStats, aliasExamples }),
    'utf8'
  );

  console.log('Wrote targets.jsonl, answers.jsonl, answer-aliases.jsonl, manifest.json, CONTRACT.md, and data/sets/*.jsonl');
  console.log(`  ${report.eligible} eligible targets of ${report.total} entries`);
  console.log(`  answer aliases: ${aliasStats.count} targets expanded, +${aliasStats.formsAdded} spellings (${aliasStats.curated} curated)`);
  if (curationGaps.length) {
    console.warn(`  ⚠ ${curationGaps.length} suspect target(s) lack a curation entry, falling back to the lossy rule:`);
    console.warn(`     ${curationGaps.slice(0, 10).map((g) => g.targetId).join(', ')}${curationGaps.length > 10 ? ', …' : ''}`);
    console.warn('     (regenerate the curation, see docs/answer-alias-curation.md)');
  } else {
    console.log('  curation coverage: every suspect target is judged ✓');
  }
  console.log(`  sets: ${setMeta.map((s) => `${s.size}=${s.count}`).join(', ')} (stratified by pos × length, nested)`);
  // Balance check: worst per-category deviation of the smallest set vs the full mix.
  const dist = (items, key) => items.reduce((m, it) => m.set(it[key], (m.get(it[key]) || 0) + 1), new Map());
  const maxDev = (sub, key) => {
    const full = dist(ordered, key);
    const s = dist(sub, key);
    let d = 0;
    for (const k of full.keys()) d = Math.max(d, Math.abs(full.get(k) / ordered.length - (s.get(k) || 0) / sub.length));
    return (d * 100).toFixed(1);
  };
  const fifty = subsets.find((x) => x.size === 50);
  if (fifty) console.log(`  balance @50: pos within ${maxDev(fifty.items, 'pos')}pp, length within ${maxDev(fifty.items, 'charBucket')}pp of full`);
  console.log(`  snapshot sha256: ${manifest.sha256.slice(0, 16)}…`);
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
