#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import WebSocket from "ws";
import { startBridge } from "./bridge.js";

const DEFAULT_BRIDGE_URL = "ws://127.0.0.1:17373";

type CliResponse = {
	type: "response";
	requestId: string;
	ok: boolean;
	result?: unknown;
	error?: string;
};

type ImagePayload = {
	data: string;
	mimeType: string;
};

type ScreenshotResult = {
	image?: ImagePayload;
};

type ActiveTabResult = {
	tab?: {
		id: number;
		url: string;
		title: string;
		active: boolean;
	};
};

type EvidenceResult = {
	active?: ActiveTabResult["tab"];
	screenshot?: ImagePayload;
	capturedAt?: string;
};

type BrowserEvalResult = {
	success: boolean;
	result?: unknown;
	console?: Array<{ type?: string; text: string }>;
};

type PageHeading = {
	level: number;
	text: string;
};

type PageLandmark = {
	selector: string;
	role?: string;
	text: string;
};

type PageControl = {
	tag: string;
	type?: string;
	name?: string;
	label?: string;
	placeholder?: string;
	text?: string;
};

type PageLink = {
	text: string;
	href: string;
};

type PageImage = {
	alt?: string;
	src?: string;
};

type PageCase = {
	url: string;
	title: string;
	language?: string;
	visibleText: string;
	headings: PageHeading[];
	landmarks: PageLandmark[];
	controls: PageControl[];
	links: PageLink[];
	images: PageImage[];
};

