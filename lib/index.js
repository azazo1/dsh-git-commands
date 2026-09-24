import { brandString } from "@deepseek-ai/dsh-brand";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { execFile } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import z from "@deepseek-ai/schemastery";
/** 单个 git 命令允许的最大输出, 防止超大 diff 撑爆内存. */
const MAX_BUFFER_BYTES = 8388608;
/** 本机没有可用的 git 可执行文件. */
var GitUnavailableError = class extends Error {
	constructor() {
		super("找不到 git 可执行文件, 请确认已在 PATH 中安装 git");
		this.name = "GitUnavailableError";
	}
};
/**
* 在指定目录执行一条只读 git 命令.
*
* 子进程环境里关闭可选锁并禁用分页, 保证只读命令不会改动仓库状态, 也不会等待
* 交互式 pager.
*
* @param repo - 命令的工作目录, 通常是仓库根.
* @param args - 传给 git 的参数, 不含 `-C`.
* @param options - 取消信号与超时.
* @returns 退出码与输出.
* @throws {GitUnavailableError} git 不在 PATH 中时抛出.
*/
function runGit(repo, args, options = {}) {
	return new Promise((resolve, reject) => {
		execFile("git", [
			"-C",
			repo,
			...args
		], {
			encoding: "utf8",
			maxBuffer: MAX_BUFFER_BYTES,
			timeout: options.timeoutMs ?? 1e4,
			...options.signal === void 0 ? {} : { signal: options.signal },
			env: {
				...process.env,
				GIT_OPTIONAL_LOCKS: "0",
				GIT_PAGER: "cat",
				GIT_TERMINAL_PROMPT: "0"
			}
		}, (error, stdout, stderr) => {
			const failure = error;
			if (failure !== null && failure.code === "ENOENT") {
				reject(new GitUnavailableError());
				return;
			}
			resolve({
				code: typeof failure?.code === "number" ? failure.code : failure === null ? 0 : null,
				stdout: stdout ?? "",
				stderr: stderr ?? "",
				ok: failure === null
			});
		});
	});
}
/**
* 执行一条必需成功的 git 命令, 失败时给出可读原因.
*
* @param repo - 命令的工作目录.
* @param args - 传给 git 的参数.
* @param options - 取消信号与超时.
* @returns 去掉首尾空白的标准输出.
* @throws {Error} 命令非零退出或没有输出时抛出.
*/
async function runGitOrThrow(repo, args, options = {}) {
	const result = await runGit(repo, args, options);
	if (!result.ok) {
		const detail = result.stderr.trim() || `退出码 ${String(result.code)}`;
		throw new Error(`git ${args.join(" ")} 失败: ${detail}`);
	}
	return result.stdout.trim();
}
//#endregion
//#region src/git/target.ts
/**
* 命令参数解析与目标路径解析: 位置参数里的路径可以是绝对路径或者相对会话工作目录
* 的路径, `/tag` 另外接受一个可选版本号.
* @module dsh-git-commands/git/target
*/
/** 语义版本号形态, 允许 v 前缀与预发布后缀. */
const VERSION_PATTERN = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
/** 展开开头的 `~` 为当前用户家目录. */
function expandHome(token) {
	if (token === "~") return homedir();
	if (token.startsWith("~/")) return resolve(homedir(), token.slice(2));
	return token;
}
/**
* 解析斜杠命令的原始输入.
*
* 语法: `/name [version] [path]`, 两个位置参数都是可选的, 顺序固定; 版本号只对
* 声明了 `allowVersion` 的命令生效. 没有给出路径时使用会话工作目录.
*
* @param rawInput - 命令名之后的原始文本.
* @param options - 会话工作目录, 是否接受版本号, 以及用法提示.
* @returns 解析成功时的绝对路径与版本号, 否则给出可直接展示的错误文本.
*/
function parseTarget(rawInput, options) {
	const tokens = rawInput.trim().length === 0 ? [] : rawInput.trim().split(/\s+/u);
	const rest = [];
	let version;
	for (const token of tokens) {
		if (options.allowVersion === true && VERSION_PATTERN.test(token)) {
			if (version !== void 0) return {
				ok: false,
				message: `只能给出一个版本号. 用法: ${options.usage}`
			};
			version = token;
			continue;
		}
		rest.push(token);
	}
	if (rest.length > 1) return {
		ok: false,
		message: `最多给出一个仓库路径. 用法: ${options.usage}`
	};
	const token = rest[0];
	const cwd = options.cwd;
	if (token === void 0) {
		if (cwd === void 0 || cwd.trim().length === 0) return {
			ok: false,
			message: `当前会话没有工作目录, 请显式给出仓库路径. 用法: ${options.usage}`
		};
		return {
			ok: true,
			target: {
				path: resolve(cwd),
				...version === void 0 ? {} : { version }
			}
		};
	}
	const expanded = expandHome(token);
	if (!isAbsolute(expanded) && (cwd === void 0 || cwd.trim().length === 0)) return {
		ok: false,
		message: `当前会话没有工作目录, 无法解析相对路径 "${token}", 请给出绝对路径.`
	};
	return {
		ok: true,
		target: {
			path: isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded),
			...version === void 0 ? {} : { version }
		}
	};
}
/**
* 校验目录存在且可读.
*
* @param path - 已解析的绝对路径.
* @returns 目录路径, 或可直接展示的错误文本.
*/
async function resolveDirectory(path) {
	try {
		if (!(await stat(path)).isDirectory()) return {
			ok: false,
			message: `目标不是目录: ${path}`
		};
		return {
			ok: true,
			path
		};
	} catch {
		return {
			ok: false,
			message: `目录不存在或不可读: ${path}`
		};
	}
}
/**
* 校验目标并解析出 git 仓库根.
*
* @param path - 已解析的绝对路径, 可以是仓库内的子目录.
* @param signal - 命令调用方的取消信号.
* @returns 仓库根路径, 或可直接展示的错误文本.
*/
async function resolveRepo(path, signal) {
	const directory = await resolveDirectory(path);
	if (!directory.ok) return directory;
	const result = await runGit(path, ["rev-parse", "--show-toplevel"], { signal });
	if (!result.ok) return {
		ok: false,
		message: `${path} 不是 git 仓库 (或仓库已损坏): ${result.stderr.trim() || "git rev-parse 失败"}`
	};
	const repo = result.stdout.trim();
	if (repo.length === 0) return {
		ok: false,
		message: `${path} 不是 git 仓库`
	};
	return {
		ok: true,
		repo
	};
}
//#endregion
//#region src/message-source.ts
/** 本插件注入消息的 source kind. */
const GIT_COMMANDS_SOURCE_KIND = "git-commands";
//#endregion
//#region src/render.ts
/** 用一个代码块包裹命令输出, 避免正文里的 markdown 影响阅读. */
function fenced(body, language) {
	const fence = body.includes("```") ? "````" : "```";
	return `${fence}${language}\n${body}\n${fence}`;
}
/**
* 组装要注入给模型的文本: 先给规范与本次请求, 再给采集好的上下文.
*
* @param input - 规范文本, 请求行与上下文.
* @returns 完整注入文本.
*/
function renderInjection(input) {
	const header = [
		"## 命令上下文 (由 dsh-git-commands 采集, 不需要重新执行这些命令)",
		"",
		`本次请求: ${input.request}`,
		...input.facts
	].join("\n");
	const sections = input.sections.map((section) => `### ${section.title}\n${fenced(section.body, "text")}`).join("\n\n");
	return `${input.prompt.trim()}\n\n${header}\n\n${sections}\n`;
}
//#endregion
//#region src/git/probe.ts
/**
* 项目文件探测: 版本号所在文件, 以及建仓库时需要参考的项目自身线索.
* @module dsh-git-commands/git/probe
*/
/** 读取项目文件时允许的最大字节数. */
const MAX_FILE_BYTES = 65536;
/** README 只取开头若干行, 够判断项目定位即可. */
const README_HEAD_LINES = 20;
/** 顶层条目最多列出的数量. */
const MAX_TOP_ENTRIES = 30;
/** 探测版本号时查看的文件, 按优先级排序. */
const VERSION_FILE_CANDIDATES = [
	"package.json",
	"Cargo.toml",
	"pyproject.toml",
	"composer.json"
];
/** README 候选文件名, 按优先级排序. */
const README_CANDIDATES = [
	"README.md",
	"README.zh.md",
	"README.rst",
	"README.txt"
];
/** 读取文件内容; 文件过大或不可读时返回 null. */
async function readTextFile(path) {
	try {
		const info = await stat(path);
		if (!info.isFile() || info.size > MAX_FILE_BYTES) return null;
		return await readFile(path, "utf8");
	} catch {
		return null;
	}
}
/** 从 JSON 文本里取字符串字段. */
function jsonString(text, key) {
	try {
		const parsed = JSON.parse(text);
		if (typeof parsed !== "object" || parsed === null) return null;
		const value = Reflect.get(parsed, key);
		return typeof value === "string" ? value : null;
	} catch {
		return null;
	}
}
/** 从 TOML 文本里取顶层 version 字段. */
function tomlVersion(text) {
	return /^version\s*=\s*"([^"]+)"/mu.exec(text)?.[1] ?? null;
}
/**
* 探测项目里记录版本号的文件.
*
* @param repo - 仓库根路径.
* @returns 存在的候选文件及其版本号, 最多三个.
*/
async function readVersionFiles(repo) {
	const found = [];
	for (const file of VERSION_FILE_CANDIDATES) {
		const text = await readTextFile(join(repo, file));
		if (text === null) continue;
		const version = file.endsWith(".json") ? jsonString(text, "version") : tomlVersion(text);
		found.push({
			file,
			version
		});
		if (found.length >= 3) break;
	}
	return found;
}
/**
* 读取建仓库需要的项目线索: package.json 元数据, README 开头, 顶层条目, .gitignore.
*
* @param repo - 仓库根路径.
* @returns 项目线索; 缺失的文件以 null 或空值表示.
*/
async function readProjectHints(repo) {
	const packageText = await readTextFile(join(repo, "package.json"));
	const keywords = [];
	if (packageText !== null) try {
		const parsed = JSON.parse(packageText);
		const raw = typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "keywords") : void 0;
		if (Array.isArray(raw)) {
			for (const item of raw) if (typeof item === "string") keywords.push(item);
		}
	} catch {}
	let readme = null;
	for (const file of README_CANDIDATES) {
		const text = await readTextFile(join(repo, file));
		if (text === null) continue;
		readme = {
			file,
			text: text.split("\n").slice(0, README_HEAD_LINES).join("\n").trim()
		};
		break;
	}
	let topEntries = [];
	try {
		topEntries = (await readdir(repo, { withFileTypes: true })).filter((entry) => entry.name !== ".git" && entry.name !== "node_modules").map((entry) => entry.isDirectory() ? `${entry.name}/` : entry.name).sort((left, right) => left.localeCompare(right)).slice(0, MAX_TOP_ENTRIES);
	} catch {
		topEntries = [];
	}
	const gitignoreText = await readTextFile(join(repo, ".gitignore"));
	const gitignore = gitignoreText === null ? {
		present: false,
		lines: 0
	} : {
		present: true,
		lines: gitignoreText.split("\n").filter((line) => line.trim().length > 0).length
	};
	return {
		packageName: packageText === null ? null : jsonString(packageText, "name"),
		packageDescription: packageText === null ? null : jsonString(packageText, "description"),
		packageKeywords: keywords,
		readme,
		topEntries,
		gitignore
	};
}
//#endregion
//#region src/git/truncate.ts
/**
* 按行保留文本的前 `limit` 行.
*
* @param text - 原始文本; 末尾换行不会额外产生一行.
* @param limit - 最多保留的行数, 必须为正整数.
* @returns 截断结果; `text` 只含保留的行, 标注由调用方决定.
*/
function truncateLines(text, limit) {
	if (!Number.isInteger(limit) || limit < 1) throw new TypeError(`truncateLines: limit 必须是正整数, 收到 ${String(limit)}`);
	const normalized = text.endsWith("\n") ? text.slice(0, -1) : text;
	if (normalized.length === 0) return {
		text: "",
		totalLines: 0,
		shownLines: 0,
		truncated: false
	};
	const lines = normalized.split("\n");
	if (lines.length <= limit) return {
		text: normalized,
		totalLines: lines.length,
		shownLines: lines.length,
		truncated: false
	};
	return {
		text: lines.slice(0, limit).join("\n"),
		totalLines: lines.length,
		shownLines: limit,
		truncated: true
	};
}
//#endregion
//#region src/git/snapshot.ts
/**
* 仓库上下文采集: 按命令各自的需要跑只读 git 命令, 产出结构化段落.
* @module dsh-git-commands/git/snapshot
*/
/** tag 列表与自上一个 tag 以来的提交最多采集的数量. */
const MAX_TAG_RANGE_COMMITS = 200;
/** log 输出使用的字段分隔符 (unit separator) 与记录分隔符 (record separator). */
const FIELD = "";
const RECORD = "";
/** log 输出格式: hash, 日期, 标题, 正文. */
const LOG_FORMAT = `%h${FIELD}%ad${FIELD}%s${FIELD}%b${RECORD}`;
/** 把 git 输出切成非空行. */
function linesOf(text) {
	return text.split("\n").map((line) => line.trimEnd()).filter((line) => line.length > 0);
}
/** 空输出时给出占位说明. */
function orEmpty(text, placeholder) {
	const trimmed = text.trim();
	return trimmed.length === 0 ? placeholder : trimmed;
}
/**
* 读当前分支; detached HEAD 时给出 commit hash.
*
* @param repo - 仓库根.
* @param signal - 取消信号.
* @returns 分支名或 detached 描述.
*/
async function readBranch(repo, signal) {
	const branch = (await runGit(repo, [
		"rev-parse",
		"--abbrev-ref",
		"HEAD"
	], { signal })).stdout.trim();
	if (branch.length > 0 && branch !== "HEAD") return branch;
	const head = (await runGit(repo, [
		"rev-parse",
		"--short",
		"HEAD"
	], { signal })).stdout.trim();
	return head.length === 0 ? "(尚无提交)" : `detached HEAD ${head}`;
}
/** 读 HEAD 的短 hash. */
async function readHead(repo, signal) {
	const head = (await runGit(repo, [
		"rev-parse",
		"--short",
		"HEAD"
	], { signal })).stdout.trim();
	return head.length === 0 ? "(尚无提交)" : head;
}
/**
* 读最近若干条 commit message.
*
* @param repo - 仓库根.
* @param limit - 最多读取条数.
* @param signal - 取消信号.
* @param range - 可选 revision 范围, 例如 `<tag>..HEAD`.
* @returns 解析后的提交记录; 命令失败 (例如空仓库) 时返回空数组.
*/
async function readHistory(repo, limit, signal, range) {
	const args = [
		"log",
		`-n${limit}`,
		"--date=short",
		`--pretty=format:${LOG_FORMAT}`
	];
	if (range !== void 0) args.push(range);
	const result = await runGit(repo, args, { signal });
	if (!result.ok) return [];
	const entries = [];
	for (const record of result.stdout.split(RECORD)) {
		const fields = record.replace(/^\n+/u, "").split(FIELD);
		if (fields.length < 3) continue;
		const [hash, date, subject, body = ""] = fields;
		if (hash === void 0 || date === void 0 || subject === void 0) continue;
		entries.push({
			hash,
			date,
			subject,
			body: body.trim()
		});
	}
	return entries;
}
/** 渲染提交列表. */
function renderHistory(entries) {
	if (entries.length === 0) return "(没有可用的提交记录)";
	return entries.map((entry) => {
		const header = `${entry.hash} (${entry.date}) ${entry.subject}`;
		return entry.body.length === 0 ? header : `${header}\n${entry.body}`;
	}).join("\n---\n");
}
/** 采集 `git status --porcelain` 文本. */
async function readStatus(repo, signal) {
	return (await runGit(repo, [
		"status",
		"--porcelain=v1",
		"-uall"
	], { signal })).stdout;
}
/**
* 采集 `/commit` 需要的上下文: staged 范围, staged diff 与历史风格.
*
* @param repo - 仓库根.
* @param options - 采集上限与取消信号.
* @returns 采集结果.
*/
async function collectCommitContext(repo, options) {
	const { signal } = options;
	const branch = await readBranch(repo, signal);
	const head = await readHead(repo, signal);
	const status = await readStatus(repo, signal);
	const stagedStat = await runGitOrThrow(repo, [
		"diff",
		"--cached",
		"--stat",
		"--no-color"
	], { signal });
	const stagedDiff = await runGitOrThrow(repo, [
		"diff",
		"--cached",
		"--no-color"
	], { signal });
	const history = await readHistory(repo, options.logLimit, signal);
	const stagedFiles = linesOf(status).filter((line) => /^[MADRCU]/u.test(line)).length;
	const diff = truncateLines(stagedDiff, options.diffLineLimit);
	const diffBody = diff.totalLines === 0 ? "(没有任何已暂存的改动)" : [diff.text, ...diff.truncated ? [`...(已截断: 只给出前 ${String(diff.shownLines)} 行, 共 ${String(diff.totalLines)} 行; 需要看剩余部分时再自己执行 git diff --cached)`] : []].join("\n");
	return {
		facts: [
			`仓库: ${repo}`,
			`分支: ${branch}`,
			`HEAD: ${head}`
		],
		sections: [
			{
				title: "工作区状态 (git status --porcelain=v1 -uall)",
				body: orEmpty(status, "(工作区干净)")
			},
			{
				title: "已暂存改动统计 (git diff --cached --stat)",
				body: orEmpty(stagedStat, "(没有已暂存的改动)")
			},
			{
				title: "已暂存 diff (git diff --cached)",
				body: diffBody
			},
			{
				title: `最近 ${String(options.logLimit)} 条 commit message (风格参考)`,
				body: renderHistory(history)
			}
		],
		summary: `已暂存 ${String(stagedFiles)} 个文件, staged diff ${String(diff.totalLines)} 行, 历史 ${String(history.length)} 条`
	};
}
/**
* 采集 `/commit-fast` 需要的上下文: 只有状态与历史, 不含 diff.
*
* @param repo - 仓库根.
* @param options - 采集上限与取消信号.
* @returns 采集结果.
*/
async function collectCommitFastContext(repo, options) {
	const { signal } = options;
	const branch = await readBranch(repo, signal);
	const head = await readHead(repo, signal);
	const status = await readStatus(repo, signal);
	const history = await readHistory(repo, options.logLimit, signal);
	const changedFiles = linesOf(status).length;
	return {
		facts: [
			`仓库: ${repo}`,
			`分支: ${branch}`,
			`HEAD: ${head}`
		],
		sections: [{
			title: "工作区状态 (git status --porcelain=v1 -uall)",
			body: orEmpty(status, "(工作区干净)")
		}, {
			title: `最近 ${String(options.logLimit)} 条 commit message (风格参考)`,
			body: renderHistory(history)
		}],
		summary: `改动 ${String(changedFiles)} 项, 历史 ${String(history.length)} 条 (未采集 diff)`
	};
}
/**
* 采集 `/tag` 需要的上下文: 最近 tag, 自上一个 tag 以来的提交, 版本文件.
*
* @param repo - 仓库根.
* @param options - 采集上限与取消信号.
* @returns 采集结果.
*/
async function collectTagContext(repo, options) {
	const { signal } = options;
	const branch = await readBranch(repo, signal);
	const head = await readHead(repo, signal);
	const status = await readStatus(repo, signal);
	const tagsResult = await runGit(repo, [
		"for-each-ref",
		"--sort=-creatordate",
		"--count=5",
		`--format=%(refname:short)${FIELD}%(creatordate:short)${FIELD}%(subject)`,
		"refs/tags"
	], { signal });
	const tags = tagsResult.stdout.split("\n").map((line) => line.trim()).filter((line) => line.length > 0).map((line) => {
		const [name, date, subject = ""] = line.split(FIELD);
		return `${name ?? ""} (${date ?? "未知日期"}) ${subject}`.trim();
	});
	const lastTag = tagsResult.stdout.split("\n").find((line) => line.trim().length > 0)?.split(FIELD)[0]?.trim();
	const since = lastTag === void 0 || lastTag.length === 0 ? await readHistory(repo, MAX_TAG_RANGE_COMMITS, signal) : await readHistory(repo, MAX_TAG_RANGE_COMMITS, signal, `${lastTag}..HEAD`);
	const versionFiles = await readVersionFiles(repo);
	const versionBody = versionFiles.length === 0 ? "(没有探测到常见的版本文件)" : versionFiles.map((info) => `${info.file}: ${info.version ?? "未找到 version 字段"}`).join("\n");
	return {
		facts: [
			`仓库: ${repo}`,
			`分支: ${branch}`,
			`HEAD: ${head}`,
			`上一个 tag: ${lastTag === void 0 || lastTag.length === 0 ? "(没有 tag)" : lastTag}`
		],
		sections: [
			{
				title: "最近的 tag (最新在前)",
				body: tags.length === 0 ? "(没有任何 tag)" : tags.join("\n")
			},
			{
				title: lastTag === void 0 || lastTag.length === 0 ? `全部提交 (最多 ${String(MAX_TAG_RANGE_COMMITS)} 条, 完整 message)` : `${lastTag}..HEAD 之间的提交 (最多 ${String(MAX_TAG_RANGE_COMMITS)} 条, 完整 message)`,
				body: renderHistory(since)
			},
			{
				title: "项目里的版本号 (探测结果)",
				body: versionBody
			},
			{
				title: "工作区状态 (git status --porcelain=v1 -uall)",
				body: orEmpty(status, "(工作区干净)")
			}
		],
		summary: `tag ${String(tags.length)} 个, 上一个 tag 以来提交 ${String(since.length)} 条, 版本文件 ${String(versionFiles.length)} 个`
	};
}
/**
* 采集 `/push` 需要的上下文: 分支, 上游, ahead 与 behind, 未推送提交.
*
* @param repo - 仓库根.
* @param options - 采集上限与取消信号.
* @returns 采集结果.
*/
async function collectPushContext(repo, options) {
	const { signal } = options;
	const branch = await readBranch(repo, signal);
	const head = await readHead(repo, signal);
	const upstreamResult = await runGit(repo, [
		"rev-parse",
		"--abbrev-ref",
		"--symbolic-full-name",
		"@{u}"
	], { signal });
	const upstream = upstreamResult.ok ? upstreamResult.stdout.trim() : "";
	const remotes = await runGit(repo, ["remote", "-v"], { signal });
	let tracking = "没有设置上游分支 (需要 git push -u <remote> <branch>)";
	let unpushed = [];
	if (upstream.length > 0) {
		const [behind, ahead] = (await runGit(repo, [
			"rev-list",
			"--left-right",
			"--count",
			"@{u}...HEAD"
		], { signal })).stdout.trim().split(/\s+/u);
		tracking = `上游: ${upstream}; 落后远端 ${behind ?? "?"} 个提交, 领先远端 ${ahead ?? "?"} 个提交`;
		unpushed = await readHistory(repo, MAX_TAG_RANGE_COMMITS, signal, "@{u}..HEAD");
	}
	return {
		facts: [
			`仓库: ${repo}`,
			`分支: ${branch}`,
			`HEAD: ${head}`
		],
		sections: [
			{
				title: "上游与领先/落后 (git rev-parse @{u}, git rev-list --left-right --count)",
				body: tracking
			},
			{
				title: "远端列表 (git remote -v)",
				body: orEmpty(remotes.stdout, "(没有配置远端)")
			},
			{
				title: "尚未推送的提交 (完整 message)",
				body: upstream.length === 0 ? "(没有上游分支, 无法计算未推送的提交)" : renderHistory(unpushed)
			},
			{
				title: "工作区状态 (git status --porcelain=v1 -uall)",
				body: orEmpty(await readStatus(repo, signal), "(工作区干净)")
			}
		],
		summary: upstream.length === 0 ? "没有上游分支" : `未推送提交 ${String(unpushed.length)} 条, 上游 ${upstream}`
	};
}
/**
* 采集 `/repo-create` 需要的上下文: 目录是否已是仓库, 远端, 提交数, 项目线索.
*
* 目标目录可以还不是 git 仓库, 因此这里只做探测, 不把 "不是仓库" 当成错误.
*
* @param directory - 目标目录绝对路径.
* @param options - 采集上限与取消信号.
* @returns 采集结果.
*/
async function collectRepoCreateContext(directory, options) {
	const { signal } = options;
	const gitDirPresent = await stat(join(directory, ".git")).then(() => true, () => false);
	const remotes = gitDirPresent ? await runGit(directory, ["remote", "-v"], { signal }) : null;
	const commitCount = gitDirPresent ? (await runGit(directory, [
		"rev-list",
		"--count",
		"HEAD"
	], { signal })).stdout.trim() : "";
	const status = gitDirPresent ? await readStatus(directory, signal) : "";
	const hints = await readProjectHints(directory);
	const versionFiles = await readVersionFiles(directory);
	const projectLines = [
		`package.json name: ${hints.packageName ?? "(没有 package.json 或没有该字段)"}`,
		`package.json description: ${hints.packageDescription ?? "(没有该字段)"}`,
		`package.json keywords: ${hints.packageKeywords.length === 0 ? "(没有)" : hints.packageKeywords.join(", ")}`,
		`README: ${hints.readme === null ? "(没有 README)" : hints.readme.file}`,
		`版本文件: ${versionFiles.length === 0 ? "(没有探测到)" : versionFiles.map((info) => `${info.file}=${info.version ?? "未知"}`).join(", ")}`,
		`.gitignore: ${hints.gitignore.present ? `存在, ${String(hints.gitignore.lines)} 条非空规则` : "不存在, 需要按项目类型补齐"}`
	];
	return {
		facts: [
			`目标目录: ${directory}`,
			`git 仓库: ${gitDirPresent ? "已初始化" : "尚未初始化"}`,
			`提交数: ${commitCount.length === 0 ? "(未知, 可能尚无提交)" : commitCount}`
		],
		sections: [
			{
				title: "项目自身的描述线索",
				body: projectLines.join("\n")
			},
			...hints.readme === null ? [] : [{
				title: `README 开头 (${hints.readme.file})`,
				body: hints.readme.text
			}],
			{
				title: "顶层条目",
				body: hints.topEntries.length === 0 ? "(目录为空)" : hints.topEntries.join("\n")
			},
			{
				title: "远端列表 (git remote -v)",
				body: remotes === null ? "(尚未初始化仓库)" : orEmpty(remotes.stdout, "(没有配置远端)")
			},
			{
				title: "工作区状态 (git status --porcelain=v1 -uall)",
				body: gitDirPresent ? orEmpty(status, "(工作区干净)") : "(尚未初始化仓库)"
			}
		],
		summary: gitDirPresent ? `已初始化仓库, ${String(hints.topEntries.length)} 个顶层条目, .gitignore ${hints.gitignore.present ? "存在" : "缺失"}` : `尚未初始化仓库, ${String(hints.topEntries.length)} 个顶层条目, .gitignore ${hints.gitignore.present ? "存在" : "缺失"}`
	};
}
//#endregion
//#region src/commands/specs.ts
/** 全部命令, 注册顺序即补全列表顺序. */
const COMMAND_SPECS = [
	{
		name: "commit",
		definitionId: "dsh-git-commands#commit",
		description: "附带 staged 状态, staged diff 与历史风格, 生成 commit message 与等价命令",
		inputHint: "[path]",
		promptField: "commitPrompt",
		allowVersion: false,
		requiresRepo: true,
		collect: collectCommitContext
	},
	{
		name: "commit-fast",
		definitionId: "dsh-git-commands#commit-fast",
		description: "只附带工作区状态与历史风格, 不读 diff 的快速提交",
		inputHint: "[path]",
		promptField: "commitFastPrompt",
		allowVersion: false,
		requiresRepo: true,
		collect: collectCommitFastContext
	},
	{
		name: "tag",
		definitionId: "dsh-git-commands#tag",
		description: "附带上一个 tag 以来的提交与版本文件, 走发布流程打 tag 并推送",
		inputHint: "[version] [path]",
		promptField: "tagPrompt",
		allowVersion: true,
		requiresRepo: true,
		collect: collectTagContext
	},
	{
		name: "push",
		definitionId: "dsh-git-commands#push",
		description: "附带分支, 上游, 领先与落后数量与未推送提交, 推送当前分支",
		inputHint: "[path]",
		promptField: "pushPrompt",
		allowVersion: false,
		requiresRepo: true,
		collect: collectPushContext
	},
	{
		name: "repo-create",
		definitionId: "dsh-git-commands#repo-create",
		description: "附带项目描述线索与仓库状态, 创建 GitHub 仓库 (必带 description 与 topics) 并推送",
		inputHint: "[path]",
		promptField: "repoCreatePrompt",
		allowVersion: false,
		requiresRepo: false,
		collect: collectRepoCreateContext
	}
];
/** 把 message 摘要限制在 DSH 允许的长度内. */
function boundSummary(text) {
	return text.length <= 120 ? text : `${text.slice(0, 119)}...`;
}
//#endregion
//#region src/commands/register.ts
/** 把任意抛出值渲染成一行说明. */
function describeError(error) {
	return error instanceof Error ? error.message : String(error);
}
/**
* 执行一条命令: 采集上下文并把它作为模型可见的上下文注入, 同时排队一个 turn.
*
* @param spec - 命令规格.
* @param config - 已解析的插件配置.
* @param invocation - DSH 传入的调用信息 (agent, 原始输入, 取消信号).
* @returns 命令结果; 采集失败时返回错误文本, 不注入也不唤醒.
*/
async function executeCommand(spec, config, invocation) {
	const usage = `/${spec.name} ${spec.inputHint}`.trim();
	const cwd = invocation.agent.session.header.cwd;
	const parsed = parseTarget(invocation.rawInput, {
		...cwd === void 0 ? {} : { cwd },
		allowVersion: spec.allowVersion,
		usage
	});
	if (!parsed.ok) return {
		kind: "error",
		text: parsed.message
	};
	let target;
	if (spec.requiresRepo) {
		const resolved = await resolveRepo(parsed.target.path, invocation.signal);
		if (!resolved.ok) return {
			kind: "error",
			text: resolved.message
		};
		target = resolved.repo;
	} else {
		const resolved = await resolveDirectory(parsed.target.path);
		if (!resolved.ok) return {
			kind: "error",
			text: resolved.message
		};
		target = resolved.path;
	}
	let collected;
	try {
		collected = await spec.collect(target, {
			logLimit: config.logLimit,
			diffLineLimit: config.diffLineLimit,
			signal: invocation.signal
		});
	} catch (error) {
		if (error instanceof GitUnavailableError) return {
			kind: "error",
			text: error.message
		};
		return {
			kind: "error",
			text: `采集仓库上下文失败: ${describeError(error)}`
		};
	}
	const rawInput = invocation.rawInput.trim();
	const text = renderInjection({
		prompt: config[spec.promptField],
		request: rawInput.length === 0 ? `/${spec.name}` : `/${spec.name} ${rawInput}`,
		facts: collected.facts,
		sections: collected.sections
	});
	try {
		invocation.agent.followup(createUserMessage({
			content: [{
				type: "text",
				text
			}],
			source: {
				kind: GIT_COMMANDS_SOURCE_KIND,
				form: "notice",
				summary: boundSummary(`/${spec.name}: ${collected.summary}`)
			}
		}));
	} catch (error) {
		return {
			kind: "error",
			text: `上下文已采集, 但唤醒模型失败: ${describeError(error)}`
		};
	}
	return {
		kind: "success",
		text: `已注入 /${spec.name} 规范与仓库上下文 (${collected.summary}), 并唤醒模型继续.`
	};
}
/**
* 注册全部 git 命令.
*
* @param ctx - Host 上下文; 必须已提供 commands 服务.
* @param config - 已解析的插件配置.
* @returns 注销全部命令的 disposer.
*/
function registerGitCommands(ctx, config) {
	const disposers = COMMAND_SPECS.map((spec) => ctx.commands.register({
		definitionId: brandString(spec.definitionId),
		name: spec.name,
		description: spec.description,
		input: { hint: spec.inputHint },
		handler: (invocation) => executeCommand(spec, config, invocation)
	}));
	return () => {
		for (const dispose of disposers) dispose();
	};
}
//#endregion
//#region src/prompts/commit.ts
/**
* `/commit` 的默认规范文本. 内容从 AGENTS.md 的 commit 约定搬来, 由命令触发时随
* 仓库状态一起注入, 取代原先常驻系统提示的那一段.
* @module dsh-git-commands/prompts/commit
*/
/** 默认 commit 规范文本; 用户可在设置页覆盖. */
const DEFAULT_COMMIT_PROMPT = `你正在编写一次 git 提交的 commit message (等价于 AGENTS.md 里的 commit 约定). 下面的仓库上下文已经给出 staged 范围, staged diff 与最近的 commit message 风格, 不要再自己执行 git status, git diff, git log 之类的命令, 除非上下文里明确标注了截断.

要求:

- 遵循 Conventional Commits. 参考下方历史 commit message 的构建方式与用词, 不要凭印象发明风格.
- message 不要只是一句抽象的话, 要落到这次改动解决的具体问题或者实现的具体功能上. 用词简单, 精准, 有辨识度, 便于在多个提交里一眼认出这次做了什么.
- 必须依据下方 staged diff 的精确修改来写, 不要遗漏其中包含的改动, 也不要描述 diff 里没有的东西.
- 一句话说不清时, 先给一句有效总结, 再分点补充; 分点的句子开头小写, 句末带句号.
- 可以用用户提示词的片段辅助说明这次改动的来源.
- 需要指代具体对象时, 直接用符号名 (类型, 函数, 文件, 命令, 变量) 比费心描述对象本身更准确.
- commit 范围是 staged 的内容, 不是本次对话涉及的内容; 没有 staged 内容时, 范围默认是距离上一次 commit 的全部改动, 下方 status 会体现.
- 默认只输出 commit message 和等价的 commit 命令, 不要真的执行提交; 只有用户明确要求直接提交 (doit, 直接提交, 执行 commit) 时才执行.

输出格式:

1. 先用四层反引号包裹给出完整 message, 再给出等价命令, 顺序不要颠倒.
2. 等价命令放在单独一个 shell 代码块里, 形态如下:

   cd <仓库绝对路径>
   git add <需要暂存的文件> # 可选, 确实需要时才给出
   git commit -m "标题" -m "分点补充
   - 第一点.
   - 第二点."

- 必须使用绝对路径 cd 到仓库.
- 只用一个多行 -m 承载正文, 不要每行一个 -m (那样会在之间插入多余空行), 也不要用 here doc 之类在 fish 里不可用的写法.
- 标题行与后续行之间保留真实换行, 不要黏连, 也不要用 \\n 转义代替换行.
- 等价命令不要拆成两个代码块.`;
//#endregion
//#region src/prompts/commit-fast.ts
/**
* `/commit-fast` 的默认规范文本. 对应 AGENTS.md 里 commit fast 的约定: 不读 diff,
* 提交对象是上一条提示词要求修改的内容.
* @module dsh-git-commands/prompts/commit-fast
*/
/** 默认 commit-fast 规范文本; 用户可在设置页覆盖. */
const DEFAULT_COMMIT_FAST_PROMPT = `你正在做一次快速提交的 commit message (等价于 AGENTS.md 里的 commit fast 约定). 下面的仓库上下文只给了工作区状态与最近的 commit message, 没有 diff, 也不需要你去读 diff.

要求:

- 提交对象是上一条用户提示词让你修改的内容, 更早几轮的改动不算在内.
- 最近几次的提交风格已经给在下方, 不需要重新检查历史.
- 其余与常规提交一致: 遵循 Conventional Commits, 一句话落到具体改动上, 说不清时先总结再分点补充 (分点开头小写, 句末带句号).
- 默认只输出 commit message 和等价的 commit 命令, 不要真的执行提交.

输出格式:

1. 先用四层反引号包裹给出完整 message, 再给出等价命令.
2. 等价命令放在单独一个 shell 代码块里, 使用绝对路径 cd 到仓库, 只用一个多行 -m 承载正文, 标题行与后续行之间保留真实换行, 不要每行一个 -m, 不要用 here doc.`;
//#endregion
//#region src/prompts/tag.ts
/**
* `/tag` 的默认规范文本. 覆盖 AGENTS.md 的 tags 约定与代码版本约定中与发布相关的
* 部分, 并把 release notes 的具体写法指向 create-github-release-flow skill.
* @module dsh-git-commands/prompts/tag
*/
/** 默认 tag 规范文本; 用户可在设置页覆盖. */
const DEFAULT_TAG_PROMPT = `你正在准备一次版本发布 (打 tag 并推送). 下面的仓库上下文给出了最近的 tag, 自上一个 tag 以来的 commit message, 工作区状态, 以及项目里常见版本文件的内容.

要求:

- 打 tag 之前必须先加载并遵循 create-github-release-flow skill 的内容 (本地 dsh skill, 或 https://github.com/azazo1/create-github-release-flow), 上面的说明仅供参考, 具体写法以该 skill 为准.
- 检查项目文件里记录的版本号是否已经与要发布的版本一致; 不一致时先新建一个 commit 完成版本号更新, 再打 tag.
- tag 描述不要过短, 要写成 release notes 级别的说明, 参考成熟仓库的写法; 不要只根据 commit 标题总结, 不清楚的地方要回到 commit 的具体改动确认.
- 用户没有指定版本号时, 结合项目整体和自上一个 tag 以来的改动自行判断语义版本号是 major, minor 还是 patch.
- 只有在用户明确要求时才可以修改版本号并打 tag, 本次即明确要求; 平时不要自主修改版本号或者发布.
- 打 tag 与 push 都是对远端的写操作: 必须在沙箱外提权执行, 并且与其它命令分开, 单独逐条执行, 不要串联在 && 后面, 也不要过滤输出 (head, tail, grep 等), 避免漏掉重要信息.
- 先给出本地 tag 命令并单独执行, 再给出 push 命令并单独执行.`;
//#endregion
//#region src/prompts/push.ts
/**
* `/push` 的默认规范文本. 覆盖 AGENTS.md 中对远端写操作的提权与执行要求.
* @module dsh-git-commands/prompts/push
*/
/** 默认 push 规范文本; 用户可在设置页覆盖. */
const DEFAULT_PUSH_PROMPT = `你正在处理一次推送 (push). 下面的仓库上下文给出了当前分支, 上游分支, ahead 与 behind 的数量, 远端地址, 以及尚未推送的 commit.

要求:

- 先根据上下文确认要推送的分支和远端; 没有上游分支时使用 git push -u <remote> <branch> 建立跟踪.
- behind 大于 0 时先说明情况 (远端有本地没有的提交), 不要直接覆盖; 不要使用 --force 或者 --force-with-lease, 除非用户明确要求.
- push 是对远端的写操作: 必须在沙箱外提权执行, 单独逐条执行, 不要和 git add, git commit 之类的命令串联在 && 后面, 也不要过滤输出 (head, tail, grep 等), 避免漏掉远端返回的重要信息.
- 推送失败的输出要完整读出并说明原因, 不要只报告退出码.`;
//#endregion
//#region src/prompts/repo-create.ts
/**
* `/repo-create` 的默认规范文本. 覆盖建 GitHub 仓库时的描述, topics, gitignore
* 检查, 首次提交, 以及提权执行要求.
* @module dsh-git-commands/prompts/repo-create
*/
/** 默认 repo-create 规范文本; 用户可在设置页覆盖. */
const DEFAULT_REPO_CREATE_PROMPT = `你正在为一个项目创建 GitHub 仓库并完成首次推送. 下面的仓库上下文给出了本地仓库状态, 远端情况以及项目自身的描述线索.

要求:

- 仓库描述是必须的: 通过 --description 传入一句简短说明, 讲清这个项目解决什么问题, 面向什么场景, 并与 package.json 的 description 和 README 开头的定位说明保持一致.
- topics 是必须的: 用 gh repo edit <OWNER/REPOSITORY> --add-topic <topic> 设置 3 到 6 个 topic, 只允许小写字母, 数字和连字符, 覆盖技术栈, 用途和生态定位. gh repo create 没有 --topic 参数, 不要假设它支持.
- 创建之前检查 .gitignore: 按项目类型补齐条目 (依赖目录, 构建产物, 临时目录, 编辑器与系统文件, 数据库和本地配置等), 确认要提交的内容里没有密钥, 凭据或者机器特定的绝对路径.
- 首次提交使用 Conventional Commits, 提交信息要落到项目实际内容上, 不要写成 init 这类没有信息量的说明.
- 默认创建公开仓库 (--public), 除非用户要求私有.
- 命令形态参考:

  gh repo create OWNER/REPOSITORY --public --description "一句定位说明" --source . --push
  gh repo edit OWNER/REPOSITORY --add-topic topic-a --add-topic topic-b

- gh 创建, 首次提交与 push 都是对远端有影响的操作: 必须在沙箱外提权执行, 单独逐条执行, 不要串联, 也不要过滤输出.
- 完成后核对远端的 description 和 topics 是否与项目描述一致, 并把仓库地址告诉用户.`;
/** staged diff 默认保留的最大行数, 超出部分截断. */
const DEFAULT_DIFF_LINE_LIMIT = 1500;
/** commit message 采集条数的允许范围. */
const LOG_LIMIT_RANGE = {
	min: 1,
	max: 50
};
/** diff 行数上限的允许范围. */
const DIFF_LINE_LIMIT_RANGE = {
	min: 100,
	max: 2e4
};
/** Cordis Loader 读取并校验的插件 Config schema. */
const Config = z.object({
	commitPrompt: z.string().default(DEFAULT_COMMIT_PROMPT).description("/commit 注入给模型的规范文本"),
	commitFastPrompt: z.string().default(DEFAULT_COMMIT_FAST_PROMPT).description("/commit-fast 注入给模型的规范文本"),
	tagPrompt: z.string().default(DEFAULT_TAG_PROMPT).description("/tag 注入给模型的规范文本"),
	pushPrompt: z.string().default(DEFAULT_PUSH_PROMPT).description("/push 注入给模型的规范文本"),
	repoCreatePrompt: z.string().default(DEFAULT_REPO_CREATE_PROMPT).description("/repo-create 注入给模型的规范文本"),
	logLimit: z.number().step(1).min(LOG_LIMIT_RANGE.min).max(LOG_LIMIT_RANGE.max).default(10).description("采集最近多少条 commit message 作为风格参考"),
	diffLineLimit: z.number().step(1).min(DIFF_LINE_LIMIT_RANGE.min).max(DIFF_LINE_LIMIT_RANGE.max).default(DEFAULT_DIFF_LINE_LIMIT).description("staged diff 最多保留多少行, 超出部分截断")
});
/**
* 显式解析部署传入的配置, 把缺省值补齐成完整配置.
*
* schema 在任何正常加载路径上都已填好默认值, 这里再做一次显式回退, 使得
* schema 之外直接构造配置的调用方 (例如测试) 也拿到完整值.
*
* @param config - Loader 校验后的配置, 允许缺省字段.
* @returns 字段齐全的配置.
*/
function resolveConfig(config = {}) {
	return {
		commitPrompt: config.commitPrompt ?? DEFAULT_COMMIT_PROMPT,
		commitFastPrompt: config.commitFastPrompt ?? DEFAULT_COMMIT_FAST_PROMPT,
		tagPrompt: config.tagPrompt ?? DEFAULT_TAG_PROMPT,
		pushPrompt: config.pushPrompt ?? DEFAULT_PUSH_PROMPT,
		repoCreatePrompt: config.repoCreatePrompt ?? DEFAULT_REPO_CREATE_PROMPT,
		logLimit: config.logLimit ?? 10,
		diffLineLimit: config.diffLineLimit ?? 1500
	};
}
//#endregion
//#region src/index.ts
/** 插件模块名. */
const name = "dsh-git-commands";
/** 依赖的命令注册表. */
const inject = ["commands"];
/**
* 注册全部 git 命令.
*
* @param ctx - Host 上下文.
* @param config - Loader 按 Config schema 校验后的配置.
*/
function apply(ctx, config) {
	const resolved = resolveConfig(config);
	ctx.effect(() => registerGitCommands(ctx, resolved), "dsh-git-commands: slash commands");
}
//#endregion
export { Config, apply, inject, name };

//# sourceMappingURL=index.js.map