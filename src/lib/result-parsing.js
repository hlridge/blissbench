/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
/**
 * Tolerant extraction of a candidate list from a model response. Accepts an
 * array, a JSON-array string, an object carrying a `candidates` array, or prose
 * with an embedded JSON array. Returns a clean string[] and NEVER throws: any
 * value it cannot turn into strings yields [].
 *
 * Vendored from blissword-ai-interpreter so the kit stays self-contained.
 */

// Collect every top-level, bracket-balanced `[...]` span in one O(n) pass (no
// per-bracket rescan, so a pathological input cannot cause quadratic work). The
// spans are validated by JSON.parse afterwards, so a `]` inside a string value
// is the only case this misses, which is rare for a list of English words.
const topLevelArraySpans = (text) => {
  const spans = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '[') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === ']' && depth > 0) {
      depth -= 1;
      if (depth === 0) {
        spans.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return spans;
};

export const parseCandidateArray = (value) => {
  // An array: keep genuine strings, flatten one level of string arrays, and drop
  // everything else (objects, null/undefined, deeper nesting). Non-strings are
  // never template-stringified, so a deeply nested array cannot overflow the
  // stack via Array.prototype.toString.
  if (Array.isArray(value)) {
    return value
      .flatMap((item) =>
        typeof item === 'string'
          ? [item.trim()]
          : Array.isArray(item)
            ? item.filter((x) => typeof x === 'string').map((x) => x.trim())
            : []
      )
      .filter(Boolean);
  }
  if (typeof value !== 'string') return [];

  const trimmed = value.trim();
  if (!trimmed) return [];

  // Whole string is JSON: an array, or an object that carries a `candidates` array.
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parseCandidateArray(parsed);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.candidates)) {
      return parseCandidateArray(parsed.candidates);
    }
  } catch {
    /* not whole-string JSON; fall through to embedded-array extraction */
  }

  // Prose with an embedded JSON array: try each balanced `[...]` span from the
  // end and return the LAST one that parses to a usable list (a model that
  // explains itself first puts the final answer array last).
  const spans = topLevelArraySpans(trimmed);
  for (let i = spans.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(spans[i]);
      if (Array.isArray(parsed)) {
        const out = parseCandidateArray(parsed);
        if (out.length) return out;
      }
    } catch {
      /* this span is not valid JSON; try an earlier one */
    }
  }
  return [];
};
