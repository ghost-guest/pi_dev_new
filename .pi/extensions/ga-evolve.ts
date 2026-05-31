import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Type, type AssistantMessage, type ImageContent, type TextContent, type UserMessage } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

type CacheMode = "short" | "long";
type PromptOptimizationMode = "off" | "safe" | "ultra";

type PromptOptimizationConfig = {
	enabled: boolean;
	mode: PromptOptimizationMode;
	minChars: number;
	minSavingsChars: number;
	preserveOriginal: boolean;
	inlineOriginalPointerMinBytes: number;
};

type ProviderCacheMarkerMode = "off" | "anthropic";

type Config = {
	cacheMode: CacheMode;
	toolResultExternalizeChars: number;
	l1MaxEntries: number;
	workingMemoryMaxSummaries: number;
	workingMemoryMaxChars: number;
	workingMemoryMinScore: number;
	providerCacheMarkers: ProviderCacheMarkerMode;
	promptOptimization: PromptOptimizationConfig;
};

type MemoryLayer = "L1" | "L2" | "L3" | "L4" | "all";

type MemoryRecord = {
	id: string;
	layer: "L2" | "L3" | "L4";
	title: string;
	content: string;
	evidence: string;
	tags: string[];
	timestamp: string;
	source: string;
	path?: string;
};

const STORE = join(process.cwd(), ".pi", "ga-memory");
const CONFIG_PATH = join(STORE, "config.json");
const L0_DIR = join(STORE, "L0");
const L1_DIR = join(STORE, "L1");
const L2_DIR = join(STORE, "L2");
const L3_DIR = join(STORE, "L3");
const L3_SKILLS_DIR = join(L3_DIR, "skills");
const L4_DIR = join(STORE, "L4", "sessions");
const ARTIFACT_DIR = join(STORE, "artifacts", "tool-results");
const USER_PROMPT_ARTIFACT_DIR = join(STORE, "artifacts", "user-prompts");
const META_SOP = join(L0_DIR, "meta-sop.md");
const INSIGHT = join(L1_DIR, "insight.md");
const FACTS = join(L2_DIR, "facts.jsonl");

const DEFAULT_CONFIG: Config = {
	cacheMode: "long",
	toolResultExternalizeChars: 16_000,
	l1MaxEntries: 40,
	workingMemoryMaxSummaries: 6,
	workingMemoryMaxChars: 1_200,
	workingMemoryMinScore: 2,
	providerCacheMarkers: "anthropic",
	promptOptimization: {
		enabled: false,
		mode: "off",
		minChars: 120,
		minSavingsChars: 20,
		preserveOriginal: true,
		inlineOriginalPointerMinBytes: 1_500,
	},
};

const META_SOP_TEXT = `# GA Memory Meta-SOP

Core rules:

1. Action-verified only: write durable memory only from successful tool results, inspected files, passing commands, or explicit user instruction.
2. No guessing: never store model speculation, unexecuted plans, or unstable transient state as facts.
3. Preserve evidence: every L2/L3 write must include a short evidence pointer.
4. L1 stays tiny: L1 is an index, not a knowledge base.
5. Prefer pointers: keep large artifacts out of prompt context and reference file paths instead.
6. User secrets: never copy secret values into memory; store only safe pointers.
`;

const INSIGHT_SEED = `# GA Memory Insight

Read L2 facts or L3 generated skills only when relevant.
L0: .pi/ga-memory/L0/meta-sop.md
L2: .pi/ga-memory/L2/facts.jsonl
L3: .pi/ga-memory/L3/skills
L4: .pi/ga-memory/L4/sessions

## Index
`;

function ensureStore() {
	for (const dir of [STORE, L0_DIR, L1_DIR, L2_DIR, L3_DIR, L3_SKILLS_DIR, L4_DIR, ARTIFACT_DIR, USER_PROMPT_ARTIFACT_DIR]) {
		mkdirSync(dir, { recursive: true });
	}
	if (!existsSync(META_SOP)) writeFileSync(META_SOP, META_SOP_TEXT, "utf8");
	if (!existsSync(INSIGHT)) writeFileSync(INSIGHT, INSIGHT_SEED, "utf8");
	if (!existsSync(FACTS)) writeFileSync(FACTS, "", "utf8");
	if (!existsSync(CONFIG_PATH)) writeFileSync(CONFIG_PATH, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, "utf8");
}

