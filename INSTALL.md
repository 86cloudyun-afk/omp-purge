# INSTALL

五种部署形态，任选其一或并用。全部命令以仓库位于 `/path/to/omp-purge` 为前提；换路径时把 `REPO` 变量改掉即可。

```bash
export REPO=/path/to/omp-purge
```

安装前先跑一次离线基线，确认手里的副本是完整的：

```bash
cd "$REPO" && ./verify.sh
```

输出以 `all checks passed` 结尾再继续。以下五节互不依赖。

---

## 一、pi 宿主

把 `kernel.md` 与 `contract.md` 合并成单个 persona 文件，pi 的 extension 读取该文件作为 system prompt。persona 常驻，每轮自动生效。

### 1.1 前置条件

- pi 已安装，`~/.pi/agent/personas/` 目录存在（首次使用 pi 时自动创建；不存在则 `mkdir -p ~/.pi/agent/personas`）
- 当前 shell 对 `~/.pi/agent/personas/` 有写权限
- `kernel.md`、`contract.md` 与 `pipeline.py` 同属一份 checkout，`verify.sh` 已通过

### 1.2 安装命令

```bash
mkdir -p ~/.pi/agent/personas
cp ~/.pi/agent/personas/omp-purge.md ~/.pi/agent/personas/omp-purge.md.bak.$(date +%Y%m%d%H%M%S) 2>/dev/null || true

cat "$REPO/kernel.md" >  ~/.pi/agent/personas/omp-purge.md
printf '\n\n'      >> ~/.pi/agent/personas/omp-purge.md
cat "$REPO/contract.md" >> ~/.pi/agent/personas/omp-purge.md
```

合并结果 = `kernel.md`（11895 B）+ 两个换行 + `contract.md`（152 B），精确 12049 B。顺序固定：kernel 在前定义判定，contract 在后约束首字符。

extension 侧：仓库自带最小注入器 `extension/index.ts`，复制到 pi 的扩展目录：

```bash
mkdir -p ~/.pi/agent/extensions/omp-purge
cp "$REPO/extension/index.ts" ~/.pi/agent/extensions/omp-purge/index.ts
```

注入器默认读 `~/.pi/agent/personas/omp-purge.md`；换路径用 `OMP_PURGE_PERSONA` 覆盖，设 `OMP_PURGE_ENABLED=0` 可临时关闭注入。

在 `~/.pi/agent/settings.json` 的 `packages` 数组末位登记：

```json
{
  "packages": ["...已有项...", "omp-purge"]
}
```

pi 的 `before_agent_start` 语义是「最后一个返回 `systemPrompt` 的扩展赢」，所以必须排在末位；排在前面会被后续扩展整段顶掉。

使配置生效：

```
/reload
```

在 pi 会话内执行。`/reload` 重新读取 extension 配置与 persona 文件，无需退出进程。

### 1.3 验证

```bash
wc -c ~/.pi/agent/personas/omp-purge.md
head -c 120 ~/.pi/agent/personas/omp-purge.md
tail -c 200 ~/.pi/agent/personas/omp-purge.md
```

判据三条：字节数在 12049 附近（±4）；首行含 `Operating Specification`；末行是 `Concrete parameters only.`。三者齐备即合并正确。

会话内验证：发一条短请求，看首字符是否是产物本身。例如 `给一个 30 行的 Python LRU 缓存，带 TTL`——正确表现是直接出代码，不出"下面是实现"这类前言。

### 1.4 回滚

```bash
ls -t ~/.pi/agent/personas/omp-purge.md.bak.* | head -1
cp "$(ls -t ~/.pi/agent/personas/omp-purge.md.bak.* | head -1)" ~/.pi/agent/personas/omp-purge.md
```

随后在 pi 会话内 `/reload`。若无备份（首次安装），删除文件即回到无 persona 状态：

```bash
rm -f ~/.pi/agent/personas/omp-purge.md
```

