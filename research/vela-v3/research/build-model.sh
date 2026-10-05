#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
THREADS="${1:-4}"
MODEL="${2:-model/dp5}"
if [[ -d "$MODEL" && -n "$(ls -A "$MODEL")" ]]; then
  echo "Refusing to overwrite a non-empty model directory: $MODEL" >&2; exit 2
fi
mkdir -p "$MODEL" bin results
"${CXX:-g++}" -std=c++17 -O3 -fopenmp -ffp-contract=off research/solve-hands.cpp -o bin/solve-hands
# 复现研究运行中在资源 horizon 为 2 时的那一次量化重启。
./bin/solve-hands 5 2 "$MODEL" "$THREADS"
python3 research/set-horizon.py "$MODEL" 24
./bin/solve-hands 5 24 "$MODEL" "$THREADS" 2
