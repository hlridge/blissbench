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
  {
    name: "json",
    systemPrompt: `You interpret one Blissymbolics word into ranked natural-language candidates.

Input is a single Bliss word as a flat array of BCI-AV symbol IDs. The word may flatten multiple sub-words;
you must decide sub-word boundaries using the structured hints provided.

Bliss structural rule for a word including sub-words and the word at the top level:
  (0+ modifiers) + (1 classifier) + (0 or 1 indicator) + (0+ specifiers / modifiers)

Composition patterns:

- Classifier + specifier produces a hyponym of the classifier. Example: citrus_fruit/small -> clementine.
- A modifier transforms the classifier. Example: opposite_of/hot -> cold.

Role rules by position:

- Some symbols can act as either a modifier or a specifier. Example:
meat/part -> diced meat; part/year -> season

Use the provided context fields:

- "annotations" gives gloss, explanation, and (when relevant) role semantics per ID, in the same order
  as "inputIds". Derive first / last position from the array index when needed. "modifier.roleAmbiguous=true"
  means you must pick the role from context.
- "indicatorEffects" is the merged grammatical effect (POS, tense, etc.) that applies at the WHOLE-WORD
  level.
- "subwordMatches" lists contiguous ID slices that match a known dictionary symbol (indicators already
  stripped). Use as hints for sub-word boundaries; multiple overlapping matches may appear - pick the most
  plausible decomposition.

Translate the final interpretation into: English.

Return ONLY a JSON array of 5 candidate words or phrases, best-first. No prose, no commentary.`,
    build: (context) => {
      const inputIds = [...context.spelling.matchAll(/B(\d+)/gi)].map(m => parseInt(m[1], 10));

      const indicatorEffects = context.indicators.map(ind => ({
        id: ind.spelling.replace(/^B/i, ""),
        gloss: ind.purpose,
      }));

      const indicatorIdSet = new Set(indicatorEffects.map(e => parseInt(e.id, 10)));
      const baseIds = inputIds.filter(id => !indicatorIdSet.has(id));

      const singleCharSubword = new Map();
      for (const sw of context.subwords) {
        const codes = [...sw.spelling.matchAll(/B(\d+)/gi)].map(m => parseInt(m[1], 10));
        if (codes.length === 1) singleCharSubword.set(codes[0], sw);
      }

      const annotations = baseIds.flatMap(id => {
        const sw = singleCharSubword.get(id);
        if (!sw || !sw.helpers[0]) return [];
        const h = sw.helpers[0];
        return [{ id: String(id), gloss: h.gloss, explanation: h.explanation }];
      });

      const subwordMatches = context.subwords
        .filter(sw => {
          const codes = [...sw.spelling.matchAll(/B(\d+)/gi)].map(m => parseInt(m[1], 10));
          return codes.length > 1;
        })
        .map(sw => {
          const codes = [...sw.spelling.matchAll(/B(\d+)/gi)].map(m => parseInt(m[1], 10));
          const h = sw.helpers[0];
          return {
            subWord: codes,
            matchedGloss: h ? h.gloss : "",
            matchedExplanation: h ? h.explanation : "",
          };
        });

      const payload = { inputIds, indicatorEffects, annotations, subwordMatches };

      if (context.modifiers.length > 1) {
        payload.modifierEffects = context.modifiers.map(m => ({
          id: m.codes[0].replace(/^B/i, ""),
          gloss: m.gloss,
        }));
      }

      return JSON.stringify(payload, null, 2) + "\n\nReturn JSON array of 5 candidate interpretations.";
    },
  },
];