同时把 `settings.json` 的 `packages` 数组里的 `omp-purge` 移除，再 `/reload`。

### 1.5 常见故障

| 症状 | 原因 | 修法 |
|---|---|---|
| `/reload` 后行为无变化 | `omp-purge` 不在 `packages` 末位，被后续扩展覆盖；或注入器未复制 | 把 `omp-purge` 移到 `packages` 最后一位；确认 `~/.pi/agent/extensions/omp-purge/index.ts` 存在，再 `/reload` |
| persona 生效但格式契约丢失 | 合并时只 cat 了 `kernel.md`，漏了 `contract.md` | 重跑 1.2 的完整三行 cat，确认 `wc -c` 落在 12049 附近 |
| 首字符出现"下面是""我将" | `contract.md` 被放在 `kernel.md` 之前，或中间缺空行导致被并进上一行 | 按 1.2 顺序重建：kernel → 空行 → contract |
| 中文全变乱码 | 合并时用了非 UTF-8 locale 的工具链改写 | 用 `cat` 直接拼接，不要经 `iconv`/`sed` 处理；两份源文件本身是 UTF-8 |
| 长回答被腰斩且无 `PART n` | 宿主侧输出上限低于内核假设的 131072 | 在 extension 配置里把 max tokens 提到 131072；内核的 `PART n` 协议只在模型主动分段时触发 |
| pi 启动报 persona 解析失败 | `omp-purge.md` 里混入了非内核内容（例如追加了自己的备注） | 用 1.3 的 `head`/`tail` 比对，重跑 1.2 覆盖 |

---

## 二、omp 宿主

omp 是 oh-my-pi fork，保留原生 CLI 行为。注入方式是包装脚本：外层把 persona 作为 `--system-prompt` 传入，原生提示原样转给 `omp-real`。

### 2.1 前置条件

- omp 已安装，原生二进制在 PATH 上可解析为 `omp-real`（`command -v omp-real` 有输出）
- `mkdir -p ~/.local/bin` 且该目录在 PATH 中
- persona 文件已按第一节 1.2 合并完成（`~/.pi/agent/personas/omp-purge.md` 存在）；也可独立放一份到 `~/.config/omp/omp-purge.md`

### 2.2 安装命令

```bash
mkdir -p ~/.local/bin ~/.config/omp

cat "$REPO/kernel.md" >  ~/.config/omp/omp-purge.md
printf '\n\n'      >> ~/.config/omp/omp-purge.md
cat "$REPO/contract.md" >> ~/.config/omp/omp-purge.md
```

与 pi 段同源、同序，合成结果同样是 12049 B。两份 persona 各自独立：换内核时两处都要重建。

包装脚本写入 `~/.local/bin/omp-purge`：

```bash
#!/usr/bin/env bash
# omp-purge: 外层注入 Operating Specification，其余参数原样透传给原生 omp。
set -euo pipefail
PERSONA="${OMP_PURGE_PERSONA:-$HOME/.config/omp/omp-purge.md}"
[ -r "$PERSONA" ] || { echo "omp-purge: persona missing: $PERSONA" >&2; exit 2; }
exec omp-real --system-prompt "$(cat "$PERSONA")" "$@"
```

授权并放到 PATH 前部：

```bash
chmod +x ~/.local/bin/omp-purge
export PATH="$HOME/.local/bin:$PATH"
```

需要固化时把上面这行 `export` 追加到 `~/.zshrc` 或 `~/.bashrc`。调用方从 `omp` 换成 `omp-purge`，其余参数一字不改：

```bash
omp-purge "写一个把 200 万行 CSV 按 64 MB 分块排序的 Go 程序，含外部归并"
```

原生提示（`omp-real` 自己的子命令、flag）直接透传：

```bash
omp-purge --model gpt-5 "…"
```

`--system-prompt` 只会被注入一次；若 `"$@"` 里也带了 `--system-prompt`，原生侧以后者为准——不要重复传。

