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
    name: "simple",
    build: (context) => {
      const parts = context.subwords
        .flatMap((s) => `  ${s.spelling} = ${s.helpers.map(h => h.gloss).join("; ")}`);
      const out = [
        "Interpret this Blissymbolics word composed by Blissymbolics characters. Reply with your 5 best English guesses, best first, as a JSON array.",
        `Word: ${context.spelling}`,
      ];
      if (parts) out.push(`Characters: ${parts}`);
      return out.join("\n");
    },
  },
  {
    name: "narrative",
    build: (context) => {
      const out = [];
      out.push("Interpret this Blissymbolics word. Reply with your 5 best English guesses, best first, as a JSON array.");
      out.push(`Word: ${context.spelling}  (${context.charCount} symbols)`);
      if (context.subwords.length) {
        out.push("\nParts of it that are words themselves:");
        for (const s of context.subwords) {
          out.push(`  ${s.spelling} = ${s.helpers.map(h => h.gloss).join("; ")}`);
        }
      }
      const related = context.neighbours.sharedStart.concat(context.neighbours.sharedEnd);
      if (related.length) {
        out.push("\nRelated words that share symbols with it:");
        for (const n of related) out.push(`  ${n.spelling} = ${n.gloss}`);
      }
      if (context.legend.length) {
        out.push("\nWhat the other symbols in those related words mean:");
        for (const p of context.legend.slice(0, 10)) out.push(`  ${p.spelling} = ${p.gloss}`);
      }
      return out.join("\n");
    },
  },
];
