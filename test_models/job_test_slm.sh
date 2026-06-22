#!/bin/bash

# Copyright (c) 2026, Inclusive Design Institute
#
# Licensed under the BSD 3-Clause License. You may not use this file except
# in compliance with this License.
#
# You may obtain a copy of the BSD 3-Clause License at
# https://github.com/inclusive-design/baby-bliss-bot/blob/main/LICENSE

#SBATCH --job-name=test_slm_GLM-4.7-Flash_simple_1000_enable_thinking
#SBATCH --time 1-00:00
#SBATCH --nodes=1
#SBATCH --gpus-per-node=h100:1
#SBATCH --mem=64G
#SBATCH --ntasks-per-node=4
#SBATCH --cpus-per-task=4
#SBATCH --account=def-whkchun
#SBATCH --output=%x.o%j
#SBATCH --mail-user=cli@ocadu.ca
#SBATCH --mail-type=START,END,FAIL

 
pip install --upgrade pip
module load StdEnv/2023 python/3.11

virtualenv --no-download $SLURM_TMPDIR/env
source $SLURM_TMPDIR/env/bin/activate

pip install  --no-index --upgrade pip

module load StdEnv/2023

pip install torch==2.12.0 transformers==5.12.1 sentencepiece==0.2.1 accelerate==1.14.0

pip list

echo "Test small language model with prompts: job ID $SLURM_JOB_ID on nodes $SLURM_JOB_NODELIST."
python ~/test_slms/test_slm.py --model ~/projects/ctb-whkchun/s2_bliss_LLMs/GLM-4.7-Flash --prompts ~/test_slms/prompts/simple-1000.jsonl --output ~/test_slms/results/GLM-4.7-Flash/simple-1000.jsonl