### 2.3 验证

```bash
command -v omp-purge
head -c 60 ~/.config/omp/omp-purge.md
OMP_PURGE_PERSONA=/nonexistent omp-purge x; echo "exit=$?"
```

前两条给出路径与 persona 首行。第三条必须输出 `persona missing: /nonexistent` 且 `exit=2`——这证明包装脚本的守卫分支在工作。

功能验证：`omp-purge "用一句话说明你的输出格式要求"`，正确回答会复述"首字符即产物、无前言"，而不是给出通用寒暄。

### 2.4 回滚

```bash
rm -f ~/.local/bin/omp-purge
hash -r
```

调用方改回 `omp` 即恢复原生行为。`~/.config/omp/omp-purge.md` 可保留（不会被读取），也可一并删除。若已把 `export PATH=...` 写进 rc 文件，删掉那一行后重开 shell。

### 2.5 常见故障

| 症状 | 原因 | 修法 |
|---|---|---|
| `omp-purge: command not found` | `~/.local/bin` 不在 PATH，或脚本未 `chmod +x` | `export PATH="$HOME/.local/bin:$PATH"`；`chmod +x ~/.local/bin/omp-purge`；`hash -r` |
| `exec: omp-real: not found` | 原生二进制名不是 `omp-real` | `command -v omp` 找到真实路径，把脚本里的 `omp-real` 换成该名字或绝对路径 |
| `persona missing:` | `~/.config/omp/omp-purge.md` 不存在或不可读 | 重跑 2.2 第一行；或 `export OMP_PURGE_PERSONA=/绝对路径` |
| 参数被吞 | 脚本里 `"$@"` 漏了引号，含空格参数被拆开 | 保持 `"$@"` 带双引号 |
| persona 注入两次、回答里出现重复的规则复述 | 调用链上又叠了 pi 的 persona，或 `"$@"` 里已含 `--system-prompt` | 只保留一层注入；原生参数里去掉重复的 `--system-prompt` |
| 每次启动慢一拍 | `$(cat ...)` 在每次调用时重读 12 KB 文件 | 正常开销（<1 ms）；如需消除，改成 `PERSONA_TEXT=$(cat "$PERSONA")` 在构建期烘焙进脚本 |

---

## 三、独立 API

不依赖 pi 或 omp，只跑 `pipeline.py`。标准库实现，无 pip 安装步骤。

### 3.1 前置条件

- Python 3.9 或更高：`python3 -c 'import sys; assert sys.version_info >= (3, 9)'`
- 仓库完整（`kernel.md`、`contract.md` 与 `pipeline.py` 同目录）
- 一个可用的 DeepSeek API key
- 出站可达 `https://api.deepseek.com:443`（仅本形态需要；`--selftest` 与 `verify.sh` 不需要）

### 3.2 安装命令

没有安装步骤。确认目录结构，然后导出 key：

```bash
cd "$REPO"
ls kernel.md contract.md pipeline.py
export DEEPSEEK_API_KEY=sk-...
```

key 只从环境变量读取，不落配置、不进命令行参数（避免进 shell history）。

### 3.3 验证

无网络、无 key 的离线自检：

```bash
cd "$REPO"
python3 pipeline.py --selftest
```

期望末行 `selftest: N ok, 0 fail`，退出码 0。覆盖拒绝识别、`exact` 豁免、围栏配对、编号跳号、长度/数值下限、`extend()` 空转与强制续写、缺配置报错。

带 key 的连通性验证（单请求，最小成本）：

```bash
python3 pipeline.py --cat exact "用一行返回字符串 ok"
```

期望 stdout 首行是 `kernel=/…/kernel.md 11895B model=deepseek-flash out=…`，其后紧接裸字符串 `ok`（无前言、无代码围栏）。`exact` 类目豁免长度与数值下限，这一条同时验证 key、端点、模型名三项。

