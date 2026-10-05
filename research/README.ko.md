# VELA 价值表生成指南

[English](README.md) | 한국어

## VELA v4.2 — COMPACT100 Hinge

当前模型使用冻结的 Hinge epoch 1、horizon 100、2-step expectimax，以及真实剩余牌堆和 DeckPotential β=0.6。FULL100 最小生成器（1 个 C++ 文件、3 个头文件）、压缩与训练依赖源码、执行命令和最终结果摘要见 [v4.2 包](vela-v4.2/README.md)。FULL100 原始文件在应用运行时并不需要。单独训练的 Hinge 最终分数预测器已接入应用，预测器的训练材料不包含在本价值模型研究包中。

## VELA v4.1 — COMPACT48

| 文件夹 | 作用 |
|---|---|
| `vela-v4.1/full48/` | 手牌最多 5 张、horizon 48 的连续 DP 生成器 |
| `vela-v4.1/include/` | 生成器所需的依赖头文件 |
| `vela-v4.1/compression/src/` | 训练时间·手牌共享结构并导出量化结果 |

最终文件是 `vela-v4.1/compression/models/quant_q6_k64_t12.bin`（37.68 MiB）。FULL48 表只在生成过程中需要，运行时并不需要。WASM 构建请参阅 [native 指南](../src/policies/vela/native/README.md)。

在 Windows 上准备好 MSYS2 UCRT64 g++、Python、NumPy 后，在项目根目录执行。以下命令是完整的模型生成任务，本次源码整理过程中并未重新执行。仅 FULL48 表就约 42.72 GiB，最终 FP32 快照和压缩中间结果还需要额外空间。

```powershell
Push-Location research/vela-v4.1
try {
    New-Item -ItemType Directory -Force bin, compression/results | Out-Null
    g++ -std=c++17 -O3 -march=native -fopenmp -I include full48/solve-hands-full48.cpp -o bin/solve-hands.exe
    ./bin/solve-hands.exe 5 48 full48/model/full48 12
    python compression/src/analyze_low.py
    python compression/src/fit_shared.py 6
    '[]' | Set-Content -Encoding ascii compression/results/models.json
    python compression/src/export_quantized.py
} finally {
    Pop-Location
}
```

原始导出脚本还会生成用于对比的 T8 文件。v4.1 使用的是 T12 文件。由于线性代数环境不同，生成的字节可能存在差异，因此重新生成后需要验证价值与动作的一致性以及策略分数。

[最终研究报告](vela-v4.1/report-ko.md)：在独立的 90,000 局 paired 对局中，候选为 1876.5108 分，FULL48 为 1878.0848 分，未满足原研究的非劣性标准。这并非与线上 H24+Four 比较得到的数值。

来源为 `adventure_vela/research/full_hand_dp/oneshot_full48_20260927/`（生成器）、`adventure_vela/research/value_compression/full48_shared_structure_v1_20260927/`（压缩与报告）、`adventure_vela/bak/legacy_20260926/S2_20260919_RDC/vendor/research/`（头文件）。源码改动仅是按当前文件夹结构调整的 `common.py` 输入路径。报告中的外部图片和 PC 专用链接以文字形式呈现，原始证据材料仍保留在原研究路径中。

基准模型解压后的 SHA-256：`261ed5f731511119391278ae8800597ded67dbb882808e06ba2633ee58a292dc`。

---

## VELA v1~v4 — 旧版本生成过程

从头构建 VELA-v4 模型时，使用 **V1、V3、V4** 的生成器文件。不使用 V2 生成器。

## 所需文件夹

| 文件夹 | 作用 |
|---|---|
| `vela-v1/research/` | 通过 DP4 计算生成 `four-projected-24.bin` |
| `vela-v3/research/` | DP5 计算及 H24 检查点导出 |
| `vela-v4/research/` | 将 H24 检查点转换为 `h24.raw` |

连同各文件夹的头文件和脚本，共 16 个文件一起使用。

## 生成顺序

1. **V1：** 构建 `four-project.cpp` 并以 horizon 参数 `24` 运行。输出为 `results/four-projected-24.bin`。
2. **V3：** 用 `build-model.sh` 生成 DP5 表。保留脚本中的 H2 保存值重启条件。
3. **V3：** 用 `export-checkpoint.cpp` 导出 horizon `24`。将输出的 `*_part1.qdelta.gz`、`*_part2.qdelta.gz` 按顺序解压并合并，得到 `h24.qdelta`。
4. **V4：** 向用 `convert-checkpoint.cpp` 构建的可执行文件传入参数 `h24.qdelta h24.raw`。

最终需要的价值表是 **`four-projected-24.bin` 和 `h24.raw`**。将这两个文件放置到现有 VELA-v4 运行时的模型路径中。本文件夹不包含运行时本身。

## 实际命令示例

在 **Linux/WSL 的 Bash** 中，以仓库根目录（`research/` 的上级目录）为基准执行以下命令。假设输出目录是全新状态，且已安装下列依赖。这些命令会执行完整的模型计算，并非简短的运行验证。传给 `build-model.sh` 的 `4` 是线程数。

```bash
(
  set -euo pipefail
  cd research

  # V1：DP4，horizon 24
  (
    cd vela-v1
    mkdir -p bin results
    g++ -std=c++17 -O3 -ffp-contract=off -fopenmp \
      research/four-project.cpp -o bin/four-project
    ./bin/four-project 24
  )

  # V3：带 H2 重启的 DP5，随后导出 H24
  (
    cd vela-v3
    bash research/build-model.sh 4
    g++ -std=c++17 -O3 -ffp-contract=off \
      research/export-checkpoint.cpp -o bin/export-checkpoint -lz
    ./bin/export-checkpoint model/dp5 24 model/checkpoint
    gzip -dc model/checkpoint_part1.qdelta.gz \
      model/checkpoint_part2.qdelta.gz > model/h24.qdelta
  )

  # V4：转换 H24 并收集两份运行时表
  (
    cd vela-v4
    mkdir -p bin model
    g++ -std=c++17 -O3 -ffp-contract=off \
      research/convert-checkpoint.cpp -o bin/convert-checkpoint
    ./bin/convert-checkpoint ../vela-v3/model/h24.qdelta model/h24.raw
    cp ../vela-v1/results/four-projected-24.bin model/four-projected-24.bin
  )
)
```

最终两个文件会汇总到 `research/vela-v4/model/`。V3 的中间产物保留在 `research/vela-v3/model/`。`build-model.sh` 会拒绝覆盖非空的 `model/dp5/`，它并不是能从任意中断点恢复的命令。

## 环境与验证范围

需要 C++17、OpenMP、Python 3、Bash、gzip。V3 导出使用 POSIX mmap 和 zlib，因此以 Linux/WSL 环境为基准。

本次整理没有进行构建、重新计算或执行。现有模型与重新生成结果的哈希一致性需要另行确认。
