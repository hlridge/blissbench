/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
/**
 * blissbench: the shared, frozen benchmark kit.
 *
 * Public surface. Two halves of the contract live here:
 *   - eligibility rules  ("what we test")   -> eligibilityRules, evaluateEligibility
 *   - scoring rules       ("how we score")  -> normalizationRules, metrics, scoreRow
 * plus the query layer used to build context.
 *
 * Typical use:
 *   import { loadKit } from 'blissbench';
 *   const kit = await loadKit();                  // reads bundled data/
 *   for (const t of kit.dataset.getEligibleTargets()) {
 *     // buildContext() is the leak-free, blessed path: spelling + curated modifiers
 *     // + curated indicators + subword helpers + siblings (no target-private data).
 *     const ctx = kit.dataset.buildContext(t.targetId);
 *     // ...build YOUR prompt from ctx, call YOUR model, emit a submission row...
 *   }
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createDataset } from './query/dataset.js';

export const KIT_VERSION = '0.3.0';

const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const paths = {
  root: KIT_ROOT,
  data: resolve(KIT_ROOT, 'data'),
  defaultSource: resolve(KIT_ROOT, 'data/blissary-bliss-dictionary-export-2026-05-23.json'),
  modifiers: resolve(KIT_ROOT, 'data/modifiers.json'),
  indicators: resolve(KIT_ROOT, 'data/indicators.json')
};

const readJson = async (filePath) => JSON.parse(await readFile(filePath, 'utf8'));

/**
 * Load the bundled dataset + modifier reference into a ready dataset.
 * Override `sourcePath`/`modifiersPath` to point at a different snapshot.
 */
export const loadKit = async (options = {}) => {
  const sourcePath = options.sourcePath || paths.defaultSource;
  const modifiersPath = options.modifiersPath || paths.modifiers;
  const indicatorsPath = options.indicatorsPath || paths.indicators;
  const source = await readJson(sourcePath);
  const modifiers = await readJson(modifiersPath);
  const indicators = await readJson(indicatorsPath);
  const entries = Array.isArray(source) ? source : source.data;
  if (!Array.isArray(entries)) {
    throw new Error(`Expected ${sourcePath} to be an array or an object with a "data" array.`);
  }
  const dataset = createDataset({ entries, modifiers, indicators });
  return {
    dataset,
    modifiers,
    indicators,
    source: { path: sourcePath, license: source.license, attribution: source.attribution },
    version: KIT_VERSION
  };
};

export { createDataset } from './query/dataset.js';
export {
  eligibilityRules,
  evaluateEligibility
} from './rules/eligibility-rules.js';
export {
  normalizationRules,
  answerKeyRules,
  metrics,
  scoreRow,
  summarizeScores,
  isVerbPartOfSpeech
} from './rules/scoring-rules.js';
export { createReport, formatReport } from './report.js';
export { buildRunRecord, writeRunRecord, recordRun, runRecordBaseName } from './lib/run-record.js';
export {
  parseBCodeWord,
  normalizeSpelling,
  buildContiguousSpans,
  isBCodeWordSpelling
} from './lib/bcode.js';
export { getAnswers, getAnswerKey, getExplanation, normalizeRawEntry } from './lib/entry.js';
export { expandAnswerKey, needsCuration, DIALECT_PAIRS } from './rules/answer-aliases.js';
export { CURATED_ALIASES, CURATION_META } from './rules/answer-alias-curation.js';
export {
  findModifierMatches,
  findLeadingModifierRun,
  findFullModifierMatch,
  setModifierReference
} from './modifiers/match.js';
