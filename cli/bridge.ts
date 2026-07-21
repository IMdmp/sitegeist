import { spawn } from "node:child_process";
import type { IncomingMessage } from "node:http";
import WebSocket, { WebSocketServer } from "ws";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 17373;
const DEFAULT_REVIEW_TIMEOUT_MS = 600_000;

type BridgeRoleMessage = {
	type: "hello";
	role: "extension";
};

type CliCommandMessage = {
	type: "command";
	requestId: string;
	command: string;
	args?: Record<string, unknown>;
};

type ExtensionResponseMessage = {
	type: "response";
	requestId: string;
	ok: boolean;
	result?: unknown;
	error?: string;
};

type LocalAgentRequestMessage = {
	type: "local-agent-request";
	requestId: string;
	command: "review_page_issue";
	args?: Record<string, unknown>;
};

type LocalAgentResponseMessage = {
	type: "local-agent-response";
	requestId: string;
	ok: boolean;
	result?: unknown;
	error?: string;
};

type AgentTurnRequestMessage = {
	type: "agent-turn-request";
	requestId: string;
	task: string;
	sessionId?: string;
	model?: string;
	thinkingLevel?: string;
	resume?: boolean;
};

type AgentTurnEventMessage = {
	type: "agent-turn-event";
	requestId: string;
	seq: number;
	event: Record<string, unknown>;
};

type AgentTurnCompleteMessage = {
	type: "agent-turn-complete";
	requestId: string;
	status: "completed" | "failed" | "interrupted";
	finalText?: string;
	error?: string;
	usage?: Record<string, unknown>;
	sessionId?: string;
};

type AgentTurnErrorMessage = {
	type: "agent-turn-error";
	requestId: string;
	error: string;
};

type AgentTurnAbortMessage = {
	type: "agent-turn-abort";
	requestId: string;
};

type BridgeMessage =
	| BridgeRoleMessage
	| CliCommandMessage
	| ExtensionResponseMessage
	| LocalAgentRequestMessage
	| AgentTurnRequestMessage
	| AgentTurnEventMessage
	| AgentTurnCompleteMessage
	| AgentTurnAbortMessage;

type BridgeSocket = WebSocket;

function parseMessage(data: unknown): BridgeMessage | undefined {
	const raw = typeof data === "string" ? data : data instanceof Buffer ? data.toString("utf8") : undefined;
	if (!raw) return undefined;

	try {
		const parsed = JSON.parse(raw) as Partial<BridgeMessage>;
		if (!parsed || typeof parsed.type !== "string") return undefined;
		return parsed as BridgeMessage;
	} catch {
		return undefined;
	}
}

type OutgoingMessage =
	| ExtensionResponseMessage
	| CliCommandMessage
	| LocalAgentResponseMessage
	| AgentTurnRequestMessage
	| AgentTurnEventMessage
	| AgentTurnCompleteMessage
	| AgentTurnErrorMessage
	| AgentTurnAbortMessage;

function sendJson(socket: BridgeSocket, message: OutgoingMessage): void {
	socket.send(JSON.stringify(message));
}

function isOpen(socket: BridgeSocket | undefined): socket is BridgeSocket {
	return !!socket && socket.readyState === WebSocket.OPEN;
}

function isExtensionOrigin(request: IncomingMessage): boolean {
	const origin = request.headers.origin;
	return (
		typeof origin === "string" &&
		(origin.startsWith("chrome-extension://") || origin.startsWith("moz-extension://"))
	);
}

