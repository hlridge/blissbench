#!/usr/bin/env node
/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
/**
 * score.js: the shared, frozen judge (thin CLI over `createReport`).
 *
 * Takes a submission (a pipeline's output) + the hidden answer key and produces
 * comparable metrics. Normalization, metrics, dedup, coverage and provenance all
 * live in src/ (createReport / scoring-rules), so this file is just I/O + args.
 *
 * Run:
 *   node bin/score.js --submission results/my-run.jsonl            # full set
 *   node bin/score.js --submission results/my-run.jsonl --set 100  # a named set
 *   node bin/score.js --list-sets                                  # what sets exist
 *
 * Submission rows (JSONL): { targetId, candidates: string[1..5], ... }
 *   If `candidates` is missing, `rawResponseText` is parsed as a fallback.
 */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReport, formatReport } from '../src/index.js';

const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SETS_DIR = resolve(KIT_ROOT, 'data/sets');

const parseArgs = (argv) => {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
};

const readJsonl = async (filePath) => {
  const raw = await readFile(filePath, 'utf8');
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, i) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSONL at ${filePath}:${i + 1}: ${error.message}`);
      }
    });
};

// The available test sets (label + size), preferring the manifest, falling back
// to scanning data/sets/. Keeps "which sets exist?" answerable from the CLI.
const availableSets = async () => {
  try {
    const manifest = JSON.parse(await readFile(resolve(KIT_ROOT, 'data/manifest.json'), 'utf8'));
    if (manifest.sets && Array.isArray(manifest.sets.files)) {
      return manifest.sets.files.map((f) => ({ label: String(f.size), count: f.count }));
    }
  } catch {
    // fall through to a directory scan
  }
  try {
    const files = await readdir(SETS_DIR);
    return files
      .map((f) => /^set-(.+)\.jsonl$/.exec(f))
      .filter(Boolean)
      .map((m) => ({ label: m[1], count: null }));
  } catch {
    return [];
  }
};

const setsLine = (sets) =>
  sets.length
    ? sets.map((s) => (s.count == null ? s.label : `${s.label} (${s.count})`)).join(', ')
    : '(none built, run: node bin/build-manifest.js)';

const usage = async () => {
  const sets = await availableSets();
  return [
    'Usage: node bin/score.js --submission <file.jsonl> [--set <name>] [--output <file>]',
    '',
    'Options:',
    '  --submission <file.jsonl>  the rows to score (required)',
    '  --set <name>               score against a named test set (the denominator).',
    `                             Available sets live in data/sets/ : ${setsLine(sets)}`,
    '                             Omit --set to score against ALL eligible targets.',
    '  --targets <file.jsonl>     use a custom denominator (rows with a targetId)',
    '  --answers <file.jsonl>     answer key (default data/answers.jsonl)',
    '  --output <file.jsonl>      where to write scored rows (default: <submission>.scored.jsonl)',
    '  --list-sets                print the available sets and exit',
    '',
    'An OFFICIAL score is "--set all" with full coverage and no duplicate rows.'
  ].join('\n');
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));

  if (args['list-sets']) {
    console.log(`Available test sets (data/sets/): ${setsLine(await availableSets())}`);
    return;
  }
  if (args.help || !args.submission || args.submission === true) {
    console.log(await usage());
    if (!args.help) process.exitCode = 1; // missing required --submission
    return;
  }

  const submissionPath = resolve(String(args.submission));
  const answersPath = resolve(
    args.answers && args.answers !== true ? String(args.answers) : resolve(KIT_ROOT, 'data/answers.jsonl')
  );
  const outputPath = resolve(
    args.output && args.output !== true
      ? String(args.output)
      : submissionPath.replace(/\.jsonl$/i, '') + '.scored.jsonl'
  );

  // Denominator: a custom --targets file, a named --set, or all eligible targets.
  const hasTargets = args.targets && args.targets !== true;
  const hasSet = args.set && args.set !== true;
  if (hasTargets && hasSet) {
    throw new Error('Pass only one of --targets or --set. --targets is a custom denominator file; --set selects a named set.');
  }
  let setPath = null;
  let setLabel = 'all';
  if (hasTargets) {
    setPath = resolve(String(args.targets));
    setLabel = 'custom';
  } else if (hasSet) {
    setLabel = String(args.set);
    // Keep the label a plain token so it can only name a file inside data/sets/; a
    // value like "all/../../answers" would otherwise resolve to the hidden answer key.
    if (!/^[A-Za-z0-9._-]+$/.test(setLabel)) {
      const sets = await availableSets();
      throw new Error(`Unknown set "${setLabel}". Available sets: ${setsLine(sets)}. (Use --list-sets.)`);
    }
    setPath = resolve(SETS_DIR, `set-${setLabel}.jsonl`);
  }

  // Never write scored output on top of a frozen artifact. Default output goes to
  // results/; only an explicit --output could collide, so guard both files.
  const DATA_DIR = resolve(KIT_ROOT, 'data');
  const summaryPath = outputPath.replace(/\.jsonl$/i, '') + '.summary.json';
  const guardWrite = (p) => {
    const r = resolve(p);
    if (r === DATA_DIR || r.startsWith(DATA_DIR + sep)) {
      throw new Error(`Refusing to write inside the frozen data dir: ${r}. Write scored output to results/ instead.`);
    }
  };
  guardWrite(outputPath);
  guardWrite(summaryPath);

  const submission = await readJsonl(submissionPath);
  const answers = await readJsonl(answersPath);

  let universe = null; // null = all answer keys
  if (setPath) {
    try {
      universe = (await readJsonl(setPath)).map((r) => r.targetId);
    } catch (error) {
      if (error.code === 'ENOENT' && args.set) {
        const sets = await availableSets();
        throw new Error(`Unknown set "${setLabel}". Available sets: ${setsLine(sets)}. (Use --list-sets.)`);
      }
      throw error;
    }
  }

  let manifest = null;
  try {
    manifest = JSON.parse(await readFile(resolve(KIT_ROOT, 'data/manifest.json'), 'utf8'));
  } catch {
    // manifest optional; provenance fields stay null
  }

  const { summary, scored } = createReport(submission, answers, { set: setLabel, universe, manifest });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${scored.map((s) => JSON.stringify(s)).join('\n')}\n`, 'utf8');
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  console.log(formatReport(summary));
  console.log(`  wrote ${outputPath}`);
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
