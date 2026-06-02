/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
/**
 * Deterministic, stratified, NESTED ordering for test subsets.
 *
 * Goal: build fixed subsets (50 ⊂ 100 ⊂ 300 ⊂ 1000 ⊂ all) such that
 *   - every run gets identical sets (deterministic, seed-based),
 *   - each smaller set is a prefix of the larger (nested),
 *   - every prefix mirrors the full composition (stratified), so even the 50-set
 *     is representative rather than accidentally all-nouns or all-short-words.
 *
 * Stratify by one OR MORE keys: `stratifyBy` may be a string (e.g. 'pos') or an
 * array (e.g. ['pos','charBucket']). With several keys, the stratum is their
 * JOINT value, so every prefix mirrors the joint distribution, and therefore
 * each marginal (same pos mix AND same length mix) too.
 *
 * Method: shuffle within each stratum (seeded), give each item a fractional
 * position (i+0.5)/strataSize, then sort everything by that fraction. Interleaving
 * by fractional position keeps every prefix proportional AND ordered once → nested.
 */

const hashString = (value) => {
  let h = 2166136261 >>> 0;
  const text = `${value}`;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const shuffleDeterministic = (items, seed) => {
  const out = [...items];
  const rnd = mulberry32(hashString(seed));
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

/**
 * @param items   array of objects, each with a stratify key and `targetId`
 * @param options { seed, stratifyBy }
 * @returns the items in a stable, stratified, nestable order
 */
export const orderTargetsStratified = (items, options = {}) => {
  const { seed = 'blissbench-v1', stratifyBy = 'pos' } = options;
  const keys = Array.isArray(stratifyBy) ? stratifyBy : [stratifyBy];
  const stratumKey = (item) => keys.map((k) => `${item[k] ?? ''}`).join('|');

  const groups = new Map();
  for (const item of items) {
    const key = stratumKey(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  const ranked = [];
  for (const [key, arr] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const shuffled = shuffleDeterministic(arr, `${seed}|${key}`);
    shuffled.forEach((item, i) => {
      ranked.push({
        item,
        frac: (i + 0.5) / shuffled.length,
        tie: hashString(`${seed}|tie|${item.targetId}`)
      });
    });
  }

  ranked.sort((a, b) => a.frac - b.frac || a.tie - b.tie);
  return ranked.map((r) => r.item);
};

/**
 * Build nested prefix subsets from an ordered list.
 * @returns [{ size, count, items }] including an "all" entry.
 */
export const buildNestedSubsets = (orderedItems, sizes) => {
  const subsets = [];
  for (const size of sizes) {
    const count = size === 'all' ? orderedItems.length : Math.min(size, orderedItems.length);
    subsets.push({ size, count, items: orderedItems.slice(0, count) });
  }
  return subsets;
};
