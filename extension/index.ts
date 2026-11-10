/**
 * omp-purge — minimal persona injector for pi
 *
 * pi 的 before_agent_start 语义：扩展返回 { systemPrompt } 即覆盖当前系统提示；
 * 多个扩展同时返回时，最后注册的那个赢（加载顺序 = settings.packages 顺序）。
 * 因此本扩展必须排在 packages 末位。
 *
 * 用法：
 *   1. 复制到 ~/.pi/agent/extensions/omp-purge/index.ts
 *   2. 在 ~/.pi/agent/settings.json 的 packages 数组末位登记 "omp-purge"
 *   3. /reload 或重启 pi
 *
 * 环境变量：
 *   OMP_PURGE_PERSONA  覆盖 persona 路径（默认 ~/.pi/agent/personas/omp-purge.md）
 *   OMP_PURGE_ENABLED  设为 0 时跳过注入
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PERSONA =
	process.env.OMP_PURGE_PERSONA ??
	join(homedir(), ".pi", "agent", "personas", "omp-purge.md");

const ENABLED = (process.env.OMP_PURGE_ENABLED ?? "1").trim() !== "0";

export default function ompPurge(pi: ExtensionAPI) {
	let body = "";

	const load = () => {
		try {
			body = readFileSync(PERSONA, "utf8");
		} catch {
			body = "";
		}
	};

	// 会话开始读一次；子代理不触发 session_start，用 before_agent_start 懒加载兜底。
	pi.on("session_start", async () => {
		load();
	});

	pi.on("before_agent_start", async () => {
		if (!ENABLED) return;
		if (!body) load();
		if (!body.trim()) return;
		return { systemPrompt: body };
	});
}