function readText(path: string, fallback = "") {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return fallback;
	}
}

function readConfig(): Config {
	ensureStore();
	try {
		const parsed: unknown = JSON.parse(readText(CONFIG_PATH, "{}"));
		if (!parsed || typeof parsed !== "object") return DEFAULT_CONFIG;
		const obj = parsed as Partial<Config>;
		const promptOptimization = readPromptOptimizationConfig(obj.promptOptimization);
		return {
			cacheMode: obj.cacheMode === "short" || obj.cacheMode === "long" ? obj.cacheMode : DEFAULT_CONFIG.cacheMode,
			toolResultExternalizeChars:
				typeof obj.toolResultExternalizeChars === "number" && obj.toolResultExternalizeChars >= 4_000
					? obj.toolResultExternalizeChars
					: DEFAULT_CONFIG.toolResultExternalizeChars,
			l1MaxEntries:
				typeof obj.l1MaxEntries === "number" && obj.l1MaxEntries >= 10 ? obj.l1MaxEntries : DEFAULT_CONFIG.l1MaxEntries,
			workingMemoryMaxSummaries:
				typeof obj.workingMemoryMaxSummaries === "number" && obj.workingMemoryMaxSummaries >= 0
					? obj.workingMemoryMaxSummaries
					: DEFAULT_CONFIG.workingMemoryMaxSummaries,
			workingMemoryMaxChars:
				typeof obj.workingMemoryMaxChars === "number" && obj.workingMemoryMaxChars >= 200
					? obj.workingMemoryMaxChars
					: DEFAULT_CONFIG.workingMemoryMaxChars,
			workingMemoryMinScore:
				typeof obj.workingMemoryMinScore === "number" && obj.workingMemoryMinScore >= 1
					? obj.workingMemoryMinScore
					: DEFAULT_CONFIG.workingMemoryMinScore,
			providerCacheMarkers:
				obj.providerCacheMarkers === "off" || obj.providerCacheMarkers === "anthropic"
					? obj.providerCacheMarkers
					: DEFAULT_CONFIG.providerCacheMarkers,
			promptOptimization,
		};
	} catch {
		return DEFAULT_CONFIG;
	}
}

function readPromptOptimizationConfig(value: unknown): PromptOptimizationConfig {
	if (!value || typeof value !== "object") return DEFAULT_CONFIG.promptOptimization;
	const obj = value as Partial<PromptOptimizationConfig>;
	const mode = obj.mode === "off" || obj.mode === "safe" || obj.mode === "ultra" ? obj.mode : DEFAULT_CONFIG.promptOptimization.mode;
	return {
		enabled: typeof obj.enabled === "boolean" ? obj.enabled : DEFAULT_CONFIG.promptOptimization.enabled,
		mode,
		minChars: typeof obj.minChars === "number" && obj.minChars >= 80 ? obj.minChars : DEFAULT_CONFIG.promptOptimization.minChars,
		minSavingsChars:
			typeof obj.minSavingsChars === "number" && obj.minSavingsChars >= 20
				? obj.minSavingsChars
				: DEFAULT_CONFIG.promptOptimization.minSavingsChars,
		preserveOriginal:
			typeof obj.preserveOriginal === "boolean" ? obj.preserveOriginal : DEFAULT_CONFIG.promptOptimization.preserveOriginal,
		inlineOriginalPointerMinBytes:
			typeof obj.inlineOriginalPointerMinBytes === "number" && obj.inlineOriginalPointerMinBytes >= 0
				? obj.inlineOriginalPointerMinBytes
				: DEFAULT_CONFIG.promptOptimization.inlineOriginalPointerMinBytes,
	};
}

