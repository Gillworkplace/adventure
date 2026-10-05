# VELA 价值表生成指南

English | [한국어](README.ko.md)

## VELA v4.2 — COMPACT100 Hinge

当前模型使用冻结的 Hinge epoch 1、horizon 100、2-step expectimax 以及实际剩余牌堆，DeckPotential beta=0.6。最小化的 FULL100 生成器（一个 C++ 文件和三个头文件）、压缩/训练依赖、命令与最终结果摘要都在 [v4.2 包](vela-v4.2/README.md) 中。运行时不需要原始 FULL100 表。独立的 Hinge 分数预测器在应用运行时中接入；预测器的训练数据不属于本价值模型研究包。

## VELA v4.1 — COMPACT48

| 目录 | 用途 |
|---|---|
| `vela-v4.1/full48/` | 一次性 cap-5、horizon-48 表生成器 |
| `vela-v4.1/include/` | 生成器所需的头文件 |
| `vela-v4.1/compression/src/` | 共享的时间/手牌结构拟合与量化导出 |

选定的输出是 `vela-v4.1/compression/models/quant_q6_k64_t12.bin`（37.68 MiB）。FULL48 表只在生成阶段需要，运行时不需要。WASM 构建指南见 [native](../src/policies/vela/native/README.md)。

在 Windows 上使用 MSYS2 UCRT64 g++、Python 和 NumPy，从项目根目录运行以下命令。这些命令执行完整的模型生成；打包这些源码时并未重新运行它们。仅 FULL48 表就占用约 42.72 GiB，最终 FP32 快照和压缩中间结果还需要额外空间。

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

原始导出脚本还会写入一个 T8 对比候选。选定的 v4.1 文件是 T12。不同的线性代数实现可能产生不同的字节结果；重新生成的模型需要通过价值/动作以及策略分数的验证。

详见[最终研究报告](vela-v4.1/report-ko.md)。在 90,000 局独立配对对局中，候选模型得分为 1876.5108，FULL48 为 1878.0848；未达到原始的非劣性门槛。该对比针对的是 FULL48，而不是已部署的 H24+Four 模型。

来源：`adventure_vela/research/full_hand_dp/oneshot_full48_20260927/`（生成器）、`adventure_vela/research/value_compression/full48_shared_structure_v1_20260927/`（压缩/报告）以及 `adventure_vela/bak/legacy_20260926/S2_20260919_RDC/vendor/research/`（头文件）。仅为适应当前目录布局调整了 `common.py` 中的输入路径。报告中的图片嵌入和本机链接以文字形式呈现；原始证据保留在源研究目录中。

参考的解码后模型 SHA-256：`261ed5f731511119391278ae8800597ded67dbb882808e06ba2633ee58a292dc`。

---

## VELA v1–v4 — 上一代生成工作流

要从零生成 VELA-v4 模型，请使用 **V1、V3 和 V4** 的生成器。不要在此工作流中使用 V2 生成器。

## 所需目录

| 目录 | 用途 |
|---|---|
| `vela-v1/research/` | 计算 DP4 价值并生成 `four-projected-24.bin` |
| `vela-v3/research/` | 计算 DP5 价值并导出 H24 检查点 |
| `vela-v4/research/` | 将 H24 检查点转换为 `h24.raw` |

请使用这些目录下的全部 16 个文件，包括头文件和脚本。

## 生成步骤

1. **V1：**编译 `four-project.cpp` 并以 horizon 参数 `24` 运行。输出为 `results/four-projected-24.bin`。
2. **V3：**用 `build-model.sh` 生成 DP5 表。保留脚本从已保存的 H2 值重启的逻辑。
3. **V3：**使用 `export-checkpoint.cpp` 导出 horizon `24`。将得到的 `*_part1.qdelta.gz` 和 `*_part2.qdelta.gz` 按此顺序解压并拼接，生成 `h24.qdelta`。
4. **V4：**运行由 `convert-checkpoint.cpp` 编译出的可执行文件，参数为 `h24.qdelta h24.raw`。

所需的最终价值表是 **`four-projected-24.bin` 和 `h24.raw`**。请将这两个文件放到现有 VELA-v4 运行时所期望的模型位置。运行时本身不包含在本目录中。

## 命令示例

在 **Linux/WSL Bash** 中从仓库根目录（`research/` 的上一级目录）开始运行以下命令。本示例假定输出目录是全新的，且已安装下列依赖。它会执行完整的模型计算，并不是快速冒烟测试。传给 `build-model.sh` 的 `4` 表示选择四个线程。

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

  # V3：带 H2 重启的 DP5，然后导出 H24
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

两个最终文件都会位于 `research/vela-v4/model/`。V3 的中间结果保留在 `research/vela-v3/model/`。`build-model.sh` 拒绝覆盖非空的 `model/dp5/` 目录；它不是通用的中断运行恢复命令。

## 环境与验证状态

需要 C++17、OpenMP、Python 3、Bash 和 gzip。V3 导出器使用了 POSIX mmap 和 zlib，因此本工作流面向 Linux/WSL。

在整理本包的过程中没有进行任何编译、模型重算或运行。重新生成的模型与现有模型之间的哈希一致性仍需单独验证。