type CaseResult = {
	active?: ActiveTabResult["tab"];
	page?: PageCase;
	console?: Array<{ type?: string; text: string }>;
	screenshot?: ImagePayload;
	capturedAt: string;
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

function printUsage(exitCode = 0): never {
	const text = `Usage:
  sitegeist bridge [--port 17373] [--review-command '<command>']
  sitegeist tabs
  sitegeist active
  sitegeist navigate <url>
  sitegeist eval '<code>'
  sitegeist click <selector>
  sitegeist type <selector> <text>
  sitegeist press <key>
  sitegeist key-down <key>
  sitegeist key-up <key>
  sitegeist screenshot [--out path]
  sitegeist evidence [--out path]
  sitegeist case [--out path]

Options:
  --bridge-url <url>  Override bridge URL (default: ${DEFAULT_BRIDGE_URL})
  --out <path>        Write screenshot/evidence output to a file
  --port <port>       Bridge server port
  --review-command    Local review command. Receives JSON on stdin and writes review text to stdout.`;
	console.log(text);
	process.exit(exitCode);
}

function takeOption(args: string[], name: string): string | undefined {
	const index = args.indexOf(name);
	if (index === -1) return undefined;
	const value = args[index + 1];
	if (!value || value.startsWith("--")) {
		throw new Error(`${name} requires a value`);
	}
	args.splice(index, 2);
	return value;
}

function bridgeUrlFromArgs(args: string[]): string {
	return takeOption(args, "--bridge-url") || process.env.SITEGEIST_BRIDGE_URL || DEFAULT_BRIDGE_URL;
}

function stringify(value: unknown): string {
	if (typeof value === "string") return value;
	if (value === undefined) return "";
	return JSON.stringify(value, null, 2);
}

function runtimeCall(name: string, values: string[]): string {
	return `await ${name}(${values.map((value) => JSON.stringify(value)).join(", ")})`;
}

function sendCommand(bridgeUrl: string, command: string, args: Record<string, unknown> = {}): Promise<unknown> {
	const requestId = crypto.randomUUID();

	return new Promise((resolvePromise, reject) => {
		const socket = new WebSocket(bridgeUrl);
		const timeout = setTimeout(() => {
			socket.close();
			reject(new Error(`Timed out waiting for ${bridgeUrl}`));
		}, 120000);

		socket.on("open", () => {
			socket.send(JSON.stringify({ type: "command", requestId, command, args }));
		});

		socket.on("message", (raw) => {
			let response: CliResponse;
			try {
				response = JSON.parse(raw.toString("utf8")) as CliResponse;
			} catch {
				clearTimeout(timeout);
				socket.close();
				reject(new Error("Bridge returned invalid JSON"));
				return;
			}

			if (response.requestId !== requestId) return;

			clearTimeout(timeout);
			socket.close();
			if (!response.ok) {
				reject(new Error(response.error || "Sitegeist command failed"));
				return;
			}
			resolvePromise(response.result);
		});

		socket.on("error", (error) => {
			clearTimeout(timeout);
			socket.close();
			reject(error);
		});
	});
}

async function writeBase64(path: string, image: ImagePayload): Promise<void> {
	const outputPath = resolve(path);
	await mkdir(dirname(outputPath), { recursive: true });
	await writeFile(outputPath, Buffer.from(image.data, "base64"));
	console.log(`Wrote ${image.mimeType} to ${outputPath}`);
}

async function writeText(path: string, text: string): Promise<void> {
	const outputPath = resolve(path);
	await mkdir(dirname(outputPath), { recursive: true });
	await writeFile(outputPath, text);
	console.log(`Wrote ${outputPath}`);
}

function screenshotPathFor(markdownPath: string): string {
	const outputPath = resolve(markdownPath);
	const extension = extname(outputPath);
	return extension ? `${outputPath.slice(0, -extension.length)}.png` : `${outputPath}.png`;
}

function escapeFence(text: string): string {
	return text.replaceAll("```", "``\\`");
}

function formatCaseMarkdown(result: CaseResult, screenshotPath?: string): string {
	const active = result.active;
	const page = result.page;
	const lines: string[] = [];

	lines.push("# Sitegeist Case");
	lines.push("");
	lines.push(`Captured at: ${result.capturedAt}`);
	if (active) {
		lines.push(`Active tab: ${active.title} (${active.id})`);
		lines.push(`Active URL: ${active.url}`);
	}
	if (page) {
		lines.push(`Page title: ${page.title}`);
		lines.push(`Page URL: ${page.url}`);
		if (page.language) lines.push(`Language: ${page.language}`);
	}
	if (screenshotPath) {
		lines.push(`Screenshot: ${screenshotPath}`);
	}

	if (page?.headings.length) {
		lines.push("");
		lines.push("## Headings");
		for (const heading of page.headings) {
			lines.push(`- H${heading.level}: ${heading.text}`);
		}
	}

	if (page?.landmarks.length) {
		lines.push("");
		lines.push("## Landmarks");
		for (const landmark of page.landmarks) {
			const role = landmark.role ? ` role=${landmark.role}` : "";
			lines.push(`- ${landmark.selector}${role}: ${landmark.text}`);
		}
	}

	if (page?.controls.length) {
		lines.push("");
		lines.push("## Controls");
		for (const control of page.controls) {
			const parts = [control.tag];
			if (control.type) parts.push(`type=${control.type}`);
			if (control.name) parts.push(`name=${control.name}`);
			const label = control.label || control.placeholder || control.text;
			lines.push(`- ${parts.join(" ")}${label ? `: ${label}` : ""}`);
		}
	}

	if (page?.links.length) {
		lines.push("");
		lines.push("## Links");
		for (const link of page.links) {
			lines.push(`- ${link.text}: ${link.href}`);
		}
	}

	if (page?.images.length) {
		lines.push("");
		lines.push("## Images");
		for (const image of page.images) {
			lines.push(`- ${image.alt || "(no alt)"}${image.src ? `: ${image.src}` : ""}`);
		}
	}

	if (result.console?.length) {
		lines.push("");
		lines.push("## Probe Console");
		for (const entry of result.console) {
			lines.push(`- ${entry.type || "log"}: ${entry.text}`);
		}
	}

	if (page?.visibleText) {
		lines.push("");
		lines.push("## Visible Text");
		lines.push("```text");
		lines.push(escapeFence(page.visibleText));
		lines.push("```");
	}

	lines.push("");
	return `${lines.join("\n")}\n`;
}

async function captureCase(bridgeUrl: string, includeScreenshot: boolean): Promise<CaseResult> {
	const active = (await sendCommand(bridgeUrl, "active")) as ActiveTabResult;
	const pageResponse = (await sendCommand(bridgeUrl, "eval", { code: PAGE_CASE_SCRIPT })) as BrowserEvalResult;
	const screenshot = includeScreenshot ? ((await sendCommand(bridgeUrl, "screenshot")) as ScreenshotResult).image : undefined;

	return {
		active: active.tab,
		page: pageResponse.result as PageCase,
		console: pageResponse.console || [],
		screenshot,
		capturedAt: new Date().toISOString(),
	};
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const command = args.shift();

	if (!command || command === "help" || command === "--help" || command === "-h") {
		printUsage();
	}

	if (command === "bridge") {
		const portValue = takeOption(args, "--port");
		const reviewCommand = takeOption(args, "--review-command") || process.env.SITEGEIST_REVIEW_COMMAND;
		const port = portValue ? Number.parseInt(portValue, 10) : undefined;
		if (portValue && !Number.isFinite(port)) {
			throw new Error("--port must be a number");
		}
		startBridge({ port, reviewCommand });
		return;
	}

	const bridgeUrl = bridgeUrlFromArgs(args);
	const outPath = takeOption(args, "--out");
	let result: unknown;

	if (command === "tabs" || command === "active") {
		result = await sendCommand(bridgeUrl, command);
	} else if (command === "navigate") {
		const url = args[0];
		if (!url) throw new Error("navigate requires a URL");
		result = await sendCommand(bridgeUrl, command, { url });
	} else if (command === "eval") {
		const code = args.join(" ");
		if (!code) throw new Error("eval requires JavaScript code");
		result = await sendCommand(bridgeUrl, command, { code });
	} else if (command === "click") {
		const selector = args[0];
		if (!selector) throw new Error("click requires a CSS selector");
		result = await sendCommand(bridgeUrl, "eval", { code: runtimeCall("nativeClick", [selector]) });
	} else if (command === "type") {
		const selector = args[0];
		const text = args.slice(1).join(" ");
		if (!selector) throw new Error("type requires a CSS selector");
		if (!text) throw new Error("type requires text");
		result = await sendCommand(bridgeUrl, "eval", { code: runtimeCall("nativeType", [selector, text]) });
	} else if (command === "press") {
		const key = args[0];
		if (!key) throw new Error("press requires a key name");
		result = await sendCommand(bridgeUrl, "eval", { code: runtimeCall("nativePress", [key]) });
	} else if (command === "key-down") {
		const key = args[0];
		if (!key) throw new Error("key-down requires a key name");
		result = await sendCommand(bridgeUrl, "eval", { code: runtimeCall("nativeKeyDown", [key]) });
	} else if (command === "key-up") {
		const key = args[0];
		if (!key) throw new Error("key-up requires a key name");
		result = await sendCommand(bridgeUrl, "eval", { code: runtimeCall("nativeKeyUp", [key]) });
	} else if (command === "screenshot") {
		result = await sendCommand(bridgeUrl, command);
		const image = (result as ScreenshotResult).image;
		if (outPath) {
			if (!image) throw new Error("Sitegeist did not return screenshot image data");
			await writeBase64(outPath, image);
			return;
		}
	} else if (command === "evidence") {
		result = await sendCommand(bridgeUrl, command);
		if (outPath) {
			await writeText(outPath, `${JSON.stringify(result as EvidenceResult, null, 2)}\n`);
			return;
		}
	} else if (command === "case") {
		result = await captureCase(bridgeUrl, !!outPath);
		if (outPath) {
			const caseResult = result as CaseResult;
			let screenshotPath: string | undefined;
			if (caseResult.screenshot) {
				screenshotPath = screenshotPathFor(outPath);
				await writeBase64(screenshotPath, caseResult.screenshot);
			}
			await writeText(outPath, formatCaseMarkdown(caseResult, screenshotPath));
			return;
		}
		console.log(formatCaseMarkdown(result as CaseResult));
		return;
	} else {
		printUsage(1);
	}

	console.log(stringify(result));
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
