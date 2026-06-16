import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCandidates } from '../test_models/test_ollama.js';

// --- JSON array (primary strategy) ---

test('json array: bare array', () => {
  assert.deepEqual(
    extractCandidates('["apple", "pear", "fruit", "food", "plant"]'),
    ['apple', 'pear', 'fruit', 'food', 'plant'],
  );
});

test('json array: embedded in prose', () => {
  assert.deepEqual(
    extractCandidates('Here are my guesses: ["apple", "pear", "fruit", "food", "plant"]\nHope that helps!'),
    ['apple', 'pear', 'fruit', 'food', 'plant'],
  );
});

test('json array: caps at 5', () => {
  assert.equal(
    extractCandidates('["apple", "pear", "fruit", "food", "plant", "extra"]').length,
    5,
  );
});

test('json array: fewer than n', () => {
  assert.deepEqual(
    extractCandidates('["apple", "pear"]'),
    ['apple', 'pear'],
  );
});

test('json array preferred over numbered list', () => {
  assert.deepEqual(
    extractCandidates('["apple", "pear", "fruit", "food", "plant"]\n1. something\n2. else'),
    ['apple', 'pear', 'fruit', 'food', 'plant'],
  );
});

// --- Numbered list (fallback strategy) ---

test('numbered list: dot separator', () => {
  assert.deepEqual(
    extractCandidates('1. apple\n2. pear\n3. fruit\n4. food\n5. plant'),
    ['apple', 'pear', 'fruit', 'food', 'plant'],
  );
});

test('numbered list: paren separator', () => {
  assert.deepEqual(
    extractCandidates('1) apple\n2) pear\n3) fruit\n4) food\n5) plant'),
    ['apple', 'pear', 'fruit', 'food', 'plant'],
  );
});

test('numbered list: caps at 5', () => {
  assert.equal(
    extractCandidates('1. apple\n2. pear\n3. fruit\n4. food\n5. plant\n6. extra').length,
    5,
  );
});

// --- First lines (final fallback) ---

test('fallback: first lines', () => {
  assert.deepEqual(
    extractCandidates('apple\npear\nfruit\nfood\nplant'),
    ['apple', 'pear', 'fruit', 'food', 'plant'],
  );
});

test('fallback: skips empty lines', () => {
  assert.deepEqual(
    extractCandidates('apple\n\npear\n\nfruit\n\nfood\n\nplant'),
    ['apple', 'pear', 'fruit', 'food', 'plant'],
  );
});

test('numbered list preferred over fallback', () => {
  assert.deepEqual(
    extractCandidates('Here are my guesses:\n1. apple\n2. pear\n3. fruit\n4. food\n5. plant\nHope that helps!'),
    ['apple', 'pear', 'fruit', 'food', 'plant'],
  );
});

test('fewer than n if model gave less', () => {
  assert.deepEqual(
    extractCandidates('1. apple\n2. pear'),
    ['apple', 'pear'],
  );
});
