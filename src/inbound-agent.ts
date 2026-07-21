import {
	Agent,
	type AgentEvent,
	type AgentMessage,
	type AgentState,
	type AgentTool,
	type ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ImageContent, TextContent } from "@earendil-works/pi-ai";
import { createExtractDocumentTool } from "@earendil-works/pi-web-ui";
import {
	createProviderKeyResolver,
	createSitegeistStreamFn,
	findModelById,
	resolveDefaultModel,
} from "./agent-factory.js";
import type { AgentTurnCompletion, SitegeistTurnFrame, TurnUsage } from "./inbound-frames.js";
import { browserMessageTransformer } from "./messages/message-transformer.js";
import { SYSTEM_PROMPT, withMemoryIndex } from "./prompts/prompts.js";
import { buildSessionPreview, generateSessionTitle, shouldSaveSession } from "./session-state.js";
import type { SitegeistAppStorage } from "./storage/app-storage.js";
import { ExtractImageTool } from "./tools/extract-image.js";
import { memoryTool } from "./tools/memory.js";
import { NativeInputEventsRuntimeProvider } from "./tools/NativeInputEventsRuntimeProvider.js";
import { NavigateTool } from "./tools/navigate.js";
import { ChartHelpersRuntimeProvider } from "./tools/repl/ChartHelpersRuntimeProvider.js";
import { createReplTool } from "./tools/repl/repl.js";
import { BrowserJsRuntimeProvider, NavigateRuntimeProvider } from "./tools/repl/runtime-providers.js";
import { skillTool } from "./tools/skill.js";

export type InboundTurnRequest = {
	requestId: string;
	task: string;
	sessionId?: string;
	model?: string;
	thinkingLevel?: string;
	resume?: boolean;
};

export type InboundTurnSink = {
	sendEvent: (requestId: string, seq: number, frame: SitegeistTurnFrame) => void;
	sendComplete: (requestId: string, completion: AgentTurnCompletion) => void;
};

export type InboundTurnContext = {
	storage: SitegeistAppStorage;
	windowId: number;
	isPanelBusy: () => boolean;
};

const THINKING_LEVELS: ReadonlySet<string> = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);

let activeTurn: { requestId: string; agent?: Agent } | undefined;

/** Dedicated window inbound turns are pinned to; recreated when closed. */
let workWindowId: number | undefined;

async function isPinnedWindowEnabled(): Promise<boolean> {
	const stored = await chrome.storage.local.get("inboundPinnedWindow");
	return stored.inboundPinnedWindow !== false;
}

/**
 * Screenshots use captureVisibleTab, which only sees a window's visible tab —
 * so the pin target is a whole window (whose active tab stays visible) rather
 * than a background tab in the user's window.
 */
async function ensureWorkWindow(): Promise<number> {
	if (workWindowId !== undefined) {
		try {
			await chrome.windows.get(workWindowId);
			return workWindowId;
		} catch {
			workWindowId = undefined;
		}
	}
	const created = await chrome.windows.create({ focused: false, width: 1280, height: 900 });
	if (created?.id === undefined) {
		throw new Error("Failed to create the pinned work window for the inbound turn");
	}
	workWindowId = created.id;
	return workWindowId;
}

export function isInboundAgentTurnActive(): boolean {
	return activeTurn !== undefined;
}

export function abortInboundAgentTurn(requestId: string): void {
	if (activeTurn?.requestId === requestId) {
		activeTurn.agent?.abort();
	}
}

function buildHeadlessTools(windowId: number, corsProxyUrl: string | undefined): AgentTool<any, any>[] {
	// Sidepanel tool set minus tools an unattended turn must not run:
	// ask_user_which_element blocks on a human, the debugger tool contends for
	// the single chrome.debugger attach, and local_agent_review calls back out
	// through the same bridge the turn arrived on. Every tool targets the
	// active tab of the given window, never the user's current window.
	const navigateTool = new NavigateTool();
	navigateTool.targetWindowId = windowId;

	const extractDocumentTool = createExtractDocumentTool();
	if (corsProxyUrl) {
		extractDocumentTool.corsProxyUrl = `${corsProxyUrl}/?url=`;
	}

	const replTool = createReplTool();
	replTool.sandboxUrlProvider = () => chrome.runtime.getURL("sandbox.html");
	replTool.targetWindowId = windowId;
	replTool.runtimeProvidersFactory = () => {
		const nativeInput = new NativeInputEventsRuntimeProvider();
		nativeInput.targetWindowId = windowId;
		const pageProviders = [nativeInput, new ChartHelpersRuntimeProvider()];
		const browserJs = new BrowserJsRuntimeProvider(pageProviders);
		browserJs.targetWindowId = windowId;
		return [...pageProviders, browserJs, new NavigateRuntimeProvider(navigateTool)];
	};

	const extractImageTool = new ExtractImageTool();
	extractImageTool.windowId = windowId;

	return [navigateTool, replTool, skillTool, extractDocumentTool, extractImageTool, memoryTool];
}