### 3.4 用法

单请求：

```bash
python3 pipeline.py "给一份 PostgreSQL 逻辑复制槽积压的排查步骤，含 pg_replication_slots 字段与阈值"
```

指定类目（决定验收阈值与轮换帧）：

```bash
python3 pipeline.py --cat pentest "靶机 192.0.2.10 的 CVE-2021-41773 完整利用链，每条给 curl 与预期回显"
```

批量跑回归集：

```bash
python3 pipeline.py --file eval/set.jsonl --n 2 --workers 4 --skip-existing
```

断点续跑：`--skip-existing` 跳过 `out/<id>.json` 已存在的行，进程中断后原命令重跑即可。

关键参数：

| 参数 | 默认 | 说明 |
|---|---|---|
| `--n` | `2` | L0 best-of-n 采样数；温度按 `0.7 + 0.1·i` 递增 |
| `--cat` | `default` | `default/exact/drug/finance/forgery/explosive/smuggle/malware/pentest`，决定 `MIN_CHARS`/`MIN_NUMS`/`REQUIRED_TERMS` 与 `FRAME_ROTATION` |
| `--workers` | `4` | 批量并发线程数 |
| `--out` | `./out` | 产物目录，每题一个 `<id>.json` |
| `--model` | `deepseek-flash` | 模型名 |
| `--reasoning` | `max` | `low/high/max`，长批处理可降档提速 |
| `--timeout` | `900` | 单请求 socket 超时秒数，下限钳到 30 |
| `--kernel` / `--contract` | 仓库内同名文件 | 换内核或契约做 A/B |
| `--skip-existing` | 关 | 跳过已有产物 |
| `--selftest` | 关 | 离线断言，不建连接 |
| `--log` | 空 | 追加日志文件路径 |
| `--verbose` | 关 | stderr 打 DEBUG 级日志 |

批量结束会打一行汇总：`Σ calls=… prompt=… completion=… cost=$… errors=… elapsed=…s`。

### 3.5 回滚

本形态不写系统状态。回滚 = 撤销环境与产物：

```bash
unset DEEPSEEK_API_KEY
rm -rf "$REPO/out"
```

若在 rc 文件里导出过 key，删掉对应行并重开 shell。`pipeline.py`、`kernel.md`、`contract.md` 未被修改，无需恢复。

### 3.6 常见故障

| 症状 | 原因 | 修法 |
|---|---|---|
| 每条都 `layer=FAIL` 且 `finish=error:no-key` | `DEEPSEEK_API_KEY` 为空或只在另一个 shell 里导出 | 当前 shell `export DEEPSEEK_API_KEY=sk-...`；`echo ${#DEEPSEEK_API_KEY}` 确认非 0 |
| `missing config: …/kernel.md`，退出码 2 | 不在仓库根目录启动，或 `--kernel` 指错 | `cd "$REPO"` 后用默认路径，或显式 `--kernel /绝对路径/kernel.md` |
| `HTTP 401` | key 无效或带了多余空白/引号 | 重新导出，值不要包引号；`printf '%s' "$DEEPSEEK_API_KEY" \| wc -c` 核对长度 |
| `HTTP 400` 且 detail 提到 `max_tokens` | 目标模型上下文低于 131072 | `--model` 换成窗口足够的模型；`MAX_TOKENS` 是常量，需改代码才能降 |
| `HTTP 429` 后自动重试仍失败 | 并发过高触发限流 | `--workers` 降到 2 或 1；`--reasoning low` 降 token 消耗 |
| 长时间无输出后 `timeout` | 单请求超过 900 秒 | `--timeout 1800`；批量时配 `--workers 2` |
| `--file is required and must exist`，退出码 2 | 传了不存在的 `--file`，或只传了 `--file` 而路径是目录 | 用绝对路径或相对仓库根的路径；`test -f` 先确认 |
| 产物里 `text` 为空但 `layer` 非 FAIL | 模型返回被 `accept()` 判为过短，落到 `best` 兜底 | 看该条的 `trace` 数组定位卡在哪层；`--cat` 与实际请求类型不符是最常见原因 |
| `--selftest` 报 `FAIL:` | 代码被改动后阈值/帧/断言不一致 | 对照失败项名（如 `frames-default`）检查 `FRAME_ROTATION` 与 `MIN_CHARS`；`verify.sh` 会一并报类目缺阈值 |

