#!/usr/bin/env node
/*
 * gen_prompts.js — generate per-template prompt JSONL files for SLM testing.
 *
 * Usage:
 *   node test_models/gen_prompts.js [--set <name>] [--templates <path>] [--output-dir <path>]
 *   npm run gen_prompts -- --set 50 --templates test_models/prompt_templates.js --output-dir test_models/prompts/
 *
 * Defaults:
 *   --set         (all eligible targets)
 *   --templates   test_models/prompt_templates.js
 *   --output-dir  test_models/prompts/
 *
 * Output: one <name>.jsonl per template, each line: {"targetId":"B1234","prompt":"..."}
 * Overwrites existing files (idempotent). Progress written to stderr.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
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
      rows.push({ targetId: target.targetId, prompt: tmpl.build(context) });
      // if (context.indicators.length > 0 && context.modifiers.length > 0) {
      //   break;
      // }
    }
    result.set(tmpl.name, rows);
  }
  return result;
}

/**
 * Serialise rows to JSONL, prepending a _meta line when systemPrompt is provided.
 * @param {Array<{targetId: string, prompt: string}>} rows
 * @param {string} [systemPrompt]
 * @returns {string}
 */
export function buildFileContent(rows, systemPrompt) {
  const lines = [];
  if (systemPrompt) {
    lines.push(JSON.stringify({ _meta: true, systemPrompt }));
  }
  for (const row of rows) {
    lines.push(JSON.stringify(row));
  }
  return lines.join('\n') + '\n';
}

const main = async () => {
  const templatesPath = resolve(
    __dirname,
    "..", // project root
    arg("templates", "test_models/prompt_templates.js")
  );
  const outputDir = resolve(
    __dirname,
    "..",
    arg("output-dir", "test_models/prompts/")
  );

  const setName = arg("set", null);

  const { default: templates } = await import(templatesPath);
  const kit = await loadKit();
  let targets = kit.dataset.getEligibleTargets();

  if (setName !== null) {
    const setPath = resolve(__dirname, "..", `data/sets/set-${setName}.jsonl`);
    const ids = readFileSync(setPath, "utf8").trim().split(/\r?\n/).map((l) => JSON.parse(l).targetId);
    const byId = new Map(targets.map((t) => [t.targetId, t]));
    targets = ids.map((id) => byId.get(id)).filter(Boolean);
  }

  const setLabel = setName !== null ? ` (set-${setName})` : "";
  process.stderr.write(`Loaded ${targets.length} targets${setLabel}, ${templates.length} template(s)\n`);

  const promptMap = buildPromptRows(templates, targets, kit.dataset);

  mkdirSync(outputDir, { recursive: true });
  for (const [name, rows] of promptMap) {
    const tmpl = templates.find(t => t.name === name);
    const outPath = resolve(outputDir, `${name}.jsonl`);
    writeFileSync(outPath, buildFileContent(rows, tmpl?.systemPrompt), "utf8");
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
