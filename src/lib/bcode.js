/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
/**
 * B-code parsing & spelling normalization.
 *
 * A "B-code" here is a Blissary ID (e.g. B398), the character codes used on blissary.com and
 * in Bliss SVG Builder; it is NOT the entry's separate `bciAvId`. A Bliss "word" spelling is a
 * `/`-joined run of them:
 *   B804/B401            two characters
 *   B398;B86/B688        a character-level indicator (;) on the first character
 *   B398/B688;;B86       a word-level indicator (;;) after the body
 *
 * This module is dependency-free on purpose: it is the foundation of the kit's
 * querying and rule layers, and must run anywhere with zero install.
 *
 * Vendored from blissword-ai-interpreter/src/lib/bcode.js (kept self-contained
 * so the kit can be zipped and shared without the parent repo).
 */

const BCODE_TOKEN_RE = /^B\d+$/i;

// The only two indicators that are TRUE character-level sense markers
// (concrete/thing vs. abstract). Everything else after ';' is word-level.
const TRUE_CHARACTER_INDICATOR_CODES = new Set(['B6436', 'B97']);

const unique = (values) => [...new Set(values.filter(Boolean))];

export const normalizeBCodeToken = (token) => {
  const trimmed = `${token || ''}`.trim();
  const match = trimmed.match(/^B(\d+)$/i);
  if (!match) {
    throw new Error(`Invalid B-code token: ${token}`);
  }
  return `B${Number(match[1])}`;
};

const normalizeBCodeIds = (spelling) => {
  if (!spelling || typeof spelling !== 'string') {
    throw new Error('Expected a non-empty spelling string.');
  }
  return spelling
    .trim()
    .replace(/\s+/g, '')
    .replace(/B(\d+)/gi, (_, id) => `B${Number(id)}`);
};

export const normalizeSpelling = (spelling) => parseBCodeWord(spelling).spelling;

const splitOnce = (value, separator) => {
  const index = value.indexOf(separator);
  if (index === -1) return [value, ''];
  return [value.slice(0, index), value.slice(index + separator.length)];
};

const parseIndicatorTokens = (value) => {
  if (!value) return [];
  return unique(
    value
      .split(';')
      .map((part) => part.replace(/^!/, '').trim())
      .filter(Boolean)
      .map(normalizeBCodeToken)
  );
};

const composeCharacterSpelling = (base, characterIndicators) =>
  [base, ...characterIndicators].join(';');

const parseCharacter = (value, index) => {
  const parts = value.split(';').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    throw new Error(`Empty character at position ${index}.`);
  }

  const [base, ...indicatorParts] = parts;
  const indicators = parseIndicatorTokens(indicatorParts.join(';'));
  const characterIndicators = indicators.filter((indicator) =>
    TRUE_CHARACTER_INDICATOR_CODES.has(indicator)
  );
  const wordLevelIndicators = indicators.filter(
    (indicator) => !TRUE_CHARACTER_INDICATOR_CODES.has(indicator)
  );
  const baseSpelling = normalizeBCodeToken(base);

  return {
    index,
    baseSpelling,
    spelling: composeCharacterSpelling(baseSpelling, characterIndicators),
    indicators: characterIndicators,
    wordLevelIndicators
  };
};

/**
 * Parse a single B-code word spelling into a canonical, structured form.
 * Throws if the spelling is not a B-code word (e.g. a shape/primitive code).
 */
export const parseBCodeWord = (spelling) => {
  const normalized = normalizeBCodeIds(spelling);

  if (normalized.includes('//')) {
    throw new Error('Expected a single Bliss word; word separators (//) are not supported here.');
  }

  const [body, wordIndicatorPart] = splitOnce(normalized, ';;');
  const characterParts = body.split('/').filter(Boolean);
  if (characterParts.length === 0) {
    throw new Error(`No characters found in spelling: ${spelling}`);
  }

  const characters = characterParts.map(parseCharacter);
  const wordIndicators = parseIndicatorTokens(wordIndicatorPart);
  const movedWordIndicators = characters.flatMap((character) => character.wordLevelIndicators);
  const allWordIndicators = unique([...movedWordIndicators, ...wordIndicators]);
  const bodySpelling = characters.map((character) => character.spelling).join('/');
  const canonicalSpelling = allWordIndicators.length > 0
    ? `${bodySpelling};;${allWordIndicators.join(';')}`
    : bodySpelling;
  const characterIndicators = characters.flatMap((character) =>
    character.indicators.map((indicator) => ({
      spelling: indicator,
      scope: 'character',
      characterIndex: character.index
    }))
  );

  return {
    spelling: canonicalSpelling,
    bodySpelling,
    characters,
    indicators: [
      ...characterIndicators,
      ...allWordIndicators.map((indicator) => ({
        spelling: indicator,
        scope: 'whole word'
      }))
    ]
  };
};

/**
 * Enumerate every CONTIGUOUS subword span of a parsed word.
 * `B1/B2/B3` → B1, B2, B3, B1/B2, B2/B3 (and B1/B2/B3 if includeFull).
 * Noncontiguous spans like B1/B3 are intentionally never produced.
 */
export const buildContiguousSpans = (parsedWord, options = {}) => {
  const { includeFull = false, minLength = 1 } = options;
  const characters = parsedWord.characters.map((character) => character.spelling);
  const spans = [];

  for (let start = 0; start < characters.length; start += 1) {
    for (let end = start + minLength; end <= characters.length; end += 1) {
      const isFull = start === 0 && end === characters.length;
      if (!includeFull && isFull) continue;
      spans.push({
        kind: 'contiguous-subword',
        span: [start, end],
        spelling: characters.slice(start, end).join('/'),
        length: end - start
      });
    }
  }

  return spans;
};

export const isBCodeToken = (value) => BCODE_TOKEN_RE.test(value);

export const isTrueCharacterIndicator = (value) =>
  TRUE_CHARACTER_INDICATOR_CODES.has(normalizeBCodeToken(value));

/**
 * True when `code` is a B-code WORD spelling (all '/'-separated parts are
 * B-codes), as opposed to a shape/primitive code like 'VL6:0,8;DOT:0,16'.
 */
export const isBCodeWordSpelling = (code) => {
  if (!code || typeof code !== 'string') return false;
  try {
    parseBCodeWord(code);
    return true;
  } catch {
    return false;
  }
};