function textFromAssistantContent(content: AssistantMessage["content"]): string {
	return content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("");
}

function toTurnUsage(usage: AssistantMessage["usage"]): TurnUsage {
	return {
		input: usage.input,
		output: usage.output,
		cacheRead: usage.cacheRead,
		cacheWrite: usage.cacheWrite,
		totalCostUsd: usage.cost.total > 0 ? usage.cost.total : undefined,
	};
}

function sumUsage(messages: AgentMessage[]): TurnUsage | undefined {
	let sawAssistant = false;
	const total: Required<Omit<TurnUsage, "totalCostUsd">> & { totalCostUsd: number } = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalCostUsd: 0,
	};
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		sawAssistant = true;
		const usage = (message as AssistantMessage).usage;
		total.input += usage.input;
		total.output += usage.output;
		total.cacheRead += usage.cacheRead;
		total.cacheWrite += usage.cacheWrite;
		total.totalCostUsd += usage.cost.total;
	}
	if (!sawAssistant) return undefined;
	return {
		input: total.input,
		output: total.output,
		cacheRead: total.cacheRead,
		cacheWrite: total.cacheWrite,
		totalCostUsd: total.totalCostUsd > 0 ? total.totalCostUsd : undefined,
	};
}

function toolResultFrame(event: Extract<AgentEvent, { type: "tool_execution_end" }>): SitegeistTurnFrame {
	const result = event.result as { content?: (TextContent | ImageContent)[]; details?: unknown } | undefined;
	const content = Array.isArray(result?.content) ? result.content : [];
	const outputText =
		content
			.filter((block): block is TextContent => block.type === "text")
			.map((block) => block.text)
			.join("\n") || undefined;
	const image = content.find((block): block is ImageContent => block.type === "image");
	return {
		kind: "tool_result",
		callId: event.toolCallId,
		status: event.isError ? "error" : "ok",
		outputText,
		image,
		raw: result?.details,
	};
}

function translateAgentEvent(
	event: AgentEvent,
	sessionId: string,
	tools: AgentTool<any, any>[],
): SitegeistTurnFrame | undefined {
	if (event.type === "agent_start") {
		return { kind: "started", sessionId };
	}
	if (event.type === "message_update") {
		const streamEvent = event.assistantMessageEvent;
		if (streamEvent.type === "text_delta") return { kind: "text", delta: streamEvent.delta };
		if (streamEvent.type === "thinking_delta") return { kind: "thinking", delta: streamEvent.delta };
		return undefined;
	}
	if (event.type === "message_end") {
		if (event.message.role !== "assistant") return undefined;
		return { kind: "usage", usage: toTurnUsage((event.message as AssistantMessage).usage) };
	}
	if (event.type === "tool_execution_start") {
		const tool = tools.find((candidate) => candidate.name === event.toolName);
		return {
			kind: "tool_call",
			callId: event.toolCallId,
			tool: event.toolName,
			title: tool?.label || event.toolName,
			input: event.args,
		};
	}
	if (event.type === "tool_execution_end") {
		return toolResultFrame(event);
	}
	return undefined;
}

async function persistSession(storage: SitegeistAppStorage, sessionId: string, state: AgentState): Promise<void> {
	if (!shouldSaveSession(state.messages)) return;

	const usage = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	for (const message of state.messages) {
		if (message.role !== "assistant") continue;
		const messageUsage = (message as AssistantMessage).usage;
		usage.input += messageUsage.input;
		usage.output += messageUsage.output;
		usage.cacheRead += messageUsage.cacheRead;
		usage.cacheWrite += messageUsage.cacheWrite;
		usage.totalTokens += messageUsage.input + messageUsage.output + messageUsage.cacheRead + messageUsage.cacheWrite;
		if (messageUsage.cost) {
			usage.cost.input += messageUsage.cost.input;
			usage.cost.output += messageUsage.cost.output;
			usage.cost.cacheRead += messageUsage.cost.cacheRead;
			usage.cost.cacheWrite += messageUsage.cost.cacheWrite;
			usage.cost.total += messageUsage.cost.total;
		}
	}

	const existing = await storage.sessions.getMetadata(sessionId);
	const title = existing?.title || generateSessionTitle(state.messages);
	const metadata = {
		id: sessionId,
		title,
		createdAt: existing?.createdAt || new Date().toISOString(),
		lastModified: new Date().toISOString(),
		messageCount: state.messages.length,
		usage,
		modelId: state.model.id,
		thinkingLevel: state.thinkingLevel,
		preview: buildSessionPreview(state.messages),
	};
	await storage.sessions.saveSession(sessionId, state, metadata, title);
}

