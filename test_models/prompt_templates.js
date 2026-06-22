/*
 * prompt_templates.js — define one or more prompt templates for testing SLMs.
 *
 * Each entry: { name: string, build: (context) => string }
 *   - name:  used as the output filename (test_models/prompts/<name>.jsonl)
 *   - build: receives the object from kit.dataset.buildContext(targetId)
 *            (same shape as in examples/build-method.example.js)
 *
 * Run gen_prompts.js to materialise all templates into prompt files:
 *   node test_models/gen_prompts.js
 */

export default [
  {
    name: "simple",
    build: (context) => {
      const indicators =context.indicators.flatMap((i) => `  ${i.spelling} = ${i.purpose || i.name}`);
      const out = [
        "Interpret this symbolic word composed of following characters:"
      ];
      if (context.subwords.length > 0) {
        for (const s of context.subwords) {
          const parts = s.helpers.map(h => h.gloss);
          out.push(`A character meaning "${parts.join(", ")}"`);
        }
      }
      if (context.indicators.length > 0) {
        for (const i of context.indicators) {
          out.push(`A character that ${i.purpose || i.name}`);
        }
      }
      out.push("\nReply with your 5 best English guesses, best first, as a JSON array.");
      return out.join("\n");
    },
  },
  {
    name: "narrative",
    build: (context) => {
      const out = [];
      out.push("Interpret this symbolic word. Reply with your 5 best English guesses, best first, as a JSON array.");
      out.push(`Word: ${context.spelling}  (${context.charCount + context.indicators.length} symbols)`);
      if (context.subwords.length) {
        out.push("\nParts of it that are words themselves:");
        for (const s of context.subwords) {
          out.push(`  ${s.spelling} = ${s.helpers.map(h => h.gloss).join("; ")}`);
        }
        for (const s of context.indicators) {
          out.push(`  ${s.spelling} = ${s.purpose || s.name}`);
        }
      }
      const related = context.neighbours.sharedStart.concat(context.neighbours.sharedEnd);
      if (related.length) {
        out.push("\nRelated words that share symbols with it:");
        for (const n of related) out.push(`  ${n.notation} = ${n.gloss}`);
      }
      if (context.legend.length) {
        out.push("\nWhat the other symbols in those related words mean:");
        for (const p of context.legend) out.push(`  ${p.spelling} = ${p.gloss}`);
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
  {
    name: "cot",
    systemPrompt: `You are an expert linguist specializing in Blissymbolics. Your task is to translate a single Blissymbolics word (represented by a sequence of BCI-AV symbol IDs) into its most accurate English translations.

### BLISSYMBOLICS COMPOSITION RULES
When analyzing the word, apply these rules:
1. Structure: (0+ modifiers) + (1 classifier) + (0 or 1 indicator) + (0+ specifiers / modifiers)
2. Classifier: The core concept of the word.
3. Specifiers: Add specificity to the core concept of the classifier.
4. Indicators: Modify the grammatical or semantic role or tense of the word such as part of speech, tense, singular/plural etc.
5. Modifiers: Transform the meaning of the composed word (e.g., opposite_of, small, etc.). Some symbols can be modifiers or specifiers based on context.
6. Position matters:
   - Modifier + Classifier = Transforms the word (e.g., opposite_of + hot = cold).
   - Classifier + Specifier = Produces a hyponym of the classifier (e.g., citrus fruit + small = clementine).
   - Some symbols change roles based on position (e.g., meat + part = diced meat; part + year = season).
7. Sub-words: The main word may flatten multiple sub-words. Use the provided components list to identify logical boundaries.

### INSTRUCTIONS
Step 1. Enclose your linguistic analysis inside <analysis> tags.
- Break the target word into its logical sub-words and boundaries based on the components list.
- Identify which symbol is likely the core "Classifier", which are "Modifiers", and which are "Specifiers" or "Indicators".
- Synthesize the literal meaning.
- Brainstorm English words or phrases that match this synthesized meaning. Consider the related words for thematic clues.
- Keep analysis concise

Step 2. After your analysis, output your final 5 best English guesses STRICTLY as a JSON array of strings, ordered from most accurate to least accurate.

### RESPONSE FORMAT
<analysis>
(Your step-by-step reasoning here)
</analysis>
["guess 1", "guess 2", "guess 3", "guess 4", "guess 5"]`,
    build: (context) => {
      const out = ['### INPUT DATA', `Target Word: ${context.spelling}`];

      if (context.subwords.length) {
        out.push('\nParts of it that are themselves words:');
        for (const s of context.subwords)
          out.push(`  ${s.spelling} = ${s.helpers.slice(0, 2).map(h => h.gloss).join('; ')}`);
      }

      if (context.indicators.length) {
        out.push('\nGrammar markers on this word:');
        for (const i of context.indicators)
          out.push(`  ${i.spelling} = ${i.purpose || i.name}`);
      }

      if (context.modifiers.length) {
        out.push('\nModifiers on this word:');
        for (const m of context.modifiers) {
          if (m.asPrefix?.length) {
            out.push(`  ${m.spelling}:`);
            out.push(`    - If Prefix (Before Classifier): Acts as a MODIFIER meaning "${m.asPrefix.join(', ')}"`);
            out.push(`    - If Suffix (After Classifier): Acts as a SPECIFIER meaning "${m.gloss}"`);
          } else {
            out.push(`  ${m.spelling}: ${m.gloss}`);
          }
        }
      }
      console.log(`Context for target ${context.targetId}:\n${out.join('\n')}`);
      return out.join('\n');
    },
  },
];
