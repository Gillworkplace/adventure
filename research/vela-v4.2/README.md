# VELA v4.2 — COMPACT100 Hinge

部署模型是冻结的 `hinge_k256_e1.bin`。SHA-256 为 `3b25cacd47d1de76ef0a6d6ba60d0cf3e4ce6fcc946c3bfa305cdd3a04a879e9`，大小为 91,179,876 bytes（86.96 MiB）。策略为 `base`、`gamma=0`、`OPT=4228`、2-step expectimax 与实际剩余牌堆，DeckPotential β=0.6。不添加 H24/Four 校正。

本包包含价值模型生成、压缩和 Hinge 训练所需的代码、执行命令以及最终结果摘要。不包含最终分数预测器的训练资料。部署文件的安装与 WASM 构建请参阅[运行源码说明](../../src/policies/vela/native/README.md)。

## 包含范围

| 路径 | 作用 |
|---|---|
| `full100/solve-hands-full100.cpp` | cap5、horizon100 价值表生成器 |
| `include/{value-model,core,tables}.hpp` | 生成器依赖的 3 个头文件 |
| `compression/build_models.py`、`compression/src/common.py` | FULL100 共享手牌/时间结构学习及 int16 导出 |
| `compression/quant_balance.py` | 函数保持通道倍率缩放后再量化 |
| `compression/collect_q.py`、`refine_actions.py`、`src/action_train/` | 固定 teacher/student 动作样本与 Hinge 训练、筛选 |
| `compression/include/` | Hinge 训练与 FULL100 teacher 的依赖头文件 |

生成 FULL100 所需的源码**仅限上述 4 个文件**。压缩和 Hinge 训练需要另外的依赖文件。不包含原始 FULL100、训练中间数据、其他候选模型和可执行文件。生成产物属于 Git 排除对象。

## FULL100 生成

准备 Windows MSYS2 UCRT64 g++（C++17/OpenMP）、Python 3 与 NumPy。在项目根目录执行。

```powershell
New-Item -ItemType Directory -Force research/vela-v4.2/bin | Out-Null
g++ -std=c++17 -O3 -march=native -fopenmp -I research/vela-v4.2/include research/vela-v4.2/full100/solve-hands-full100.cpp -o research/vela-v4.2/bin/solve-hands.exe
./research/vela-v4.2/bin/solve-hands.exe 5 100 research/vela-v4.2/full100/model/full100 6
```

这是完整的生成命令。生成 cap5、r=0 到 100，不会从 FULL48 恢复续算。仅 tier 文件就需要约 88 GiB，pair 投影和压缩中间结果还需要额外空间。本次发布准备时没有重新运行完整生成。`ready.json` 记录已完成的层。普通重跑会覆盖输出，请使用新的输出文件夹。

## 选定 Hinge 的生成路径

以下是高成本的研究复现命令，下载并使用运行时模型并不需要它们。在 Windows 上将 `C:/msys64/ucrt64/bin` 加入 PATH 后，从项目根目录执行。

```powershell
g++ -std=c++20 -O3 -ffp-contract=off research/vela-v4.2/compression/src/action_train/study.cpp -o research/vela-v4.2/compression/src/action_train/study.exe
Copy-Item research/vela-v4.2/compression/src/action_train/study.exe research/vela-v4.2/compression/src/action_train/study_student.exe
Push-Location research/vela-v4.2/compression
try {
    python -c "from build_models import *; fit(False, {'unified_k192_t24': (192,24), 'unified_k256_t16': (256,16)}, 'unified')"
    python make_diagnostic_queries.py
    python quant_balance.py unified_k256_t16
    python collect_q.py
    python refine_actions.py
} finally { Pop-Location }
```

同时计算 K192 是为了保持原始 K256 训练的随机数消耗与共享结构。`make_diagnostic_queries.py` 只生成与原始流程相同的固定 20,000 个价值诊断样本。

Hinge 混合固定的 teacher/student 样本训练 3 个 epoch，并以单独 validation 的 teacher Q2 regret 选择 epoch。选定的文件是 `models/hinge_k256_e1.bin`。原始流程使用 512 个 train seed/128 个 validation seed，并且不会把两个动作策略在相同 seed 下的轨迹重复计为独立对局。最终的 100,000 局对局库在模型选定后冻结。

BLAS、编译器和浮点运算的差异可能使重新生成的结果不同。源码包不保证逐字节一致的复现。只有在核对模型 SHA 并通过 native/WASM 的价值/动作以及游戏分数验证之后，才能使用重新生成的模型。

## 现有评估结果

本次打包时没有重新运行对局评估。

| 策略 | 对局数 | 平均分 | 平均分的 95% CI |
|---|---:|---:|---|
| 选定的 Hinge / VELA v4.2 | 100,000 | 1878.13502 | [1876.88763, 1879.38241] |
| 已部署 VELA v4.1 / COMPACT48 | 1,000,000 | 1876.371112 | [1875.97794, 1876.76429] |
| 原始 FULL100 | 100,000 | 1878.03718 | [1876.79073, 1879.28363] |

v4.2 与 v4.1 是独立样本。基于现有结果计算的独立两样本均值差为 **+1.76391 分**，95% CI **[+0.45600, +3.07182]**，在统计上显著为正。这是使用不同评估时间点和执行器的比较，并非配对 seed 的重新评估。

与原始 FULL100 的配对差值为 +0.09784 分，95% CI [-1.04640, +1.24208]，因此未能确认有改进。与原始 FULL48 的独立比较为 +0.03860 分，95% CI [-1.72693, +1.80413]。通过了 0.1% 非劣性标准，但“得分高于 FULL48”这一单独研究目标是否达成未得到确认。

现有的 Web 移植在 5,460 个状态上与 native 的动作不一致数为 0，最大 Q 误差为 0。观测到的 WASM heap 约为 304.44 MiB，并非整个浏览器的内存占用。实机的延迟和最大内存需要按设备另行确认。

## 原始出处

- `adventure_vela/research/full_hand_dp/oneshot_full100_20260928/`
- `adventure_vela/research/value_compression/rethink100_20260929/`
- `adventure_vela/research/value_compression/joint_search_v2_20260929/src/full100_reference.hpp`
- `adventure_vela/bak/legacy_20260926/S2_20260919_RDC/vendor/research/`
- `adventure_vela/research/web_integration/compact100_hinge_20261003/`

仅为适应当前文件夹结构调整了 include 和输入路径。算法、训练超参数和 seed 保持不变。
