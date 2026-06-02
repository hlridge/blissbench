/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
/**
 * Curated indicator reference: the kit's AUTHORITATIVE source for what each
 * Bliss indicator MEANS.
 *
 * Indicators are diacritic markers placed above a Bliss character to convey
 * grammatical meaning (tense, number, part of speech, ...). The bundled dictionary
 * export explains them inconsistently (e.g. gloss "indicator (action)") and even
 * mis-marks some as non-preferred, so the kit deliberately does NOT take
 * indicator meaning from the dictionary. This hand-curated table, transcribed
 * from the bliss-svg-builder "Indicators Reference"
 * (https://hlridge.github.io/bliss-svg-builder/reference/indicators-reference),
 * is the source of truth instead.
 *
 * This is a SOURCE file (hand-edited). `bin/build-indicators.js` compiles it to
 * the frozen `data/indicators.json`; never hand-edit that generated file.
 *
 * Fields:
 *   code     the indicator's B-code (matches `;`/`;;` indicator tokens in a spelling)
 *   group    Nominal | Verbal | Adjectival | Not planned for Unicode
 *   name     the canonical indicator name
 *   purpose  a short, plain-English description of its grammatical effect
 */

export const indicatorGroups = ['Nominal', 'Verbal', 'Adjectival', 'Not planned for Unicode'];

export const indicators = [
  // Nominal indicators
  { code: 'B99', group: 'Nominal', name: 'INDICATOR PLURAL', purpose: 'Marks plural' },
  { code: 'B5996', group: 'Nominal', name: 'INDICATOR DEFINITE PLURAL', purpose: 'Definite + plural combined' },
  { code: 'B904', group: 'Nominal', name: 'INDICATOR DEFINITE', purpose: 'Marks definiteness' },
  { code: 'B97', group: 'Nominal', name: 'INDICATOR THING', purpose: 'Marks concrete sense' },
  { code: 'B6436', group: 'Nominal', name: 'INDICATOR ABSTRACT', purpose: 'Marks abstract sense' },
  { code: 'B98', group: 'Nominal', name: 'INDICATOR PLURAL THING', purpose: 'Marks plural concrete sense' },
  { code: 'B5998', group: 'Nominal', name: 'INDICATOR DEFINITE PLURAL THING', purpose: 'Definite + plural + thing combined' },
  { code: 'B5997', group: 'Nominal', name: 'INDICATOR DEFINITE THING', purpose: 'Definite + thing combined' },

  // Verbal indicators
  { code: 'B81', group: 'Verbal', name: 'INDICATOR ACTION', purpose: 'Marks as action (verb)' },
  { code: 'B82', group: 'Verbal', name: 'INDICATOR ACTIVE', purpose: 'Marks active voice' },
  { code: 'B92', group: 'Verbal', name: 'INDICATOR PAST', purpose: 'Marks past tense' },
  { code: 'B928', group: 'Verbal', name: 'INDICATOR PRESENT', purpose: 'Marks present tense' },
  { code: 'B87', group: 'Verbal', name: 'INDICATOR FUTURE', purpose: 'Marks future tense' },
  { code: 'B903', group: 'Verbal', name: 'INDICATOR CONTINUOUS', purpose: 'Marks continuous aspect' },
  { code: 'B907', group: 'Verbal', name: 'INDICATOR IMPERATIVE', purpose: 'Marks imperative mood (commands)' },
  { code: 'B93', group: 'Verbal', name: 'INDICATOR PAST CONDITIONAL', purpose: 'Marks past conditional' },
  { code: 'B83', group: 'Verbal', name: 'INDICATOR PRESENT CONDITIONAL', purpose: 'Marks present conditional' },
  { code: 'B88', group: 'Verbal', name: 'INDICATOR FUTURE CONDITIONAL', purpose: 'Marks future conditional' },
  { code: 'B95', group: 'Verbal', name: 'INDICATOR PAST PASSIVE', purpose: 'Marks past passive voice' },
  { code: 'B91', group: 'Verbal', name: 'INDICATOR PASSIVE', purpose: 'Marks passive voice' },
  { code: 'B89', group: 'Verbal', name: 'INDICATOR FUTURE PASSIVE', purpose: 'Marks future passive voice' },
  { code: 'B94', group: 'Verbal', name: 'INDICATOR PAST PASSIVE CONDITIONAL', purpose: 'Marks past passive conditional' },
  { code: 'B96', group: 'Verbal', name: 'INDICATOR PRESENT PASSIVE CONDITIONAL', purpose: 'Marks present passive conditional' },
  { code: 'B90', group: 'Verbal', name: 'INDICATOR FUTURE PASSIVE CONDITIONAL', purpose: 'Marks future passive conditional' },

  // Adjectival indicators
  { code: 'B85', group: 'Adjectival', name: 'INDICATOR DESCRIPTION BEFORE THE FACT', purpose: 'Marks as description (potential/ability)' },
  { code: 'B86', group: 'Adjectival', name: 'INDICATOR DESCRIPTION', purpose: 'Marks as description (adjective/adverb)' },
  { code: 'B84', group: 'Adjectival', name: 'INDICATOR DESCRIPTION AFTER THE FACT', purpose: 'Marks as description (completed action)' },
  { code: 'B911', group: 'Adjectival', name: 'INDICATOR PAST PARTICIPLE', purpose: 'Marks past participle form' },
  { code: 'B914', group: 'Adjectival', name: 'INDICATOR PRESENT PARTICIPLE', purpose: 'Marks present participle form' },
  { code: 'B912', group: 'Adjectival', name: 'INDICATOR PAST PERFECTIVE PARTICIPLE', purpose: 'Marks past perfective participle form' },
  { code: 'B902', group: 'Adjectival', name: 'INDICATOR DESCRIPTION OF ACTION', purpose: 'Marks as description of action (adverb)' },

  // Indicators not planned for Unicode
  { code: 'B908', group: 'Not planned for Unicode', name: 'INDICATOR INDEFINITE', purpose: 'Marks indefiniteness' },
  { code: 'B910', group: 'Not planned for Unicode', name: 'INDICATOR DIRECT OBJECT', purpose: 'Marks direct object role' },
  { code: 'B6439', group: 'Not planned for Unicode', name: 'INDICATOR INDIRECT OBJECT', purpose: 'Marks indirect object role' },
  { code: 'B905', group: 'Not planned for Unicode', name: 'INDICATOR FEMININE', purpose: 'Marks feminine gender' },
  { code: 'B909', group: 'Not planned for Unicode', name: 'INDICATOR NEUTER', purpose: 'Marks neuter gender' },
  { code: 'B906', group: 'Not planned for Unicode', name: 'INDICATOR FIRST PERSON', purpose: 'Marks first person' },
  { code: 'B915', group: 'Not planned for Unicode', name: 'INDICATOR SECOND PERSON', purpose: 'Marks second person' },
  { code: 'B916', group: 'Not planned for Unicode', name: 'INDICATOR THIRD PERSON', purpose: 'Marks third person' },
  { code: 'B913', group: 'Not planned for Unicode', name: 'INDICATOR POSSESSIVE', purpose: 'Marks possessive' },
  { code: 'B992', group: 'Not planned for Unicode', name: 'INDICATOR DIMINUTIVE', purpose: 'Marks diminutive meaning' }
];
