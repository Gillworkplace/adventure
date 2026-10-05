# VELA v4.2 WASM 构建

这是冻结的 COMPACT100 Hinge `hinge_k256_e1.bin` 的浏览器移植源码。保持研究原始版本的计算顺序与平局选择规则，使用 `OPT=4228`、`base`、`gamma=0`、2-step expectimax、实际不放回的牌堆以及 DeckPotential β=0.6。没有 H24/Four 校正，也没有额外的策略调优。

## 构建

准备 Python 3 和 Emscripten **4.0.23**。SDK 安装在 `.tools/emsdk-main/`。

```powershell
git clone https://github.com/emscripten-core/emsdk.git .tools/emsdk-main
python .tools/emsdk-main/emsdk.py install 4.0.23
python .tools/emsdk-main/emsdk.py activate 4.0.23
```

如果 SDK 已就绪，可跳过安装。将 Release 中的 `model.bin.gz` 不解压直接放入 `public/models/vela-v4.2/`，然后在项目根目录执行。

```powershell
python scripts/vela/build.py
```

构建会生成 `vela.mjs`、`vela.wasm`，并更新 manifest 中的可执行文件哈希。使用 C++20、`-ffp-contract=off`、最大 WASM 内存 512 MiB、栈 2 MiB。不使用 fast-math。

## 模型与状态契约

- 模型：91,179,876 bytes，SHA-256 `3b25cacd47d1de76ef0a6d6ba60d0cf3e4ce6fcc946c3bfa305cdd3a04a879e9`。
- gzip 部署文件：68,320,365 bytes。运行时不需要原始 FULL100。
- 输入：`[position, paidDiceUsed, bonusRoll, handCount, h0, h1, h2, h3, h4, deckMask]`。卡牌 ID 为物理 ID 1~30，牌堆为实际剩余的 30 位掩码。
- 返回：`0=骰子`，`1..handCount=输入的手牌槽位`。horizon 限制由原有的 planner 承担。
- `_values_ptr()` 的值是动作评估值，不应展示为最终分数预测。
- 通过 manifest 的 `scorePredictor:true` 读取 `public/models/vela-v4.2/predictor.json`。先核对 Hinge 专用预测器的模型 SHA，再用所选动作的 Q 预测分数。如果预测器无法读取或不兼容，则保留推荐动作，仅省略分数预测。

## 出处与验证

本目录由既有验证源码提升而来，该源码将研究原始的 `adventure_vela/research/value_compression/rethink100_20260929/src/runtime/` 适配到内存输入与 WASM 环境。未更改压缩与 planner 的运算。价值模型生成命令和研究结果摘要见[研究包](../../../../research/vela-v4.2/README.md)。

对比既有 native 的 WASM 验证在 5,460 个状态上动作不一致数为 0，最大 Q 误差为 0。提升后的可执行文件也会另行重新验证。观测到的 WASM heap 为 319,225,856 bytes，既不是浏览器整体内存，也不是所有状态下的最大用量。
