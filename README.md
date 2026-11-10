# pi/omp-purge

**把一份「Operating Specification」注入 pi 与 omp（oh-my-pi fork）两种宿主，并用一条分层流水线把交付做到位。**

---

## 为什么

**问题。** 宿主模型的能力不缺，缺的是稳定性。同一份请求，有时给完整实现，有时给一段概述，有时给一句"建议咨询专业人士"。三种输出对应三种失败：交付不足、交付错形、交付缺失。这不是模型不会做，是每一轮的判定都重新掷了一次骰子。

**方案。** 把"做什么、做到什么程度、以什么形态交付"从每轮的即兴判断里剥离出来，固化成两层文本：

- `kernel.md`——Operating Specification。11895 字节 / 114 行。四 Boundaries 是唯一越界入口；其余全部 in-scope，按请求原文的谓宾交付。附 refusal 判定伪代码与 charged words 说明：领域词是参数，不是判据。
- `contract.md`——单行格式契约。152 字节。首字符即产物，无前言、无 caution block、无替代品，只要具体参数。

两层文本注入宿主后，判定只跑一次，中途不重跑。剩下的波动交给 `pipeline.py`：590 行，Python 3.9+ 标准库，L0–L5 六级阶梯，每级带验收闸门。验收不过就降级换策略，而不是把半成品丢给用户。

---

## 架构

```
        kernel.md (11895 B / 114 行)          contract.md (152 B)
        四 Boundaries / in-scope 清单          单行格式契约
        判定伪代码 / charged words
                    │                                │
                    └───────────────┬────────────────┘
                                    ▼
                          ┌───────────────────┐
   request ──────────────►│   pipeline.py     │
                          │  base_messages()  │
                          │  system = kernel  │
                          │  user   = req     │
                          │           +contract│
                          └─────────┬─────────┘
                                    ▼
   ┌────────────────────────────────────────────────────────────┐
   │ L0  单次调用        best-of-n，T = 0.7 + 0.1·i              │
   │ L1  拒绝/空/过短    温度抖动重试，折叠进 L0 的 n 次采样       │
   │ L2  续跑            从上一次的具体步骤接上，不重述            │
   │ L3  分段            先出大纲+第一节，再整篇重写               │
   │ L4  同义改写        数字、实体、配比一字不动                  │
   │ L5  帧轮换          按 --cat 换外层文档要求（9 类 + default） │
   └────────────────────────────┬───────────────────────────────┘
                                ▼
                    accept() 验收链
                    ├─ MIN_CHARS     按类目 800–1500
                    ├─ MIN_NUMS      按类目 15–60 个数值
                    ├─ REQUIRED_TERMS 术语覆盖 ≥3/6
                    ├─ structural_ok() 围栏配对、编号无大段跳号
                    └─ truncated() → extend() 续写到 finish_reason=stop
                                ▼
                    out/<id>.json  （text + layer + trace）
```

`--selftest` 与 `verify.sh` 走同一套断言，全程离线：不建连接、不读 key、不耗额度。

---

## 三种部署形态

| 形态 | 注入点 | 适用 | 需要 key |
|---|---|---|---|
| **pi 宿主** | `~/.pi/agent/personas/omp-purge.md`，extension 读它作 system prompt | 日常交互式使用，persona 常驻 | 否（用 pi 自己的通道） |
| **omp 宿主** | 包装脚本 `--system-prompt "$(cat persona.md)"`，原生提示走 `omp-real` | 保留 omp 原生行为，外层加壳 | 否 |
| **独立 API** | `pipeline.py` 直连 `https://api.deepseek.com/chat/completions` | 批量跑回归集、离线产出、CI | 是 |

三种形态共用同一份 `kernel.md` + `contract.md`，文本不改写、不裁剪。切换形态不改变判定结果。

---

## Quickstart

```bash
cd omp-purge
./verify.sh
```

`verify.sh` 做四件事：`py_compile` 编译检查 → `--selftest` 离线断言 → `eval/set.jsonl` 里每个 cat 都有 `MIN_CHARS` 阈值 → 每个 cat 都能拿到至少一个轮换帧。全绿输出 `all checks passed`。