function writeConfig(config: Config) {
	ensureStore();
	writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function applyCacheMode(config: Config) {
	if (config.cacheMode === "long") {
		process.env.PI_CACHE_RETENTION = "long";
	} else if (process.env.PI_CACHE_RETENTION === "long") {
		delete process.env.PI_CACHE_RETENTION;
	}
}

function shortHash(text: string) {
	return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

function slugify(text: string) {
	const slug = text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/-{2,}/g, "-")
		.slice(0, 48);
	return slug || `memory-${shortHash(text)}`;
}

function nowIso() {
	return new Date().toISOString();
}

function todayFile() {
	return join(L4_DIR, `${new Date().toISOString().slice(0, 10)}.jsonl`);
}

function appendJsonl(path: string, value: unknown) {
	appendFileSync(path, `${JSON.stringify(value)}\n`, "utf8");
}

function parseJsonLines(path: string): MemoryRecord[] {
	const lines = readText(path)
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	const records: MemoryRecord[] = [];
	for (const line of lines) {
		try {
			const parsed: unknown = JSON.parse(line);
			if (isMemoryRecord(parsed)) records.push(parsed);
		} catch {
			// Ignore corrupt lines; append-only stores must remain readable.
		}
	}
	return records;
}

function isMemoryRecord(value: unknown): value is MemoryRecord {
	if (!value || typeof value !== "object") return false;
	const obj = value as Partial<MemoryRecord>;
	return (
		typeof obj.id === "string" &&
		(obj.layer === "L2" || obj.layer === "L3" || obj.layer === "L4") &&
		typeof obj.title === "string" &&
		typeof obj.content === "string" &&
		typeof obj.evidence === "string" &&
		Array.isArray(obj.tags) &&
		typeof obj.timestamp === "string" &&
		typeof obj.source === "string"
	);
}

function updateInsight(record: MemoryRecord) {
	const config = readConfig();
	const current = readText(INSIGHT, INSIGHT_SEED);
	const header = current.includes("## Index") ? current.slice(0, current.indexOf("## Index") + "## Index".length) : INSIGHT_SEED;
	const existing = current
		.slice(header.length)
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.startsWith("- "))
		.filter((line) => !line.includes(record.id));
	const pathHint = record.path ? ` -> ${record.path}` : "";
	const next = `- ${record.layer}:${record.id} ${record.title}${pathHint}`;
	const entries = [next, ...existing].slice(0, config.l1MaxEntries);
	writeFileSync(INSIGHT, `${header}\n${entries.join("\n")}\n`, "utf8");
}

