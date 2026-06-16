#!/usr/bin/env node
/*
 * gen-prompts.js — generate per-template prompt JSONL files for SLM testing.
 *
 * Usage:
 *   node test_models/gen-prompts.js [--templates <path>] [--output-dir <path>]
 *   npm run gen-prompts -- --templates test_models/prompt-templates.js --output-dir test_models/prompts/
 *
 * Defaults:
 *   --templates   test_models/prompt-templates.js
 *   --output-dir  test_models/prompts/
 *
 * Output: one <name>.jsonl per template, each line: {"targetId":"B1234","prompt":"..."}
 * Overwrites existing files (idempotent). Progress written to stderr.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadKit } from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : fallback;
};

/**
 * Core logic — pure, no file I/O, testable.
 * @param {Array<{name: string, build: (ctx) => string}>} templates
 * @param {Array<{targetId: string}>} targets
 * @param {{ buildContext: (id: string) => object }} dataset
 * @returns {Map<string, Array<{targetId: string, prompt: string}>>}
 */
export function buildPromptRows(templates, targets, dataset) {
  const result = new Map();
  for (const tmpl of templates) {
    const rows = [];
    for (const target of targets) {
      const context = dataset.buildContext(target.targetId);
      console.log("context for", target.targetId, ":\n", context);
      break;
      // Add indicator info to the context
      if (context.indicators.length > 0) {
        context.charCount += context.indicators.length;  // treat indicators as extra symbols
        context.indicators.forEach(i => context.subwords.push(...context.indicators.map(i => ({
          spelling: i.spelling,
          helpers: [{
            id: i.id,
            gloss: i.purpose,
          }]
        }))));
      }
      
      rows.push({ targetId: target.targetId, prompt: tmpl.build(context) });
    }
    result.set(tmpl.name, rows);
  }
  return result;
}

const main = async () => {
  const templatesPath = resolve(
    __dirname,
    "..", // project root
    arg("templates", "test_models/prompt-templates.js")
  );
  const outputDir = resolve(
    __dirname,
    "..",
    arg("output-dir", "test_models/prompts/")
  );

  const { default: templates } = await import(templatesPath);
  const kit = await loadKit();
  const targets = kit.dataset.getEligibleTargets();

  process.stderr.write(`Loaded ${targets.length} targets, ${templates.length} template(s)\n`);

  const promptMap = buildPromptRows(templates, targets, kit.dataset);

  mkdirSync(outputDir, { recursive: true });
  for (const [name, rows] of promptMap) {
    const outPath = resolve(outputDir, `${name}.jsonl`);
    writeFileSync(outPath, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
    process.stderr.write(`Wrote ${rows.length} rows → ${outPath}\n`);
  }
};

// Only run main() when executed directly (not when imported by tests)
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
