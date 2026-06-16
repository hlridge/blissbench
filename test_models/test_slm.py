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
from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig
import torch

def extract_candidates(text: str, n: int = 5) -> list:
    """Extract up to n candidate glosses from raw model response text.

    Strategy 1 (primary): parse a JSON array found anywhere in the text.
    Strategy 2 (fallback): parse a numbered list (1. word / 1) word).
    Strategy 3 (final fallback): first n non-empty lines.
    """
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


def generate_response(model, tokenizer, prompt: str) -> str:
    """Tokenize prompt, generate until the model's natural stop, decode new tokens only."""
    # Process input
    text = tokenizer.apply_chat_template(
        [
            {"role": "system", "content": "You are a helpful assistant for solving linguistic puzzles."},
            {"role": "user", "content": prompt},
        ],
        add_generation_prompt=True,
        tokenize=False,
    )
    inputs = tokenizer(text=text, return_tensors="pt").to(model.device)
    input_len = inputs["input_ids"].shape[-1]

    # Generate output
    outputs = model.generate(**inputs, max_new_tokens=1024)
    response = tokenizer.decode(outputs[0][input_len:], skip_special_tokens=False)

    return response

def main():
    start_time = time.perf_counter()
    parser = argparse.ArgumentParser(
        description="Run a local HuggingFace SLM against a blissbench prompt file."
    )
    parser.add_argument("--model", required=True,
                        help="Path to HuggingFace checkpoint directory")
    parser.add_argument("--prompts", required=True,
                        help="Path to prompt JSONL (output of gen-prompts.js)")
    parser.add_argument("--output", required=True,
                        help="Path to write submission JSONL")
    parser.add_argument("--runner", default=None,
                        help="Label stored in each output row (default: model dir basename)")
    parser.add_argument("--prompt-version", default=None,
                        help="Label stored in each output row (default: prompts file stem)")
    parser.add_argument("--quantize", action="store_true",
                        help="Load model in 4-bit NF4 quantization (for low VRAM / Alliance)")
    args = parser.parse_args()

    runner = args.runner or os.path.basename(args.model.rstrip("/\\"))
    prompt_version = args.prompt_version or Path(args.prompts).stem

    print(f"Loading model from {args.model} ...", file=sys.stderr)
    model, tokenizer = load_model(args.model, args.quantize)
    print("Model loaded.", file=sys.stderr)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    count = 0
    with open(args.prompts, encoding="utf-8") as f_in, \
         open(output_path, "w", encoding="utf-8") as f_out:
        for line in f_in:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            target_id = row["targetId"]
            prompt = row["prompt"]

            raw = generate_response(model, tokenizer, prompt)
            candidates = extract_candidates(raw)

            out_row = {
                "targetId": target_id,
                "rawResponseText": raw,
                "candidates": candidates,
                "runner": runner,
                "promptVersion": prompt_version,
            }
            f_out.write(json.dumps(out_row) + "\n")
            f_out.flush()  # crash-safe: each row persisted immediately

            count += 1
            print(f"[{count}] {target_id}: {candidates[:2]}", file=sys.stderr)

    end_time = time.perf_counter()
    total_seconds = end_time - start_time

    minutes, seconds = divmod(total_seconds, 60)
    hours, minutes = divmod(minutes, 60)
    print(f"\nDone. Wrote {count} rows to {output_path}", file=sys.stderr)
    print(f"Score: node bin/score.js --submission {output_path} --set 50", file=sys.stderr)
    print(f"Total time: {int(hours)}h {int(minutes)}m {seconds:.2f}s", file=sys.stderr)


if __name__ == "__main__":
    main()
