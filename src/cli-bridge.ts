import type { ImageContent } from "@earendil-works/pi-ai";
import type { SandboxRuntimeProvider } from "@earendil-works/pi-web-ui";
import { branding } from "./branding.js";
import { ExtractImageTool } from "./tools/extract-image.js";
import { NativeInputEventsRuntimeProvider } from "./tools/NativeInputEventsRuntimeProvider.js";
import { NavigateTool } from "./tools/navigate.js";
import { BrowserJsRuntimeProvider } from "./tools/repl/runtime-providers.js";

const BRIDGE_URL = "ws://127.0.0.1:17373";
const RECONNECT_DELAY_MS = 2000;

type BridgeCommand = {
	type: "command";
	requestId: string;
	command: string;
	args?: Record<string, unknown>;
};

type LocalAgentResponse = {
	type: "local-agent-response";
	requestId: string;
	ok: boolean;
	result?: unknown;
	error?: string;
};

type BridgeMessage = BridgeCommand | LocalAgentResponse;

type BrowserJsResponse = {
	success: boolean;
	result?: unknown;
	console?: Array<{ type?: string; text: string }>;
	error?: string;
	stack?: string;
};

type TabResult = {
	id: number;
	url: string;
	title: string;
	active: boolean;
	favicon?: string;
};

const PAGE_CASE_SCRIPT = `(() => {
	const clean = (value, limit = 500) => String(value || "").replace(/\\s+/g, " ").trim().slice(0, limit);
	const selectorFor = (element) => {
		if (element.id) return "#" + CSS.escape(element.id);
		const role = element.getAttribute("role");
		const label = element.getAttribute("aria-label");
		const tag = element.tagName.toLowerCase();
		if (role) return tag + "[role='" + role + "']";
		if (label) return tag + "[aria-label='" + clean(label, 80).replace(/'/g, "\\\\'") + "']";
		return tag;
	};
	const textOf = (element, limit = 300) => clean(element.innerText || element.textContent || "", limit);
	const headings = Array.from(document.querySelectorAll("h1,h2,h3"))
		.map((element) => ({ level: Number(element.tagName.slice(1)), text: textOf(element, 180) }))
		.filter((heading) => heading.text)
		.slice(0, 20);
	const landmarks = Array.from(document.querySelectorAll("main,nav,header,footer,aside,[role='main'],[role='navigation'],[role='banner'],[role='contentinfo'],[role='complementary']"))
		.map((element) => ({ selector: selectorFor(element), role: element.getAttribute("role") || undefined, text: textOf(element, 220) }))
		.filter((landmark) => landmark.text)
		.slice(0, 12);
	const labelFor = (element) => {
		if (element.id) {
			const label = document.querySelector("label[for='" + CSS.escape(element.id) + "']");
			if (label) return textOf(label, 160);
		}
		return clean(element.getAttribute("aria-label") || element.getAttribute("title") || "", 160);
	};
	const controls = Array.from(document.querySelectorAll("button,input,select,textarea,[role='button'],[role='textbox'],[role='combobox']"))
		.map((element) => ({
			tag: element.tagName.toLowerCase(),
			type: element.getAttribute("type") || undefined,
			name: element.getAttribute("name") || undefined,
			label: labelFor(element) || undefined,
			placeholder: element.getAttribute("placeholder") || undefined,
			text: textOf(element, 120) || undefined,
		}))
		.filter((control) => control.label || control.placeholder || control.text || control.name)
		.slice(0, 30);
	const links = Array.from(document.querySelectorAll("a[href]"))
		.map((element) => ({ text: textOf(element, 160), href: element.href }))
		.filter((link) => link.text && link.href)
		.slice(0, 30);
	const images = Array.from(document.querySelectorAll("img"))
		.map((element) => ({ alt: clean(element.alt, 180) || undefined, src: element.currentSrc || element.src || undefined }))
		.filter((image) => image.alt || image.src)
		.slice(0, 20);
	return {
		url: window.location.href,
		title: document.title,
		language: document.documentElement.lang || undefined,
		visibleText: clean(document.body?.innerText || "", 8000),
		headings,
		landmarks,
		controls,
		links,
		images,
	};
})()`;