function hasBrowserOrigin(request: IncomingMessage): boolean {
	return typeof request.headers.origin === "string";
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function getString(record: Record<string, unknown> | undefined, key: string): string | undefined {
	const value = record?.[key];
	return typeof value === "string" ? value : undefined;
}

function formatReviewSummary(args: Record<string, unknown> | undefined): string {
	const evidence = getRecord(args?.evidence);
	const active = getRecord(evidence?.active);
	const page = getRecord(evidence?.page);
	const lines = [
		"Request summary:",
		`- Problem: ${getString(args, "problem") || "(not provided)"}`,
		`- Workspace hint: ${getString(args, "workspaceHint") || "(not provided)"}`,
		`- Active URL: ${getString(active, "url") || getString(page, "url") || "(unknown)"}`,
		`- Page title: ${getString(page, "title") || getString(active, "title") || "(unknown)"}`,
	];
	return lines.join("\n");
}

function fallbackLocalReview(message: LocalAgentRequestMessage): Record<string, unknown> {
	const summary = formatReviewSummary(message.args);
	return {
		adapter: "none",
		text: [
			"Local bridge is connected, but no review command is configured.",
			"Restart it with --review-command or set SITEGEIST_REVIEW_COMMAND.",
			"The configured command receives a JSON payload on stdin and should print its review to stdout.",
			"",
			summary,
		].join("\n"),
	};
}

function runReviewCommand(
	command: string,
	message: LocalAgentRequestMessage,
	timeoutMs: number,
): Promise<Record<string, unknown>> {
	const startedAt = Date.now();
	const payload = {
		protocolVersion: 1,
		command: message.command,
		request: message.args || {},
		receivedAt: new Date().toISOString(),
	};

	return new Promise((resolve, reject) => {
		const child = spawn(command, {
			env: {
				...process.env,
				SITEGEIST_LOCAL_REQUEST: message.command,
			},
			shell: true,
			stdio: ["pipe", "pipe", "pipe"],
		});
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		let timedOut = false;

		const timeout = setTimeout(() => {
			timedOut = true;
			child.kill("SIGTERM");
		}, timeoutMs);

		child.stdout?.on("data", (chunk: Buffer | string) => {
			stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
		});

		child.stderr?.on("data", (chunk: Buffer | string) => {
			stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
		});

		child.on("error", (error) => {
			clearTimeout(timeout);
			reject(error);
		});

		child.on("close", (code) => {
			clearTimeout(timeout);
			const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
			const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
			const durationMs = Date.now() - startedAt;

			if (timedOut) {
				reject(new Error(`Review command timed out after ${timeoutMs}ms`));
				return;
			}

			if (code !== 0) {
				reject(
					new Error(
						[
							`Review command exited with code ${code ?? "unknown"}`,
							stdout ? `stdout:\n${stdout}` : undefined,
							stderr ? `stderr:\n${stderr}` : undefined,
						]
							.filter(Boolean)
							.join("\n\n"),
					),
				);
				return;
			}

			resolve({
				adapter: "command",
				durationMs,
				text: stdout || stderr || "(review command completed without output)",
				stderr: stderr || undefined,
			});
		});

		child.stdin.end(`${JSON.stringify(payload, null, 2)}\n`);
	});
}

async function handleLocalAgentRequest(
	message: LocalAgentRequestMessage,
	reviewCommand: string | undefined,
	reviewTimeoutMs: number,
): Promise<unknown> {
	if (message.command !== "review_page_issue") {
		throw new Error(`Unknown local agent command: ${message.command}`);
	}

	if (!reviewCommand) {
		return fallbackLocalReview(message);
	}

	return await runReviewCommand(reviewCommand, message, reviewTimeoutMs);
}

export function startBridge(options: { host?: string; port?: number; reviewCommand?: string } = {}): void {
	const host = options.host || DEFAULT_HOST;
	const port = options.port || DEFAULT_PORT;
	const reviewCommand = options.reviewCommand || process.env.SITEGEIST_REVIEW_COMMAND;
	const reviewTimeoutMs = DEFAULT_REVIEW_TIMEOUT_MS;
	const server = new WebSocketServer({ host, port });
	let extensionSocket: BridgeSocket | undefined;
	const pending = new Map<string, BridgeSocket>();
	const pendingAgentTurns = new Map<string, BridgeSocket>();

	function rejectPending(error: string): void {
		for (const [requestId, socket] of pending) {
			if (isOpen(socket)) {
				sendJson(socket, { type: "response", requestId, ok: false, error });
			}
		}
		pending.clear();

		for (const [requestId, socket] of pendingAgentTurns) {
			if (isOpen(socket)) {
				sendJson(socket, { type: "agent-turn-error", requestId, error });
			}
		}
		pendingAgentTurns.clear();
	}

	server.on("connection", (socket, request) => {
		const extensionOrigin = isExtensionOrigin(request);
		const browserOrigin = hasBrowserOrigin(request);

		socket.on("error", (error) => {
			console.warn("[sitegeist bridge] socket error:", error.message);
		});

		socket.on("message", (data) => {
			const message = parseMessage(data);
			if (!message) {
				sendJson(socket, {
					type: "response",
					requestId: "unknown",
					ok: false,
					error: "Invalid bridge message",
				});
				return;
			}

			if (message.type === "hello" && message.role === "extension") {
				if (!extensionOrigin) {
					sendJson(socket, {
						type: "response",
						requestId: "unknown",
						ok: false,
						error: "Extension registration requires a browser extension origin",
					});
					socket.close(1008, "Extension registration requires a browser extension origin");
					return;
				}
				if (isOpen(extensionSocket) && extensionSocket !== socket) {
					extensionSocket.close(1000, "Replaced by a newer Sitegeist sidepanel connection");
				}
				extensionSocket = socket;
				console.log("[sitegeist bridge] extension connected");
				return;
			}

			if (message.type === "command") {
				if (browserOrigin) {
					sendJson(socket, {
						type: "response",
						requestId: message.requestId,
						ok: false,
						error: "Terminal bridge commands are accepted only from local non-browser clients",
					});
					return;
				}

				if (!isOpen(extensionSocket)) {
					sendJson(socket, {
						type: "response",
						requestId: message.requestId,
						ok: false,
						error: "Sitegeist sidepanel is not connected. Open the extension side panel and retry.",
					});
					return;
				}

				pending.set(message.requestId, socket);
				sendJson(extensionSocket, message);
				return;
			}

			if (message.type === "agent-turn-request") {
				if (browserOrigin) {
					sendJson(socket, {
						type: "agent-turn-error",
						requestId: message.requestId,
						error: "Agent turn requests are accepted only from local non-browser clients",
					});
					return;
				}

				if (!isOpen(extensionSocket)) {
					sendJson(socket, {
						type: "agent-turn-error",
						requestId: message.requestId,
						error: "Sitegeist sidepanel is not connected. Open the extension side panel and retry.",
					});
					return;
				}

				pendingAgentTurns.set(message.requestId, socket);
				sendJson(extensionSocket, message);
				return;
			}

			if (message.type === "agent-turn-event" || message.type === "agent-turn-complete") {
				if (socket !== extensionSocket) return;
				const adapterSocket = pendingAgentTurns.get(message.requestId);
				if (message.type === "agent-turn-complete") {
					pendingAgentTurns.delete(message.requestId);
				}
				if (isOpen(adapterSocket)) {
					sendJson(adapterSocket, message);
				}
				return;
			}

			if (message.type === "agent-turn-abort") {
				if (pendingAgentTurns.get(message.requestId) !== socket) return;
				if (isOpen(extensionSocket)) {
					sendJson(extensionSocket, message);
				}
				return;
			}

			if (message.type === "local-agent-request") {
				if (socket !== extensionSocket) {
					sendJson(socket, {
						type: "local-agent-response",
						requestId: message.requestId,
						ok: false,
						error: "Local agent requests are accepted only from the connected Sitegeist extension",
					});
					return;
				}

				handleLocalAgentRequest(message, reviewCommand, reviewTimeoutMs)
					.then((result) => {
						if (isOpen(socket)) {
							sendJson(socket, {
								type: "local-agent-response",
								requestId: message.requestId,
								ok: true,
								result,
							});
						}
					})
					.catch((error: unknown) => {
						if (isOpen(socket)) {
							sendJson(socket, {
								type: "local-agent-response",
								requestId: message.requestId,
								ok: false,
								error: error instanceof Error ? error.message : String(error),
							});
						}
					});
				return;
			}

			if (message.type === "response") {
				const cliSocket = pending.get(message.requestId);
				pending.delete(message.requestId);
				if (isOpen(cliSocket)) {
					sendJson(cliSocket, message);
				}
			}
		});

		socket.on("close", () => {
			if (socket === extensionSocket) {
				extensionSocket = undefined;
				rejectPending("Sitegeist sidepanel disconnected before responding");
				console.log("[sitegeist bridge] extension disconnected");
				return;
			}

			for (const [requestId, pendingSocket] of pending) {
				if (pendingSocket === socket) {
					pending.delete(requestId);
				}
			}

			for (const [requestId, pendingSocket] of pendingAgentTurns) {
				if (pendingSocket === socket) {
					pendingAgentTurns.delete(requestId);
					if (isOpen(extensionSocket)) {
						sendJson(extensionSocket, { type: "agent-turn-abort", requestId });
					}
				}
			}
		});
	});

	server.on("listening", () => {
		console.log(`[sitegeist bridge] listening on ws://${host}:${port}`);
	});

	server.on("error", (error) => {
		console.error("[sitegeist bridge] failed:", error);
		process.exitCode = 1;
	});
}
