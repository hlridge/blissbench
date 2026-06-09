/*
 * prompt-templates.js — define one or more prompt templates for testing SLMs.
 *
 * Each entry: { name: string, build: (context) => string }
 *   - name:  used as the output filename (test_models/prompts/<name>.jsonl)
 *   - build: receives the object from kit.dataset.buildContext(targetId)
 *            (same shape as in examples/build-method.example.js)
 *
 * Run gen-prompts.js to materialise all templates into prompt files:
 *   node test_models/gen-prompts.js
 */

export default [
  {
    name: 'subwords-v1',
    build: (context) => {
      const parts = context.subwords
        .flatMap((s) => s.helpers.map((h) => h.gloss))
        .join(', ');
      const lines = [
        'Interpret this Blissymbolics word. Reply with your 5 best English guesses, best first, as a numbered list.',
        `Word: ${context.spelling}  (${context.charCount} symbols)`,
      ];
      if (parts) lines.push(`Parts: ${parts}`);
      return lines.join('\n');
    },
  },
];