let socket: WebSocket | undefined;
let reconnectTimer: number | undefined;
const pendingLocalAgentRequests = new Map<
	string,
	{
		resolve: (result: unknown) => void;
		reject: (error: Error) => void;
		timeout: number;
	}
>();

function sendResponse(message: BridgeCommand, ok: boolean, result?: unknown, error?: string): void {
	if (!socket || socket.readyState !== WebSocket.OPEN) return;
	socket.send(
		JSON.stringify({
			type: "response",
			requestId: message.requestId,
			ok,
			result,
			error,
		}),
	);
}

function rejectPendingLocalAgentRequests(error: Error): void {
	for (const pending of pendingLocalAgentRequests.values()) {
		window.clearTimeout(pending.timeout);
		pending.reject(error);
	}
	pendingLocalAgentRequests.clear();
}

function handleLocalAgentResponse(message: LocalAgentResponse): void {
	const pending = pendingLocalAgentRequests.get(message.requestId);
	if (!pending) return;

	if (!message.ok) {
		pending.reject(new Error(message.error || "Local agent request failed"));
		return;
	}

	pending.resolve(message.result);
}

export function isLocalBridgeConnected(): boolean {
	return !!socket && socket.readyState === WebSocket.OPEN;
}

export function requestLocalAgentReview(args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
	if (!isLocalBridgeConnected()) {
		throw new Error(
			`Local ${branding.productName} bridge is not connected. Start it with \`sitegeist bridge\` and try again.`,
		);
	}

	if (signal?.aborted) {
		throw new Error("Local agent review aborted");
	}

	const requestId = crypto.randomUUID();

	return new Promise((resolve, reject) => {
		let abortListener: (() => void) | undefined;
		const timeout = window.setTimeout(() => {
			clearPending();
			reject(new Error("Local agent review timed out"));
		}, 600_000);

		function clearPending() {
			window.clearTimeout(timeout);
			pendingLocalAgentRequests.delete(requestId);
			if (signal && abortListener) {
				signal.removeEventListener("abort", abortListener);
			}
		}

		abortListener = () => {
			clearPending();
			reject(new Error("Local agent review aborted"));
		};

		if (signal) {
			signal.addEventListener("abort", abortListener, { once: true });
		}

		pendingLocalAgentRequests.set(requestId, {
			resolve: (result) => {
				clearPending();
				resolve(result);
			},
			reject: (error) => {
				clearPending();
				reject(error);
			},
			timeout,
		});

		socket?.send(
			JSON.stringify({
				type: "local-agent-request",
				requestId,
				command: "review_page_issue",
				args,
			}),
		);
	});
}

function toTabResult(tab: chrome.tabs.Tab): TabResult | undefined {
	if (tab.id === undefined || !tab.url) return undefined;
	return {
		id: tab.id,
		url: tab.url,
		title: tab.title || "Untitled",
		active: !!tab.active,
		favicon: tab.favIconUrl,
	};
}

async function activeTab(): Promise<TabResult | undefined> {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	return tab ? toTabResult(tab) : undefined;
}

async function listTabs(): Promise<TabResult[]> {
	const tabs = await chrome.tabs.query({});
	return tabs.map(toTabResult).filter((tab): tab is TabResult => !!tab);
}

function imageFromToolResult(
	content: Array<{ type: string; data?: string; mimeType?: string }>,
): ImageContent | undefined {
	return content.find((item): item is ImageContent => item.type === "image" && !!item.data && !!item.mimeType);
}

async function captureScreenshot(windowId: number): Promise<ImageContent> {
	const tool = new ExtractImageTool();
	tool.windowId = windowId;
	const result = await tool.execute(`cli_screenshot_${Date.now()}`, {
		mode: "screenshot",
		maxWidth: 1400,
	});
	const image = imageFromToolResult(result.content);
	if (!image) {
		throw new Error("Screenshot command did not return image data");
	}
	return image;
}

async function navigateTo(url: unknown): Promise<unknown> {
	if (typeof url !== "string" || !url) {
		throw new Error("navigate requires a URL string");
	}
	const tool = new NavigateTool();
	const result = await tool.execute(`cli_navigate_${Date.now()}`, { url });
	return result.details;
}

