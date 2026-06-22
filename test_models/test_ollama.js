#!/usr/bin/env node
/**
 * test_ollama.js — feed a blissbench prompt JSONL to a local Ollama model.
 *
 * Usage:
 *   node test_models/test_ollama.js \
 *     --model llama3.1 \
 *     --prompts test_models/prompts/simple.jsonl \
 *     --output test_models/results/simple-ollama.jsonl \
 *     [--runner my-label] \
 *     [--prompt-version simple]
 *
 * Requires: ollama serve running locally with the target model pulled.
 * Output rows (one per target, written immediately — crash-safe):
 *   {"targetId":"...","rawResponseText":"...","candidates":[...],"runner":"...","promptVersion":"..."}
 * Score: node bin/score.js --submission <output> --set 50
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import ollama from "ollama";

const __dirname = dirname(fileURLToPath(import.meta.url));

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : fallback;
};

/**
 * Extract up to n candidate glosses from raw model response text.
 * Strategy 1 (primary): parse a JSON array found anywhere in the text.
 * Strategy 2 (fallback): parse a numbered list (1. word / 1) word).
 * Strategy 3 (final fallback): first n non-empty lines.
 */
export function extractCandidates(text, n = 5) {
  for (const m of text.matchAll(/\[[\s\S]*?\]/g)) {
    try {
      const parsed = JSON.parse(m[0]);
      if (Array.isArray(parsed)) {
        const strings = parsed.filter(s => typeof s === "string");
        if (strings.length > 0) return strings.slice(0, n);
      }
    } catch {
      // not valid JSON array, try next match
    }
  }

  const numbered = [...text.matchAll(/^\s*\d+[.)]\s*(.+)$/gm)].map(m => m[1].trim());
  if (numbered.length > 0) return numbered.slice(0, n);

  return text.split("\n").map(l => l.trim()).filter(Boolean).slice(0, n);
}

const SYSTEM_PROMPT_FALLBACK = "You are a helpful assistant for solving linguistic puzzles.";

export function readSystemPrompt(lines, fallback) {
  if (lines.length > 0) {
    try {
      const first = JSON.parse(lines[0]);
      if (first._meta === true && typeof first.systemPrompt === 'string') {
        return { systemPrompt: first.systemPrompt, dataLines: lines.slice(1) };
      }
    } catch { /* not JSON */ }
  }
  return { systemPrompt: fallback, dataLines: lines };
}

async function main() {
  const model = arg("model", null);
  const promptsPath = arg("prompts", null);
  const outputPath = arg("output", null);

  if (!model || !promptsPath || !outputPath) {
    process.stderr.write(
      "Usage: node test_models/test_ollama.js --model <tag> --prompts <file> --output <file>\n" +
      "       [--runner <label>] [--prompt-version <label>]\n"
    );
    process.exit(1);
  }

  const runner = arg("runner", model);
  const promptVersion = arg("prompt-version", basename(promptsPath, extname(promptsPath)));

  const rawLines = readFileSync(resolve(promptsPath), "utf8").split("\n").filter(Boolean);
  const { systemPrompt, dataLines: lines } = readSystemPrompt(rawLines, SYSTEM_PROMPT_FALLBACK);
  const outPath = resolve(outputPath);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, "");  // truncate / create

  const startMs = Date.now();
  let count = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (const line of lines) {
    const { targetId, prompt } = JSON.parse(line);

    const response = await ollama.chat({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      options: { num_predict: 1024 },
    });

    const rawResponseText = response.message.content;
    const candidates = extractCandidates(rawResponseText);

    const inputTokens = response.prompt_eval_count || 0;
    const outputTokens = response.eval_count || 0;
    const tokens = { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens };
    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;

    writeFileSync(outPath, JSON.stringify({ targetId, rawResponseText, candidates, runner, promptVersion, tokens }) + "\n", { flag: "a" });

    count += 1;
    process.stderr.write(`[${count}] ${targetId}: ${JSON.stringify(candidates.slice(0, 2))} (${tokens.total} tokens)\n`);
  }

  const totalTokens = totalInputTokens + totalOutputTokens;
  const elapsedSecs = Math.round((Date.now() - startMs) / 1000);
  const elapsed = elapsedSecs < 60
    ? `${elapsedSecs}s`
    : `${Math.floor(elapsedSecs / 60)}m${elapsedSecs % 60}s`;

  process.stderr.write(`\nDone. Processed ${count} prompts in ${elapsed}. Wrote to ${outputPath}\n`);
  if (count > 0) {
    process.stderr.write(`Tokens: ${totalTokens} total (${totalInputTokens} in + ${totalOutputTokens} out), avg ${Math.round(totalTokens / count)}/record\n`);
  }
  process.stderr.write(`Score: node bin/score.js --submission ${outputPath} --set 50\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
