/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
/**
 * Reporting: turn a submission + the answer key into a comparable score report.
 *
 * `createReport` is the one entry point both `bin/score.js` and the examples use,
 * so the scoring/coverage/provenance logic lives in exactly one place. It does no
 * file I/O: pass in already-parsed rows and it returns a plain `{ summary, scored }`.
 */
import { scoreRow, summarizeScores } from './rules/scoring-rules.js';
import { parseCandidateArray } from './lib/result-parsing.js';

const candidatesOf = (row) => {
  // parseCandidateArray tolerates an array, a JSON-array string, or prose with an
  // embedded array, and safely returns [] for anything unrecoverable, so route any
  // non-null `candidates` through it (a JSON-encoded string is then recovered too).
  if (row.candidates != null) return parseCandidateArray(row.candidates);
  if (row.rawResponseText != null) return parseCandidateArray(row.rawResponseText);
  return [];
};

/**
 * @param submission  array of submission rows: { targetId, candidates|rawResponseText, runner?, promptVersion? }
 * @param answers     array of answer-key rows:  { targetId, pos, answers, ... }
 * @param options     { set = 'custom', universe = <targetId[] | Set | null>, manifest = null }
 *                    universe is the scoring denominator (a named set's ids); null = all answer keys.
 * @returns { summary, scored }
 */
export const createReport = (submission, answers, options = {}) => {
  const { set = 'custom', universe = null, manifest = null } = options;
  const answersById = new Map(answers.map((a) => [a.targetId, a]));
  const universeSet =
    universe == null
      ? new Set(answers.map((a) => a.targetId))
      : universe instanceof Set
        ? universe
        : new Set(universe);

  // At most one row per target: duplicates (appends/retries) would inflate the
  // denominator and make the score non-comparable. Last row wins; count collisions.
  // A row with no usable targetId is malformed, not a duplicate, so keep it out of
  // the map (where every such row would otherwise collide on the `undefined` key).
  const byId = new Map();
  let duplicates = 0;
  let malformed = 0;
  for (const row of submission) {
    if (row.targetId == null || row.targetId === '') {
      malformed += 1;
      continue;
    }
    if (byId.has(row.targetId)) duplicates += 1;
    byId.set(row.targetId, row);
  }

  const scored = [];
  let emptyCandidates = 0;
  let overlongCandidates = 0;
  for (const row of byId.values()) {
    if (!universeSet.has(row.targetId)) continue;
    const answerKey = answersById.get(row.targetId);
    if (!answerKey) continue;
    const candidates = candidatesOf(row);
    if (candidates.length === 0) emptyCandidates += 1;
    if (candidates.length > 5) overlongCandidates += 1;
    scored.push({ ...scoreRow(candidates, answerKey), runner: row.runner, promptVersion: row.promptVersion });
  }

  const submittedIds = new Set(byId.keys());
  const missing = [...universeSet].filter((id) => !submittedIds.has(id));
  const extra = [...byId.values()].filter((r) => !universeSet.has(r.targetId)).map((r) => r.targetId);
  const fullCoverage = missing.length === 0;
  const official = fullCoverage && duplicates === 0 && malformed === 0 && set === 'all';
  const distinct = (key) => [...new Set(scored.map((s) => s[key]).filter((v) => v != null))];

  const summary = {
    set,
    official,
    manifestSha256: manifest ? manifest.sha256 : null,
    setSeed: manifest && manifest.sets ? manifest.sets.seed : null,
    kitVersion: manifest ? manifest.kitVersion : null,
    runner: distinct('runner'),
    promptVersion: distinct('promptVersion'),
    ...summarizeScores(scored),
    coverage: {
      universeTargets: universeSet.size,
      scored: scored.length,
      missing: missing.length,
      extra: extra.length,
      duplicates,
      malformed,
      emptyCandidates,
      overlongCandidates
    }
  };

  return { summary, scored };
};

const pct = (value) => `${(value * 100).toFixed(1)}%`;

/** Render a report summary as a human-readable, multi-line string. */
export const formatReport = (summary) => {
  const lines = [];
  lines.push(`Set "${summary.set}": scored ${summary.coverage.scored} of ${summary.coverage.universeTargets} targets`);
  lines.push(`  top1 ${pct(summary.top1)}   top5 ${pct(summary.top5)}   MRR ${summary.mrr.toFixed(4)}`);
  const posRows = Object.entries(summary.byPos || {}).filter(([, m]) => m.total > 0);
  if (posRows.length > 1) {
    for (const [pos, m] of posRows) {
      lines.push(`    ${(pos || '(none)').padEnd(12)} n=${String(m.total).padStart(4)}  top1 ${pct(m.top1)}  top5 ${pct(m.top5)}  MRR ${m.mrr.toFixed(4)}`);
    }
  }
  const c = summary.coverage;
  if (c.duplicates) lines.push(`  ⚠ ${c.duplicates} duplicate targetId row(s), kept the last of each (NOT an official score)`);
  if (c.malformed) lines.push(`  ⚠ ${c.malformed} row(s) had no targetId, ignored as malformed (NOT an official score)`);
  if (c.emptyCandidates) lines.push(`  ⚠ ${c.emptyCandidates} scored target(s) had no parseable candidates, counted as misses`);
  if (c.overlongCandidates) lines.push(`  ⚠ ${c.overlongCandidates} row(s) had more than 5 candidates, only the first 5 scored`);
  if (c.missing) {
    lines.push(`  ⚠ missing ${c.missing} of the set's targets, not full coverage of "${summary.set}"`);
  } else if (summary.official) {
    lines.push('  ✓ full coverage of all eligible targets, this is an official comparable score');
  } else if (summary.set === 'all') {
    lines.push('  ⚠ full coverage but NOT official (see warnings above)');
  } else {
    lines.push(`  ✓ full coverage of set "${summary.set}" (official score requires --set all)`);
  }
  if (c.extra) lines.push(`  ⚠ ${c.extra} submission rows are outside set "${summary.set}" (ignored)`);
  return lines.join('\n');
};
