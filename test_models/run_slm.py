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
from pathlib import Path


def extract_candidates(text: str, n: int = 5) -> list:
    """Extract up to n candidate glosses from raw model response text.

    Primary strategy: parse a numbered list (1. word / 1) word).
    Fallback: first n non-empty lines.
    """
    numbered = re.findall(r'^\s*\d+[.)]\s*(.+)$', text, re.MULTILINE)
    if numbered:
        return [c.strip() for c in numbered[:n]]
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return lines[:n]


def load_model(model_path: str, quantize: bool):
    """Load tokenizer and model from a local HuggingFace checkpoint."""
    from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig
    import torch

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
            device_map="auto",
        )

    model.eval()
    return tokenizer, model


def generate_response(model, tokenizer, prompt: str) -> str:
    """Tokenize prompt, generate until the model's natural stop, decode new tokens only."""
    import torch

    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
    with torch.no_grad():
        output_ids = model.generate(**inputs)
    new_ids = output_ids[0][inputs["input_ids"].shape[1]:]
    return tokenizer.decode(new_ids, skip_special_tokens=True)


def main():
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
    tokenizer, model = load_model(args.model, args.quantize)
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

    print(f"\nDone. Wrote {count} rows to {output_path}", file=sys.stderr)
    print(f"Score: node bin/score.js --submission {output_path} --set 50", file=sys.stderr)


if __name__ == "__main__":
    main()