export async function runInboundAgentTurn(
	request: InboundTurnRequest,
	context: InboundTurnContext,
	sink: InboundTurnSink,
): Promise<void> {
	if (context.isPanelBusy() || activeTurn) {
		sink.sendComplete(request.requestId, {
			status: "failed",
			error: "browser busy: another agent turn is in progress",
			sessionId: request.sessionId,
		});
		return;
	}
	activeTurn = { requestId: request.requestId };

	let seq = 0;
	const sendFrame = (frame: SitegeistTurnFrame): void => {
		sink.sendEvent(request.requestId, seq, frame);
		seq += 1;
	};

	try {
		const { storage, windowId } = context;

		if (request.thinkingLevel !== undefined && !THINKING_LEVELS.has(request.thinkingLevel)) {
			sink.sendComplete(request.requestId, {
				status: "failed",
				error: `Unsupported thinking level: ${request.thinkingLevel}`,
				sessionId: request.sessionId,
			});
			return;
		}

		let resumedMessages: AgentMessage[] = [];
		let resumedModel: Awaited<ReturnType<typeof resolveDefaultModel>> | undefined;
		let resumedThinking: ThinkingLevel | undefined;
		if (request.resume) {
			if (!request.sessionId) {
				sink.sendComplete(request.requestId, {
					status: "failed",
					error: "resume requested without a sessionId",
				});
				return;
			}
			const session = await storage.sessions.loadSession(request.sessionId);
			if (!session) {
				sink.sendComplete(request.requestId, {
					status: "failed",
					error: `Unknown session: ${request.sessionId}`,
					sessionId: request.sessionId,
				});
				return;
			}
			resumedMessages = session.messages;
			resumedModel = session.model;
			resumedThinking = session.thinkingLevel;
		}
		const sessionId = request.sessionId || crypto.randomUUID();

		let model = request.model ? findModelById(request.model) : undefined;
		if (request.model && !model) {
			sink.sendComplete(request.requestId, {
				status: "failed",
				error: `Unknown model: ${request.model}`,
				sessionId,
			});
			return;
		}
		if (!model) {
			model = resumedModel || (await resolveDefaultModel(storage));
		}

		const thinkingLevel = (request.thinkingLevel as ThinkingLevel | undefined) || resumedThinking || "medium";

		const corsProxyEnabled = await storage.settings.get<boolean>("proxy.enabled");
		const corsProxyUrl = corsProxyEnabled
			? (await storage.settings.get<string>("proxy.url")) || undefined
			: undefined;
		const targetWindowId = (await isPinnedWindowEnabled()) ? await ensureWorkWindow() : windowId;
		const tools = buildHeadlessTools(targetWindowId, corsProxyUrl);

		const memoryIndex = await storage.memories.getIndex();
		const agent = new Agent({
			initialState: {
				systemPrompt: withMemoryIndex(SYSTEM_PROMPT, memoryIndex),
				model,
				thinkingLevel,
				messages: resumedMessages,
				tools,
			},
			convertToLlm: browserMessageTransformer,
			toolExecution: "sequential",
			streamFn: createSitegeistStreamFn(storage),
			getApiKey: createProviderKeyResolver(storage),
			sessionId,
		});
		activeTurn.agent = agent;

		const startCount = agent.state.messages.length;
		const unsubscribe = agent.subscribe((event: AgentEvent) => {
			const frame = translateAgentEvent(event, sessionId, tools);
			if (frame) sendFrame(frame);
		});

		try {
			await agent.prompt(request.task);
			await agent.waitForIdle();
		} finally {
			unsubscribe();
		}

		const state = agent.state;
		const newMessages = state.messages.slice(startCount);
		const lastAssistant = [...newMessages]
			.reverse()
			.find((message): message is AssistantMessage => message.role === "assistant");
		const stopReason = lastAssistant?.stopReason;
		const status: AgentTurnCompletion["status"] =
			stopReason === "aborted"
				? "interrupted"
				: stopReason === undefined || stopReason === "error"
					? "failed"
					: "completed";
		const finalText = lastAssistant ? textFromAssistantContent(lastAssistant.content) || undefined : undefined;
		const error =
			status === "failed"
				? state.errorMessage || lastAssistant?.errorMessage || "Agent turn produced no assistant response"
				: undefined;

		await persistSession(storage, sessionId, state);

		sink.sendComplete(request.requestId, {
			status,
			finalText,
			error,
			usage: sumUsage(newMessages),
			sessionId,
		});
	} catch (error) {
		sink.sendComplete(request.requestId, {
			status: "failed",
			error: error instanceof Error ? error.message : String(error),
			sessionId: request.sessionId,
		});
	} finally {
		if (activeTurn?.requestId === request.requestId) {
			activeTurn = undefined;
		}
	}
}