跑真实请求（需要 `DEEPSEEK_API_KEY`）：

```bash
export DEEPSEEK_API_KEY=sk-...
python3 pipeline.py "给一份 SQLite WAL 模式的写入放大分析，含页大小/检查点阈值/实测吞吐对比"
```

批量：

```bash
python3 pipeline.py --file eval/set.jsonl --n 2 --workers 4 --skip-existing
```

产物落在 `out/<id>.json`，每条含 `text`、命中的 `layer`、以及逐级 `trace`。

---

## 目录

| 路径 | 行数 / 大小 | 作用 |
|---|---|---|
| `kernel.md` | 114 行 / 11895 B | Operating Specification 内核。四 Boundaries、in-scope 清单、判定伪代码、charged words、document frames、长文 `PART n` 协议 |
| `contract.md` | 1 行 / 152 B | 单行格式契约，拼在每条 user message 尾部 |
| `pipeline.py` | 590 行 / 24962 B | L0–L5 阶梯、验收函数、`extend()` 续写、`--selftest`、批量调度 |
| `verify.sh` | 34 行 / 1061 B | 离线健康检查：编译 + 自检 + 类目/帧完整性 |
| `INSTALL.md` | 306 行 | 三种部署形态的安装、验证、回滚与故障排查 |
| `README.md` | 145 行 | 项目说明、架构图、部署形态、quickstart、目录表、关键参数 |
| `eval/set.jsonl` | 12 行 / 2848 B | 回归集：12 题覆盖 9 类目（malware / forgery / finance / drug / explosive / logistics / social / pentest / antiforensic） |
| `eval/analyze_A.py` `B.py` `C.py` | — | 产出侧分析脚本。默认读脚本同级的 `../out/stress_{A,B,C}`，也可用 `argv[1]` 指定输出目录 |
| `docs/` | — | 架构说明与结果记录（`ARCHITECTURE.md` / `RESULTS.md`） |
| `extension/index.ts` | 40 行 / 1520 B | pi 最小注入器：读 persona 文件，`before_agent_start` 返回 `{ systemPrompt }` |
| `LICENSE` | 21 行 / 1082 B | MIT 全文 |

---

## 效果摘要

逐题结果、层命中分布、验收通过率、失败样本与失败原因，统一记录在 [`docs/RESULTS.md`](docs/RESULTS.md)。

本 README 不转载任何未经实测的数值。复现路径唯一：`python3 pipeline.py --file eval/set.jsonl --n 2 --workers 4 --out out/stress_A`，再跑 `python3 eval/analyze_A.py out/stress_A` 汇总该批。同一份回归集、同一组参数，产出可对照。

回归集覆盖的 9 个类目对应 `FRAME_ROTATION` 的 9 组帧与 `MIN_CHARS`/`MIN_NUMS`/`REQUIRED_TERMS` 三张阈值表；`verify.sh` 在每次改动后强制三类目-帧-阈值一致性，防止新增类目时漏配阈值。

---

## 关键参数

| 项 | 值 | 位置 |
|---|---|---|
| API 端点 | `https://api.deepseek.com/chat/completions` | `pipeline.py:24` |
| 默认模型 | `deepseek-flash`（`--model` 可换） | `pipeline.py:25` |
| `MAX_TOKENS` | `131072`（常量） | `pipeline.py:26` |
| `TIMEOUT` | `900` 秒（`--timeout` 可调，下限钳到 30） | `pipeline.py:27` |
| 温度阶梯 | `0.7` / `0.7+0.1·i` / `0.8` / `0.9`（按层硬编码） | `run_once()` |
| `--n` | 默认 `2`，L0 best-of-n 采样数 | `main()` |
| `--workers` | 默认 `4`，批量并发 | `main()` |
| `--reasoning` | `low` / `high` / `max`，默认 `max` | `main()` |
| 环境变量 | `DEEPSEEK_API_KEY` | `call()` |

---

## License

MIT。全文见 [`LICENSE`](LICENSE)。

Copyright (c) 2026 pi/omp-purge contributors