function searchRecords(query: string, maxResults: number) {
	const q = query.toLowerCase();
	const l2 = parseJsonLines(FACTS);
	const l4 = readdirSync(L4_DIR, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
		.flatMap((entry) => parseJsonLines(join(L4_DIR, entry.name)));
	return [...l2, ...l4]
		.filter((record) => {
			const haystack = `${record.title}\n${record.content}\n${record.evidence}\n${record.tags.join(" ")}`.toLowerCase();
			return haystack.includes(q);
		})
		.slice(0, maxResults);
}

function listSkillNames() {
	return readdirSync(L3_SKILLS_DIR, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && existsSync(join(L3_SKILLS_DIR, entry.name, "SKILL.md")))
		.map((entry) => entry.name)
		.sort();
}

function formatRecord(record: MemoryRecord) {
	return [
		`- ${record.layer}:${record.id} ${record.title}`,
		`  tags: ${record.tags.join(", ") || "none"}`,
		`  evidence: ${record.evidence}`,
		record.path ? `  path: ${record.path}` : undefined,
		`  ${record.content}`,
	]
		.filter((line): line is string => Boolean(line))
		.join("\n");
}

function textResult(text: string, isError = false, details: unknown = undefined) {
	return { content: [{ type: "text" as const, text }], details, isError };
}

function textFromContent(content: (TextContent | ImageContent)[]) {
	return content
		.filter((part): part is TextContent => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}

function assistantText(message: AssistantMessage) {
	return message.content
		.filter((part): part is TextContent => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}

function extractSummaries(text: string) {
	return [...text.matchAll(/<summary>([\s\S]*?)<\/summary>/gi)]
		.map((match) => match[1]?.trim() ?? "")
		.filter(Boolean);
}

function isAssistantMessage(message: unknown): message is AssistantMessage {
	return Boolean(message && typeof message === "object" && (message as { role?: unknown }).role === "assistant");
}

function makeSystemPrompt(base: string) {
	return `${base}\n\n<ga_memory_protocol>\nGenericAgent-style memory is active. Keep <summary> one concise factual line after tool-backed progress. Use ga_memory_read only when needed; write durable memory only from action-verified evidence.\n</ga_memory_protocol>`;
}

function latestL4Records(limit: number) {
	if (limit <= 0) return [];
	const files = readdirSync(L4_DIR, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
		.map((entry) => entry.name)
		.sort()
		.reverse();
	const records: MemoryRecord[] = [];
	for (const file of files) {
		records.push(...parseJsonLines(join(L4_DIR, file)).reverse());
		if (records.length >= limit) break;
	}
	return records.slice(0, limit);
}

function extractKeywords(text: string) {
	const normalized = text.toLowerCase();
	const keywords = new Set<string>();
	for (const match of normalized.matchAll(/[a-z0-9][a-z0-9_-]{2,}/g)) {
		keywords.add(match[0].replace(/_/g, "-"));
	}
	for (const match of normalized.matchAll(/[\u4e00-\u9fff]{2,}/g)) {
		const segment = match[0];
		if (segment.length <= 4) {
			keywords.add(segment);
		}
		for (let index = 0; index < segment.length - 1; index += 1) {
			keywords.add(segment.slice(index, index + 2));
		}
	}
	for (const weak of [
		"这个",
		"需要",
		"分析",
		"项目",
		"实现",
		"能力",
		"当前",
		"已经",
		"测试",
		"问题",
		"方式",
		"方案",
		"新增",
		"修改",
		"更新",
		"功能",
		"使用",
		"插件",
		"上下",
		"文里",
		"清理",
		"历史",
		"the",
		"and",
		"with",
		"this",
		"that",
	]) {
		keywords.delete(weak);
	}
	return keywords;
}

function relevanceScore(text: string, queryKeywords: Set<string>) {
	if (queryKeywords.size === 0) return 0;
	const textKeywords = extractKeywords(text);
	let score = 0;
	for (const keyword of queryKeywords) {
		if (textKeywords.has(keyword)) score += 1;
	}
	return score;
}

function extractMessageText(message: unknown) {
	if (!message || typeof message !== "object") return "";
	const obj = message as { role?: unknown; content?: unknown };
	if (obj.role !== "user") return "";
	if (typeof obj.content === "string") return obj.content;
	if (!Array.isArray(obj.content)) return "";
	return obj.content
		.map((part) => {
			if (!part || typeof part !== "object") return "";
			const block = part as { type?: unknown; text?: unknown };
			return block.type === "text" && typeof block.text === "string" ? block.text : "";
		})
		.filter(Boolean)
		.join("\n");
}

function buildWorkingMemory(config: Config, query: string) {
	ensureStore();
	const queryKeywords = extractKeywords(query);
	if (queryKeywords.size === 0) return undefined;

	const insightLines = readText(INSIGHT, INSIGHT_SEED)
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.startsWith("- "))
		.map((line) => ({ line, score: relevanceScore(line, queryKeywords) }))
		.filter((hit) => hit.score >= config.workingMemoryMinScore)
		.sort((a, b) => b.score - a.score)
		.slice(0, Math.min(6, config.l1MaxEntries))
		.map((hit) => hit.line);

	const summaries = latestL4Records(Math.max(config.workingMemoryMaxSummaries * 4, 16))
		.filter((record) => record.tags.includes("summary") || record.source === "ga_memory_checkpoint")
		.map((record) => ({ record, score: relevanceScore(record.content, queryKeywords) }))
		.filter((hit) => hit.score >= config.workingMemoryMinScore)
		.sort((a, b) => b.score - a.score)
		.slice(0, config.workingMemoryMaxSummaries)
		.map((hit) => `- ${hit.record.content}`);

	if (insightLines.length === 0 && summaries.length === 0) return undefined;

	const sections = [
		'<ga_working_memory source="pi-ga-evolve">',
		"Relevant memory only. Read details with ga_memory_read if needed.",
		insightLines.length ? `L1 hits:\n${insightLines.join("\n")}` : "",
		summaries.length ? `Relevant summaries:\n${summaries.join("\n")}` : "",
		"</ga_working_memory>",
	].filter(Boolean);
	const text = sections.join("\n");
	return text.length > config.workingMemoryMaxChars ? `${text.slice(0, config.workingMemoryMaxChars)}\n</ga_working_memory>` : text;
}

const GA_WORKING_MEMORY_RE = /<ga_working_memory(?:\s+[^>]*)?>[\s\S]*?<\/ga_working_memory>/g;

function stripWorkingMemoryText(text: string) {
	return text.replace(GA_WORKING_MEMORY_RE, "").trim();
}

function findLatestUserIndex<T>(messages: T[]) {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message && typeof message === "object" && (message as { role?: unknown }).role === "user") return index;
	}
	return -1;
}

function stripHistoricalWorkingMemoryMessages<T>(messages: T[]) {
	const latestUserIndex = findLatestUserIndex(messages);
	const cleaned: T[] = [];
	for (let index = 0; index < messages.length; index += 1) {
		const message = messages[index];
		if (!message || typeof message !== "object") {
			cleaned.push(message);
			continue;
		}
		if (index === latestUserIndex) {
			cleaned.push(message);
			continue;
		}
		const obj = message as { role?: unknown; content?: unknown };
		let changed = false;
		let nextMessage: T = message;

		if (typeof obj.content === "string") {
			const content = stripWorkingMemoryText(obj.content);
			changed = content !== obj.content;
			nextMessage = { ...obj, content } as T;
		} else if (Array.isArray(obj.content)) {
			const content = obj.content
				.map((part) => {
					if (!part || typeof part !== "object") return part;
					const block = part as { type?: unknown; text?: unknown };
					if (block.type === "text" && typeof block.text === "string") {
						const text = stripWorkingMemoryText(block.text);
						changed = changed || text !== block.text;
						return { ...block, text };
					}
					return part;
				})
				.filter((part) => {
					if (!part || typeof part !== "object") return true;
					const block = part as { type?: unknown; text?: unknown };
					return !(block.type === "text" && typeof block.text === "string" && block.text.trim() === "");
				});
			nextMessage = { ...obj, content } as T;
		}

		if (changed && obj.role === "user" && extractMessageText(nextMessage).trim() === "") {
			continue;
		}
		cleaned.push(nextMessage);
	}
	return cleaned;
}

function injectWorkingMemory<T>(messages: T[], config: Config) {
	const cleanedMessages = stripHistoricalWorkingMemoryMessages(messages);
	if (config.workingMemoryMaxChars <= 0 || cleanedMessages.length === 0) return cleanedMessages;
	const latestUserText = [...cleanedMessages].reverse().map(extractMessageText).find(Boolean) ?? "";
	const workingMemory = buildWorkingMemory(config, latestUserText);
	if (!workingMemory) return cleanedMessages;
	const memoryMessage: UserMessage = { role: "user", content: workingMemory, timestamp: Date.now() };
	const tailIndex = Math.max(0, cleanedMessages.length - 1);
	return [...cleanedMessages.slice(0, tailIndex), memoryMessage as T, ...cleanedMessages.slice(tailIndex)];
}

function writeSkill(record: MemoryRecord) {
	const skillName = slugify(record.title);
	const skillDir = join(L3_SKILLS_DIR, skillName);
	mkdirSync(skillDir, { recursive: true });
	const description = record.content.split("\n").find((line) => line.trim())?.trim().slice(0, 900) || record.title;
	const skillPath = join(skillDir, "SKILL.md");
	const body = `---\nname: ${skillName}\ndescription: ${description}\n---\n\n# ${record.title}\n\n## Evidence\n\n${record.evidence}\n\n## Workflow\n\n${record.content}\n\n## Tags\n\n${record.tags.map((tag) => `- ${tag}`).join("\n") || "- generated"}\n`;
	writeFileSync(skillPath, body, "utf8");
	return skillPath;
}

const memoryReadTool = defineTool({
	name: "ga_memory_read",
	label: "GA Memory Read",
	description: "Read/search the project-local GA layered memory. Use before relying on remembered SOPs, facts, or historical sessions.",
	parameters: Type.Object({
		layer: Type.Optional(Type.Union([Type.Literal("L1"), Type.Literal("L2"), Type.Literal("L3"), Type.Literal("L4"), Type.Literal("all")], { description: "Memory layer to read" })),
		query: Type.Optional(Type.String({ description: "Search query" })),
		path: Type.Optional(Type.String({ description: "Optional relative path under .pi/ga-memory to read" })),
		maxResults: Type.Optional(Type.Number({ description: "Maximum search results", default: 8 })),
	}),
	async execute(_toolCallId, params) {
		ensureStore();
		const layer: MemoryLayer = params.layer ?? "L1";
		const maxResults = Math.max(1, Math.min(30, params.maxResults ?? 8));
		if (params.path) {
			const safePath = params.path.replace(/^\/+/, "");
			if (safePath.includes("..")) {
				return textResult("Refusing path traversal.", true);
			}
			return textResult(readText(join(STORE, safePath), "Not found."));
		}
		if (params.query) {
			const records = searchRecords(params.query, maxResults);
			const skillHits = listSkillNames().filter((name) => name.includes(params.query?.toLowerCase() ?? ""));
			return textResult([`# GA memory search: ${params.query}`, ...records.map(formatRecord), skillHits.length ? `L3 skill hits: ${skillHits.join(", ")}` : ""].filter(Boolean).join("\n\n") || "No hits.");
		}
		if (layer === "L1") return textResult(readText(INSIGHT));
		if (layer === "L2") return textResult(parseJsonLines(FACTS).map(formatRecord).join("\n\n") || "L2 empty.");
		if (layer === "L3") return textResult(`L3 skills:\n${listSkillNames().map((name) => `- ${name}/SKILL.md`).join("\n") || "none"}`);
		if (layer === "L4") {
			const files = readdirSync(L4_DIR, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
			return textResult(`L4 session files:\n${files.map((name) => `- ${name}`).join("\n") || "none"}`);
		}
		return textResult(`${readText(INSIGHT)}\n\nL2 records: ${parseJsonLines(FACTS).length}\nL3 skills: ${listSkillNames().length}`);
	},
});

const memoryWriteTool = defineTool({
	name: "ga_memory_write",
	label: "GA Memory Write",
	description: "Append action-verified durable memory to L2 facts or L3 reusable pi skills. Requires evidence from successful tool calls or explicit user instruction.",
	parameters: Type.Object({
		layer: Type.Union([Type.Literal("L2"), Type.Literal("L3")], { description: "L2 for facts, L3 for reusable workflows/SOPs" }),
		title: Type.String({ description: "Concise title" }),
		content: Type.String({ description: "Durable fact or reusable workflow" }),
		evidence: Type.String({ description: "Evidence pointer: command/file/tool result/user instruction" }),
		tags: Type.Optional(Type.Array(Type.String(), { description: "Search tags" })),
		source: Type.Optional(Type.String({ description: "Optional source/session note" })),
	}),
	async execute(_toolCallId, params) {
		ensureStore();
		if (params.evidence.trim().length < 10) {
			return textResult("Rejected: evidence is required and must be specific.", true);
		}
		const record: MemoryRecord = {
			id: shortHash(`${params.layer}\n${params.title}\n${params.content}\n${nowIso()}`),
			layer: params.layer,
			title: params.title.trim(),
			content: params.content.trim(),
			evidence: params.evidence.trim(),
			tags: params.tags ?? [],
			timestamp: nowIso(),
			source: params.source ?? "ga_memory_write",
		};
		if (params.layer === "L2") {
			appendJsonl(FACTS, record);
		} else {
			record.path = writeSkill(record).replace(`${process.cwd()}/`, "");
			appendJsonl(FACTS, record);
		}
		updateInsight(record);
		return textResult(`Stored ${record.layer}:${record.id}${record.path ? ` at ${record.path}` : ""}`, false, record);
	},
});

const checkpointTool = defineTool({
	name: "ga_memory_checkpoint",
	label: "GA Memory Checkpoint",
	description: "Append a concise working/session checkpoint to L4 without promoting it to durable facts.",
	parameters: Type.Object({
		summary: Type.String({ description: "One concise factual checkpoint" }),
		tags: Type.Optional(Type.Array(Type.String(), { description: "Tags" })),
	}),
	async execute(_toolCallId, params) {
		ensureStore();
		const record: MemoryRecord = {
			id: shortHash(`L4\n${params.summary}\n${nowIso()}`),
			layer: "L4",
			title: params.summary.slice(0, 80),
			content: params.summary,
			evidence: "session checkpoint",
			tags: params.tags ?? [],
			timestamp: nowIso(),
			source: "ga_memory_checkpoint",
		};
		appendJsonl(todayFile(), record);
		return textResult(`Checkpoint stored L4:${record.id}`, false, record);
	},
});


type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type JsonRecord = { [key: string]: JsonValue };

function isJsonRecord(value: unknown): value is JsonRecord {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cloneJsonRecord(value: JsonRecord) {
	return JSON.parse(JSON.stringify(value)) as JsonRecord;
}

function hasCacheControl(value: JsonValue | undefined): boolean {
	if (!isJsonRecord(value)) return false;
	return isJsonRecord(value.cache_control);
}

function cacheControlBlock(config: Config): JsonRecord {
	return config.cacheMode === "long" ? { type: "ephemeral", ttl: "1h" } : { type: "ephemeral" };
}

function markLastTextBlock(blocks: JsonValue[] | undefined, cacheControl: JsonRecord) {
	if (!blocks) return false;
	for (let index = blocks.length - 1; index >= 0; index -= 1) {
		const block = blocks[index];
		if (!isJsonRecord(block) || hasCacheControl(block)) continue;
		if (block.type === "text" || block.type === "tool_result") {
			block.cache_control = cacheControl;
			return true;
		}
	}
	return false;
}

function maybeAddAnthropicCacheMarkers(payload: unknown, config: Config) {
	if (config.providerCacheMarkers !== "anthropic" || !isJsonRecord(payload)) return undefined;
	const model = typeof payload.model === "string" ? payload.model.toLowerCase() : "";
	const messages = Array.isArray(payload.messages) ? payload.messages : undefined;
	const tools = Array.isArray(payload.tools) ? payload.tools : undefined;
	const looksNativeAnthropic =
		model.includes("claude") &&
		typeof payload.max_tokens === "number" &&
		messages !== undefined &&
		(!tools || tools.every((tool) => isJsonRecord(tool) && typeof tool.name === "string" && isJsonRecord(tool.input_schema)));
	if (!looksNativeAnthropic) return undefined;

	const cloned = cloneJsonRecord(payload);
	const cacheControl = cacheControlBlock(config);
	let changed = false;

	if (Array.isArray(cloned.system)) {
		changed = markLastTextBlock(cloned.system, cacheControl) || changed;
	} else if (typeof cloned.system === "string") {
		cloned.system = [{ type: "text", text: cloned.system, cache_control: cacheControl }];
		changed = true;
	}

	const clonedTools = Array.isArray(cloned.tools) ? cloned.tools : undefined;
	if (clonedTools && clonedTools.length > 0) {
		const lastTool = clonedTools[clonedTools.length - 1];
		if (isJsonRecord(lastTool) && !hasCacheControl(lastTool)) {
			lastTool.cache_control = cacheControl;
			changed = true;
		}
	}

	const clonedMessages = Array.isArray(cloned.messages) ? cloned.messages : [];
	for (let index = clonedMessages.length - 1; index >= 0; index -= 1) {
		const message = clonedMessages[index];
		if (!isJsonRecord(message) || message.role !== "user") continue;
		if (typeof message.content === "string") {
			message.content = [{ type: "text", text: message.content, cache_control: cacheControl }];
			changed = true;
			break;
		}
		if (Array.isArray(message.content)) {
			changed = markLastTextBlock(message.content, cacheControl) || changed;
			break;
		}
	}

	return changed ? cloned : undefined;
}

function maybeExternalizeToolResult(toolName: string, toolCallId: string, content: (TextContent | ImageContent)[], threshold: number) {
	const text = textFromContent(content);
	if (text.length <= threshold || toolName.startsWith("ga_memory_")) return undefined;
	ensureStore();
	const id = shortHash(`${toolName}\n${toolCallId}\n${text}`);
	const artifactPath = join(ARTIFACT_DIR, `${id}.txt`);
	writeFileSync(artifactPath, text, "utf8");
	const relativePath = artifactPath.replace(`${process.cwd()}/`, "");
	const head = text.slice(0, 2_000);
	const tail = text.slice(-2_000);
	return [
		{
			type: "text" as const,
			text: `[GA token saver] Large ${toolName} result externalized. Full content: ${relativePath}\nOriginal chars: ${text.length}\n\n--- head ---\n${head}\n\n--- tail ---\n${tail}`,
		},
	];
}

function statusText() {
	const config = readConfig();
	const facts = parseJsonLines(FACTS).length;
	const skills = listSkillNames().length;
	const l4Files = readdirSync(L4_DIR, { withFileTypes: true }).filter((entry) => entry.isFile()).length;
	return [
		`GA memory: ${STORE}`,
		`cache mode: ${config.cacheMode}`,
		`stable system prefix: on`,
		`working memory: ${config.workingMemoryMaxSummaries} summaries, ${config.workingMemoryMaxChars} chars max`,
		`provider cache markers: ${config.providerCacheMarkers} (pi-ai cache retention=${config.cacheMode})`,
		`prompt optimizer: off`,
		`tool externalize threshold: ${config.toolResultExternalizeChars} chars`,
		`L2 facts: ${facts}`,
		`L3 skills: ${skills}`,
		`L4 session files: ${l4Files}`,
	].join("\n");
}

function handleCommand(args: string, ctx: ExtensionContext) {
	ensureStore();
	const [command, ...rest] = args.trim().split(/\s+/).filter(Boolean);
	if (!command || command === "status") {
		ctx.ui.notify(statusText(), "info");
		return;
	}
	if (command === "cache") {
		const mode = rest[0];
		if (mode !== "short" && mode !== "long") {
			ctx.ui.notify(`Usage: /ga-memory cache short|long\nCurrent: ${readConfig().cacheMode}`, "info");
			return;
		}
		const cacheMode: CacheMode = mode === "long" ? "long" : "short";
		const config = { ...readConfig(), cacheMode };
		writeConfig(config);
		applyCacheMode(config);
		ctx.ui.notify(`GA memory cache mode set to ${cacheMode}. Restart or /reload if provider already initialized.`, "info");
		return;
	}
	if (command === "search") {
		const query = rest.join(" ").trim();
		if (!query) {
			ctx.ui.notify("Usage: /ga-memory search <query>", "error");
			return;
		}
		const hits = searchRecords(query, 8).map(formatRecord).join("\n\n") || "No hits.";
		ctx.ui.notify(hits.slice(0, 3_000), "info");
		return;
	}
	if (command === "open") {
		ctx.ui.notify(`Memory directory: ${STORE}`, "info");
		return;
	}
	ctx.ui.notify("Usage: /ga-memory [status|cache short|cache long|search <query>|open]", "info");
}

export default function gaEvolveExtension(pi: ExtensionAPI) {
	ensureStore();
	applyCacheMode(readConfig());

	pi.registerTool(memoryReadTool);
	pi.registerTool(memoryWriteTool);
	pi.registerTool(checkpointTool);

	pi.registerCommand("ga-memory", {
		description: "Manage GenericAgent-style layered memory and token-saving settings",
		handler: async (args, ctx) => handleCommand(args, ctx),
	});

	pi.on("resources_discover", () => {
		ensureStore();
		return { skillPaths: [L3_SKILLS_DIR] };
	});

	pi.on("before_agent_start", (event) => {
		return { systemPrompt: makeSystemPrompt(event.systemPrompt) };
	});

	pi.on("context", (event) => {
		return { messages: injectWorkingMemory(event.messages, readConfig()) };
	});

	pi.on("before_provider_request", (event) => {
		return maybeAddAnthropicCacheMarkers(event.payload, readConfig());
	});

	pi.on("tool_result", (event) => {
		const compacted = maybeExternalizeToolResult(event.toolName, event.toolCallId, event.content, readConfig().toolResultExternalizeChars);
		if (compacted) return { content: compacted, details: { externalized: true } };
		return undefined;
	});

	pi.on("agent_end", (event) => {
		ensureStore();
		let input = 0;
		let output = 0;
		let cacheRead = 0;
		let cacheWrite = 0;
		let summaries: string[] = [];
		for (const message of event.messages) {
			if (!isAssistantMessage(message)) continue;
			input += message.usage.input || 0;
			output += message.usage.output || 0;
			cacheRead += message.usage.cacheRead || 0;
			cacheWrite += message.usage.cacheWrite || 0;
			summaries = [...summaries, ...extractSummaries(assistantText(message))];
		}
		const timestamp = nowIso();
		for (const summary of summaries.slice(-5)) {
			const record: MemoryRecord = {
				id: shortHash(`summary\n${summary}\n${timestamp}`),
				layer: "L4",
				title: summary.slice(0, 80),
				content: summary,
				evidence: "assistant <summary> from current turn",
				tags: ["summary"],
				timestamp,
				source: "agent_end",
			};
			appendJsonl(todayFile(), record);
		}
		if (input + output + cacheRead + cacheWrite > 0) {
			appendJsonl(todayFile(), {
				id: shortHash(`usage\n${timestamp}\n${input}\n${output}\n${cacheRead}\n${cacheWrite}`),
				layer: "L4",
				title: "usage",
				content: `input=${input} output=${output} cacheRead=${cacheRead} cacheWrite=${cacheWrite}`,
				evidence: "assistant usage telemetry",
				tags: ["usage"],
				timestamp,
				source: "agent_end",
			} satisfies MemoryRecord);
		}
	});
}
