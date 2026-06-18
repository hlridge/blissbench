# Test Small Language Models

Run small/fine-tuned language models against blissbench without a cloud API.
Two steps: generate prompt files locally (Node), then run them through your model (Python).

## Prerequisites

**Node.js** (≥18) — already required by blissbench.

**Python deps** — install before running `run_slm.py`:

```
pip install transformers accelerate
pip install bitsandbytes   # only needed for --quantize (Alliance / low-VRAM)
```

**Node deps** — install before running `test_ollama.js`:

```bash
npm install
```

**Ollama** — only needed for the Ollama alternative in Step 3:

- Install Ollama: <https://ollama.com>
- Start the server: `ollama serve`
- Pull a model: `ollama pull llama3.1`

## Step 1 — Edit prompt templates

Open `test_models/prompt_templates.js`. Each entry in the array is a template:

```js
export default [
  {
    name: 'subwords-v1',          // becomes the output filename
    systemPrompt: '...',          // optional; one system prompt for all records in this template
    build: (context) => {         // context = kit.dataset.buildContext(targetId)
      // ...build and return a prompt string
    },
  },
];
```

When `systemPrompt` is present, `gen_prompts.js` writes it once as a metadata header in the
generated JSONL (see Step 2). Both runners read it automatically. Omit the field to use the
default: `"You are a helpful assistant for solving linguistic puzzles."`.

`context` fields available (never exposes the target's own gloss — those are sealed):

| Field | Type | Description |
|-------|------|-------------|
| `spelling` | `string` | B-code spelling, e.g. `B206/B1021` |
| `charCount` | `number` | Number of Bliss symbols |
| `subwords[].spelling` | `string` | Each contiguous subword |
| `subwords[].helpers[].gloss` | `string` | Dictionary gloss for that subword |
| `modifiers[]` | objects | Pre-head operator sequences |
| `indicators[]` | objects | Grammar markers with curated meanings |
| `siblings[]` | objects | Same-base words with different indicators |
| `neighbours.sharedStart[]` | objects | Words sharing leading glyph run |
| `neighbours.sharedEnd[]` | objects | Words sharing trailing glyph run |
| `legend[]` | objects | Glosses for non-shared parts in neighbour spellings |
| `indicators[].purpose` | `string` | Curated grammatical meaning of the indicator |
| `modifiers[].codes` | `string[]` | B-code IDs of the modifier symbols |
| `modifiers[].gloss` | `string` | Dictionary gloss of the modifier |
| `subwords[].helpers[].explanation` | `string` | Dictionary explanation for that subword |

See `examples/build-method.example.js` for a worked example.

## Step 2 — Generate prompt files

```bash
node test_models/gen_prompts.js
# or with options:
node test_models/gen_prompts.js --set 50 --templates test_models/prompt_templates.js --output-dir test_models/prompts/
```

Arguments:

| Argument | Required | Default | Description |
| -------- | -------- | ------- | ----------- |
| `--set` | no | (all targets) | Name of a target set, e.g. `50`, `100`, `all` — loads from `data/sets/set-<name>.jsonl` |
| `--templates` | no | `test_models/prompt_templates.js` | Path to a templates file |
| `--output-dir` | no | `test_models/prompts/` | Directory to write output JSONL files |

This writes one JSONL file per template to the output directory. When the template has a
`systemPrompt`, the first line is a metadata header; the remaining lines are prompt rows:

```jsonl
{"_meta":true,"systemPrompt":"You interpret one Blissymbolics word..."}
{"targetId":"B…","prompt":"…"}
{"targetId":"B…","prompt":"…"}
```

Templates without `systemPrompt` produce JSONL with no header line (the runners fall back to
the default system prompt).

## Step 3 — Run the SLM

```bash
python test_models/run_slm.py \
  --model /path/to/hf-checkpoint \
  --prompts test_models/prompts/subwords-v1.jsonl \
  --output test_models/results/subwords-v1.jsonl \
  --runner my-model-name \
  --prompt-version subwords-v1
```

Arguments:

| Argument | Required | Default | Description |
|----------|----------|---------|-------------|
| `--model` | yes | — | Local HuggingFace checkpoint directory |
| `--prompts` | yes | — | Prompt JSONL from Step 2 |
| `--output` | yes | — | Where to write the submission JSONL |
| `--runner` | no | model dir basename | Label in every output row |
| `--prompt-version` | no | prompts file stem | Label in every output row |
| `--quantize` | no (flag) | off | 4-bit NF4 loading via `bitsandbytes` |

Responses are written immediately after each target — the output file is usable even if the run is interrupted.

### Running on the Alliance cluster

Download the model first (on the login node):

```bash
huggingface-cli download <org/model> --local-dir ~/models/<model-name>
```

Then submit a job. Adjust account, GPU type, and memory to your allocation:

```bash
#!/bin/bash
#SBATCH --job-name=blissbench-slm
#SBATCH --time=4:00:00
#SBATCH --nodes=1
#SBATCH --gpus-per-node=v100l:1
#SBATCH --mem=32G
#SBATCH --account=def-<your-account>
#SBATCH --output=%x.o%j

module load python/3.11
virtualenv --no-download $SLURM_TMPDIR/env
source $SLURM_TMPDIR/env/bin/activate
pip install --upgrade pip
pip install transformers accelerate bitsandbytes

python ~/blissbench/test_models/run_slm.py \
  --model ~/models/<model-name> \
  --prompts ~/blissbench/test_models/prompts/subwords-v1.jsonl \
  --output ~/blissbench/test_models/results/subwords-v1.jsonl \
  --runner <model-name> \
  --prompt-version subwords-v1 \
  --quantize
```

## Step 3 (alternative) — Run via Ollama

Use a local Ollama model instead of a HuggingFace checkpoint. Requires Ollama installed and running (`ollama serve`) with the target model already pulled (`ollama pull <model>`).

```bash
node test_models/test_ollama.js \
  --model llama3.1 \
  --prompts test_models/prompts/simple.jsonl \
  --output test_models/results/simple-ollama.jsonl \
  --runner my-model-name \
  --prompt-version simple
```

Arguments:

| Argument | Required | Default | Description |
|----------|----------|---------|-------------|
| `--model` | yes | — | Ollama model tag (e.g. `llama3.1`) |
| `--prompts` | yes | — | Prompt JSONL from Step 2 |
| `--output` | yes | — | Where to write the submission JSONL |
| `--runner` | no | model tag | Label in every output row |
| `--prompt-version` | no | prompts file stem | Label in every output row |

Responses are written immediately after each target — the output file is usable even if the run is interrupted. The script prints elapsed time and a score command when complete.

Proceed to Step 4 to score the output.

## Available templates

| Name | Description |
| ---- | ----------- |
| `simple` | Short user prompt: spelling + character glosses. No system prompt override. |
| `narrative` | User prompt with subwords, related words, and legend. No system prompt override. |
| `json` | Structured JSON user prompt: `inputIds`, `annotations`, `indicatorEffects`, `subwordMatches`. Includes a detailed Blissymbolics interpretation system prompt. |

## Step 4 — Score

```bash
node bin/score.js --submission test_models/results/subwords-v1.jsonl --set 50
```

Use `--set all` for an official full run:

```bash
node bin/score.js --submission test_models/results/subwords-v1.jsonl --set all
```

Two runs are comparable only when they share the same `data/manifest.json` SHA and the same `--set` argument.
