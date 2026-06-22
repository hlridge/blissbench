#!/usr/bin/env python3
"""
run_slm.py — feed a blissbench prompt JSONL to a local HuggingFace model.

Usage:
  python test_models/run_slm.py \\
    --model /path/to/hf-checkpoint \\
    --prompts test_models/prompts/subwords-v1.jsonl \\
    --output test_models/results/subwords-v1.jsonl \\
    [--runner my-slm] \\
    [--prompt-version subwords-v1] \\
    [--quantize]

Output rows (one per target, written immediately — crash-safe):
  {"targetId":"B1234","rawResponseText":"...","candidates":["g1","g2",...],"runner":"...","promptVersion":"..."}

Score output with:
  node bin/score.js --submission test_models/results/subwords-v1.jsonl --set 50
"""
import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
SYSTEM_PROMPT_FALLBACK = "You are a helpful assistant for solving linguistic puzzles."


def read_system_prompt(lines, fallback):
    """Return (system_prompt, data_lines): extract _meta header if present."""
    if lines:
        try:
            first = json.loads(lines[0])
            if first.get('_meta') is True and isinstance(first.get('systemPrompt'), str):
                return first['systemPrompt'], lines[1:]
        except (json.JSONDecodeError, ValueError):
            pass
    return fallback, lines


def extract_candidates(text: str, n: int = 5) -> list:
    """Extract up to n candidate glosses from raw model response text.

    Strategy 1 (primary): parse a JSON array found anywhere in the text.
    Strategy 2 (fallback): parse a numbered list (1. word / 1) word).
    Strategy 3 (final fallback): first n non-empty lines.
    """
    text = re.sub(r'<analysis>[\s\S]*?</analysis>', '', text).strip()
    for m in re.finditer(r'\[[\s\S]*?\]', text):
        try:
            parsed = json.loads(m.group())
            if isinstance(parsed, list):
                strings = [s for s in parsed if isinstance(s, str)]
                if strings:
                    return strings[:n]
        except ValueError:
            continue

    numbered = re.findall(r'^\s*\d+[.)]\s*(.+)$', text, re.MULTILINE)
    if numbered:
        return [c.strip() for c in numbered[:n]]

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return lines[:n]


def load_model(model_path: str, quantize: bool):
    """Load tokenizer and model from a local HuggingFace checkpoint."""
    from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig
    import torch

    print("Loading tokenizer from path: ", model_path)
    tokenizer = AutoTokenizer.from_pretrained(model_path)

    if quantize:
        bnb_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.bfloat16,
            bnb_4bit_use_double_quant=True,
        )
        model = AutoModelForCausalLM.from_pretrained(
            model_path,
            quantization_config=bnb_config,
            device_map="auto",
            torch_dtype=torch.bfloat16,
        )
    else:
        model = AutoModelForCausalLM.from_pretrained(
            model_path,
            dtype="auto",
            device_map="auto",
        )

    model.eval()
    return model, tokenizer


def generate_response(model, tokenizer, prompt: str, system_prompt: str,
                      enable_thinking: bool = False, thinking_budget: int = None,
                      max_tokens: int = 2048):
    """Tokenize prompt, generate until the model's natural stop, decode new tokens only."""
    template_kwargs = dict(
        add_generation_prompt=True,
        tokenize=False,
        enable_thinking=False,
    )
    if enable_thinking:
        template_kwargs['enable_thinking'] = True
        if thinking_budget is not None:
            template_kwargs['thinking_budget'] = thinking_budget
    text = tokenizer.apply_chat_template(
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ],
        **template_kwargs,
    )
    inputs = tokenizer(text=text, return_tensors="pt").to(model.device)
    input_len = inputs["input_ids"].shape[-1]

    outputs = model.generate(**inputs, max_new_tokens=max_tokens)
    output_len = outputs[0].shape[-1] - input_len

    response = tokenizer.decode(outputs[0][input_len:], skip_special_tokens=False)

    tokens = {"input": int(input_len), "output": int(output_len), "total": int(input_len + output_len)}
    return response, tokens

def main():
    start_time = time.perf_counter()
    parser = argparse.ArgumentParser(
        description="Run a local HuggingFace SLM against a blissbench prompt file."
    )
    parser.add_argument("--model", required=True,
                        help="Path to HuggingFace checkpoint directory")
    parser.add_argument("--prompts", required=True,
                        help="Path to prompt JSONL (output of gen_prompts.js)")
    parser.add_argument("--output", required=True,
                        help="Path to write submission JSONL")
    parser.add_argument("--runner", default=None,
                        help="Label stored in each output row (default: model dir basename)")
    parser.add_argument("--prompt-version", default=None,
                        help="Label stored in each output row (default: prompts file stem)")
    parser.add_argument("--quantize", action="store_true",
                        help="Load model in 4-bit NF4 quantization (for low VRAM / Alliance)")
    parser.add_argument("--enable-thinking", action="store_true",
                        help="Pass enable_thinking=True to apply_chat_template (default: off)")
    parser.add_argument("--thinking-budget", type=int, default=None,
                        help="Cap thinking tokens via thinking_budget param (model must support it)")
    parser.add_argument("--max-tokens", type=int, default=2048,
                        help="Max new tokens for generation (default: 2048)")
    args = parser.parse_args()

    runner = args.runner or os.path.basename(args.model.rstrip("/\\"))
    prompt_version = args.prompt_version or Path(args.prompts).stem

    print(f"Loading model from {args.model} ...", file=sys.stderr)
    model, tokenizer = load_model(args.model, args.quantize)
    print("Model loaded.", file=sys.stderr)

    with open(args.prompts, encoding="utf-8") as f_in:
        all_lines = [line.strip() for line in f_in if line.strip()]

    system_prompt, data_lines = read_system_prompt(all_lines, SYSTEM_PROMPT_FALLBACK)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    count = 0
    total_input_tokens = 0
    total_output_tokens = 0
    with open(output_path, "w", encoding="utf-8") as f_out:
        for line in data_lines:
            row = json.loads(line)
            target_id = row["targetId"]
            prompt = row["prompt"]

            raw, tokens = generate_response(
                model, tokenizer, prompt, system_prompt,
                enable_thinking=args.enable_thinking,
                thinking_budget=args.thinking_budget,
                max_tokens=args.max_tokens,
            )
            candidates = extract_candidates(raw)

            total_input_tokens += tokens["input"]
            total_output_tokens += tokens["output"]

            out_row = {
                "targetId": target_id,
                "rawResponseText": raw,
                "candidates": candidates,
                "runner": runner,
                "promptVersion": prompt_version,
                "tokens": tokens,
            }
            f_out.write(json.dumps(out_row) + "\n")
            f_out.flush()

            count += 1
            print(f"[{count}] {target_id}: {candidates[:2]} ({tokens['total']} tokens)", file=sys.stderr)

    end_time = time.perf_counter()
    total_seconds = end_time - start_time

    minutes, seconds = divmod(total_seconds, 60)
    hours, minutes = divmod(minutes, 60)
    total_tokens = total_input_tokens + total_output_tokens
    print(f"\nDone. Wrote {count} rows to {output_path}", file=sys.stderr)
    print(f"Score: node bin/score.js --submission {output_path} --set 50", file=sys.stderr)
    print(f"Total time: {int(hours)}h {int(minutes)}m {seconds:.2f}s", file=sys.stderr)
    if count > 0:
        print(f"Tokens: {total_tokens} total ({total_input_tokens} in + {total_output_tokens} out), avg {total_tokens // count}/record", file=sys.stderr)


if __name__ == "__main__":
    main()