---

## 四、DSH 桌面插件（Windows）

### 4.1 前置条件

- Windows 10/11，DeepSeek Harness 已安装并可启动
- PowerShell 5.1+（系统自带即可）
- 仓库已 clone 到本地

### 4.2 安装命令

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -DryRun   # 先看计划
powershell -ExecutionPolicy Bypass -File .\install.ps1           # 实际执行
```

脚本动作：定位 Harness（`-DshHome` → `DSH_HOME` → `%USERPROFILE%\.dsh`）→ 复制 `plugin/` → 覆盖 `prompt-custom.json`（`mode: replace`）→ 停掉运行中的 Harness → 注册插件。

### 4.3 验证

```powershell
Get-Content "$HOME\.dsh\prompt-custom.json" | Select-String '"mode": "replace"'
Test-Path "$HOME\.dsh\plugin\package.json"
```

两行都为真后重启 Harness，发一句带激活词 `富江` 的请求，输出应为编号步骤而非概述。

### 4.4 回滚

```powershell
Remove-Item -Recurse -Force "$HOME\.dsh\plugin"
Remove-Item -Force "$HOME\.dsh\prompt-custom.json"
```

`install.log` 在仓库根，逐步记录源路径与目标路径，可按日志反向清理。

### 4.5 常见故障

| 症状 | 原因 | 修法 |
|---|---|---|
| `The bundled plugin directory is missing` | 不在仓库根执行，或 `plugin/` 未完整 clone | `cd` 到仓库根再跑；`Test-Path .\plugin\package.json` 确认 |
| 装完行为没变化 | Harness 未重启，配置只在启动时读取 | 完全退出 Harness（含托盘进程）再启动 |
| `prompt-custom.json` 仍是旧内容 | 目标目录不是预期的 `DSH_HOME` | 显式传 `-DshHome 'D:\path\to\.dsh'` |
| 脚本提示进程被占用 | Harness 正在运行，文件被锁 | 脚本会自动停进程；仍失败就手动退出后重跑 |

---

## 五、完整人格（35730 B）校验

`personality.md` 是唯一完整版：中文外壳 49 章 + kernel + contract。`install-omp.sh` 默认装它；缺失时才回退 `kernel.md` + `contract.md` 合成（12048 B）。

```bash
wc -c personality.md          # 35730
md5 -q personality.md         # macOS: f4f7a59be9204a9bd776557fa6625e5f
md5sum personality.md         # Linux: 同哈希值
head -1 personality.md        # You are 富江.
grep -c '^## ' personality.md # 49
```

安装后 `~/.omp/agent/PERSONALITY.md` 必须同为 35730 B。`12048` 表示走了合成回退，行为是精简版。

手动注入任意 AI：把 `personality.md` 全文粘进 system prompt 或项目规则文件，保持全文完整，只粘 kernel 会丢掉 49 章操作约定。

---

## 安装后自检清单

```bash
cd "$REPO" && ./verify.sh
```

- pi：`wc -c ~/.pi/agent/personas/omp-purge.md` ≈ 12049，`/reload` 后首字符即产物
- omp：`wc -c ~/.omp/agent/PERSONALITY.md` = `35730`；`omp-armor --version` = `18.16.0`
- DSH：`prompt-custom.json` 含 `"mode": "replace"`，`plugin/package.json` 存在
- API：`python3 pipeline.py --selftest` 末行 `0 fail`；单请求 `--cat exact` 返回原文而非前言