async function evaluateInPage(code: unknown): Promise<BrowserJsResponse> {
	if (typeof code !== "string" || !code.trim()) {
		throw new Error("eval requires JavaScript code");
	}

	const pageProviders: SandboxRuntimeProvider[] = [new NativeInputEventsRuntimeProvider()];
	const browserProvider = new BrowserJsRuntimeProvider(pageProviders);
	const functionSource = String(async (source: string) => {
		const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
			code: string,
		) => () => Promise<unknown>;
		let runner: () => Promise<unknown>;

		try {
			runner = new AsyncFunction(`return (${source});`);
		} catch {
			runner = new AsyncFunction(source);
		}

		return await runner.call(window);
	});

	const response = await new Promise<BrowserJsResponse>((resolve) => {
		browserProvider.handleMessage(
			{
				type: "browser-js",
				code: functionSource,
				args: JSON.stringify([code]),
			},
			(result: BrowserJsResponse) => resolve(result),
		);
	});

	browserProvider.cleanupAll();
	if (!response.success) {
		throw new Error(response.error || "Page eval failed");
	}
	return response;
}

export async function capturePageCase(includeScreenshot: unknown, windowId: number): Promise<unknown> {
	const tab = await activeTab();
	const pageResponse = await evaluateInPage(PAGE_CASE_SCRIPT);
	const screenshot = includeScreenshot ? await captureScreenshot(windowId) : undefined;

	return {
		active: tab,
		page: pageResponse.result,
		console: pageResponse.console || [],
		screenshot,
		capturedAt: new Date().toISOString(),
	};
}

async function executeCommand(message: BridgeCommand, windowId: number): Promise<unknown> {
	if (message.command === "tabs") {
		return { tabs: await listTabs() };
	}

	if (message.command === "active") {
		return { tab: await activeTab() };
	}

	if (message.command === "navigate") {
		return await navigateTo(message.args?.url);
	}

	if (message.command === "screenshot") {
		return { image: await captureScreenshot(windowId) };
	}

	if (message.command === "eval") {
		return await evaluateInPage(message.args?.code);
	}

	if (message.command === "evidence") {
		const tab = await activeTab();
		const screenshot = await captureScreenshot(windowId);
		return {
			active: tab,
			screenshot,
			capturedAt: new Date().toISOString(),
		};
	}

	if (message.command === "case") {
		return await capturePageCase(message.args?.includeScreenshot, windowId);
	}

	throw new Error(`Unknown ${branding.productName} CLI command: ${message.command}`);
}

export function startCliBridgeClient(getWindowId: () => number | undefined): void {
	if (socket || reconnectTimer !== undefined) return;

	const connect = () => {
		reconnectTimer = undefined;

		try {
			socket = new WebSocket(BRIDGE_URL);

			socket.onopen = () => {
				socket?.send(JSON.stringify({ type: "hello", role: "extension" }));
				console.log(`[CLI bridge] Connected to ${branding.productName} bridge`);
			};

			socket.onmessage = (event) => {
				let message: BridgeMessage;
				try {
					message = JSON.parse(event.data as string) as BridgeMessage;
				} catch {
					return;
				}

				if (message.type === "local-agent-response") {
					handleLocalAgentResponse(message);
					return;
				}

				const windowId = getWindowId();
				if (message.type !== "command") return;
				if (windowId === undefined) {
					sendResponse(message, false, undefined, `${branding.productName} window is not ready yet`);
					return;
				}

				executeCommand(message, windowId)
					.then((result) => sendResponse(message, true, result))
					.catch((error: unknown) =>
						sendResponse(message, false, undefined, error instanceof Error ? error.message : String(error)),
					);
			};

			socket.onerror = () => {
				// The bridge is optional; normal extension use should stay silent when it is absent.
			};

			socket.onclose = () => {
				socket = undefined;
				rejectPendingLocalAgentRequests(new Error(`Local ${branding.productName} bridge disconnected`));
				reconnectTimer = window.setTimeout(connect, RECONNECT_DELAY_MS);
			};
		} catch {
			socket = undefined;
			reconnectTimer = window.setTimeout(connect, RECONNECT_DELAY_MS);
		}
	};

	connect();
}
