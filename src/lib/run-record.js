/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
/**
 * Run record: a durable, human-readable record of WHAT produced a score, written
 * automatically beside a run so you don't have to copy-paste your method by hand.
 *
 * Honest scope: this is a RECORD, not a replay button. A method usually calls a
 * model over the network, which can change, be retired, or answer non-deterministically,
 * so a saved record cannot guarantee identical numbers later. What it CAN do is keep,
 * in one place: your method's source (the recipe), the run's details (date, set,
 * snapshot sha256, kit version, runner, promptVersion, model), and — optionally — the
 * exact prompt sent and raw answer for each word (the real material for re-grading or
 * eyeballing without calling the model again).
 *
 * Split so the logic is testable: `buildRunRecord` is pure (no fs, no clock — you inject
 * `ranAt` and the already-read method sources); `writeRunRecord` is the thin file writer;
 * `recordRun` is the convenience that reads the method file(s), stamps the time, and writes.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { createHash } from 'node:crypto';

const sha256Hex = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * Pure: assemble the run-record object. No I/O and no clock — `ranAt` (ISO string) and
 * `methods` (`[{ path, source }]`, already read) are injected, so the output is a pure
 * function of its inputs (and therefore easy to test).
 */
export const buildRunRecord = ({ runner, promptVersion, set, count, ranAt, manifest, model, methods }) => ({
  kind: 'blissbench-run-record/1',
  ranAt: ranAt ?? null,
  runner: runner ?? null,
  promptVersion: promptVersion ?? null,
  set: { name: set ?? null, count: count ?? null },
  snapshot: manifest
    ? { sha256: manifest.sha256 ?? null, kitVersion: manifest.kitVersion ?? null, sourceFile: manifest.sourceFile ?? null }
    : null,
  model: model ?? null,
  // The recipe itself, copied in. `sha256` lets you confirm later that a file on disk is
  // byte-for-byte the one that ran; `source` is the full text so the record is self-contained.
  method: (methods || []).map((m) => ({
    path: m.path,
    bytes: Buffer.byteLength(m.source, 'utf8'),
    sha256: sha256Hex(m.source),
    source: m.source
  })),
  // How many word-level interactions are in the sibling .interactions.jsonl (0 = none kept).
  interactions: 0
});

/**
 * Thin I/O: write `<dir>/<name>.run.json` (the record), and, when `interactions` are given,
 * `<dir>/<name>.interactions.jsonl` (one row per word: prompt / rawResponseText / candidates).
 * Returns the paths written.
 */
export const writeRunRecord = async (record, interactions, { dir, name }) => {
  await mkdir(dir, { recursive: true });
  const base = resolve(dir, name);
  const recordPath = `${base}.run.json`;
  const kept = interactions && interactions.length ? interactions : null;
  const stamped = { ...record, interactions: kept ? kept.length : 0 };
  await writeFile(recordPath, `${JSON.stringify(stamped, null, 2)}\n`, 'utf8');

  let interactionsPath = null;
  if (kept) {
    interactionsPath = `${base}.interactions.jsonl`;
    await writeFile(interactionsPath, `${kept.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');
  }
  return { recordPath, interactionsPath };
};

// Filesystem-safe timestamp (Windows forbids ':' in names):
//   2026-06-04T03:40:41.846Z  ->  2026-06-04T034041846Z
const fsTimestamp = (iso) => iso.replace(/:/g, '').replace(/\.(\d+)Z$/, '$1Z');

/**
 * Base file name for a run's `.run.json` + `.interactions.jsonl`. Timestamped by default
 * (`<name>.<stamp>`), so re-running the same run writes a NEW file instead of overwriting an
 * earlier record — the date is in the name as well as inside the record. Pure (the timestamp
 * is passed in). Pass `timestamped=false` for a stable, overwrite-in-place name.
 */
export const runRecordBaseName = (name, ranAt, timestamped = true) =>
  timestamped && ranAt ? `${name}.${fsTimestamp(ranAt)}` : `${name}`;

/**
 * Convenience: read the method file(s), stamp the time, and write the record + interactions.
 *
 * @param {object}   o
 * @param {string}   o.runner          a name for the method (also the default file name)
 * @param {string}   o.promptVersion   bump when the prompt/method changes
 * @param {string}   o.set             the test-set name that was answered
 * @param {object[]} o.rows            per-target rows; each may carry { prompt, rawResponseText, candidates }
 * @param {object}   [o.manifest]      data/manifest.json (for snapshot sha256 / kitVersion)
 * @param {string}   [o.model]         the model you used, if any
 * @param {string[]} [o.methodPaths]   the file(s) that ARE your method (copied into the record)
 * @param {string}   [o.dir='runs']    where to write (a folder you commit, not throwaway results/)
 * @param {string}   [o.name]          base file name (defaults to runner)
 * @param {string}   [o.ranAt]         ISO timestamp (defaults to now)
 * @param {boolean}  [o.keepInteractions=true]  also write the per-word prompts/answers sidecar
 * @param {boolean}  [o.timestamped=true]       put the timestamp in the file name (no overwrite)
 */
export const recordRun = async ({
  runner, promptVersion, set, rows = [], manifest, model,
  methodPaths = [], dir = 'runs', name, ranAt, keepInteractions = true, timestamped = true
}) => {
  const stampedAt = ranAt || new Date().toISOString();
  const methods = [];
  for (const p of methodPaths) {
    methods.push({ path: basename(p), source: await readFile(p, 'utf8') });
  }
  const record = buildRunRecord({
    runner, promptVersion, set, count: rows.length,
    ranAt: stampedAt, manifest, model, methods
  });
  const interactions = keepInteractions
    ? rows.map((r) => ({
        targetId: r.targetId,
        ...(r.prompt !== undefined ? { prompt: r.prompt } : {}),
        ...(r.rawResponseText !== undefined ? { rawResponseText: r.rawResponseText } : {}),
        candidates: r.candidates
      }))
    : null;
  const base = runRecordBaseName(name || runner || 'run', stampedAt, timestamped);
  return writeRunRecord(record, interactions, { dir, name: base });
};
