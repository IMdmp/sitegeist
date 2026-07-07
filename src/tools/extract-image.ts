import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ImageContent, TextContent, ToolResultMessage } from "@earendil-works/pi-ai";
import { type Static, Type } from "@earendil-works/pi-ai/base";
import {
	registerToolRenderer,
	renderHeader,
	type ToolRenderer,
	type ToolRenderResult,
} from "@earendil-works/pi-web-ui";
import { html } from "lit";
import { Image as ImageIcon } from "lucide";

const EXTRACT_IMAGE_DESCRIPTION = `Extract images from the current page. Returns image data that you can see and analyze.

Modes:
- selector: Extract the source image/canvas/background image matching a CSS selector (e.g. "img.hero", "#logo", "img:nth-child(2)")
- screenshot: Capture the visible area of the current tab
- fullpage: Scroll and stitch the current page into one screenshot, capped to the first 8000px of page height
- element: Capture the visible tab and crop to any element matching a CSS selector. Use this for non-image UI regions, charts, dialogs, cards, or text blocks.`;

const FULL_PAGE_MAX_HEIGHT = 8000;
const SCREENSHOT_SCROLL_DELAY_MS = 600;
const USER_SCRIPT_WORLD_ID = "sitegeist-extract-image";

const extractImageSchema = Type.Object({
	mode: Type.Union(
		[Type.Literal("selector"), Type.Literal("screenshot"), Type.Literal("fullpage"), Type.Literal("element")],
		{
			description:
				"How to extract: 'selector' for a source image/canvas/background, 'screenshot' for visible tab, 'fullpage' for stitched page screenshot, 'element' for a cropped visible element region",
		},
	),
	selector: Type.Optional(Type.String({ description: "CSS selector (required for 'selector' and 'element' modes)" })),
	maxWidth: Type.Optional(
		Type.Number({ description: "Max width to resize image to (default 800). Reduces token usage." }),
	),
});

type ExtractImageParams = Static<typeof extractImageSchema>;

interface ExtractImageDetails {
	mode: string;
	selector?: string;
}

interface ImageInfo {
	src: string;
	width: number;
	height: number;
}

interface PageMetrics {
	viewportWidth: number;
	viewportHeight: number;
	scrollWidth: number;
	scrollHeight: number;
	scrollX: number;
	scrollY: number;
}

interface ElementRect {
	x: number;
	y: number;
	width: number;
	height: number;
	viewportWidth: number;
	viewportHeight: number;
	tagName: string;
}

interface CropRect {
	sourceX: number;
	sourceY: number;
	sourceWidth: number;
	sourceHeight: number;
}

type PageScriptResult<T> = { success: true; value: T } | { success: false; error: string };

async function configureUserScriptWorld(): Promise<void> {
	try {
		await chrome.userScripts.configureWorld({
			worldId: USER_SCRIPT_WORLD_ID,
			messaging: true,
		});
	} catch {
		// Already configured
	}
}

async function executePageScript<T>(tabId: number, code: string): Promise<T> {
	await configureUserScriptWorld();

	const results = await chrome.userScripts.execute<PageScriptResult<T>>({
		js: [{ code }],
		target: { tabId, allFrames: false },
		world: "USER_SCRIPT",
		worldId: USER_SCRIPT_WORLD_ID,
		injectImmediately: true,
	});

	const injectionResult = results[0];
	if (!injectionResult) {
		throw new Error("Failed to execute script in page");
	}
	if ("error" in injectionResult) {
		throw new Error(injectionResult.error);
	}
	if (!injectionResult.result.success) {
		throw new Error(injectionResult.result.error);
	}

	return injectionResult.result.value;
}

/**
 * Get image info from the page via userScripts.
 * Only reads the src/currentSrc URL or data URL from the DOM.
 * Does NOT try to draw or fetch anything in page context.
 */
async function getImageInfoFromPage(tabId: number, selector: string): Promise<ImageInfo> {
	const code = `(async () => {
		const sel = ${JSON.stringify(selector)};
		const el = document.querySelector(sel);
		if (!el) return { success: false, error: 'No element found for selector: ' + sel };

		if (el instanceof HTMLImageElement) {
			if (!el.complete) {
				await new Promise((resolve, reject) => {
					el.onload = resolve;
					el.onerror = () => reject(new Error('Image failed to load'));
					setTimeout(() => reject(new Error('Image load timeout')), 10000);
				});
			}
			const src = el.currentSrc || el.src;
			if (!src) return { success: false, error: 'Image has no src' };
			return { success: true, value: { src, width: el.naturalWidth, height: el.naturalHeight } };
		}

		if (el instanceof HTMLCanvasElement) {
			try {
				const dataUrl = el.toDataURL('image/png');
				return { success: true, value: { src: dataUrl, width: el.width, height: el.height } };
			} catch (e) {
				return { success: false, error: 'Cannot read canvas: ' + e.message };
			}
		}

		// Check for background-image
		const bg = getComputedStyle(el).backgroundImage;
		if (bg && bg !== 'none') {
			const match = bg.match(/url\\(["']?(.+?)["']?\\)/);
			if (match) return { success: true, value: { src: match[1], width: 0, height: 0 } };
		}

		return { success: false, error: 'Element <' + el.tagName.toLowerCase() + '> is not an image, canvas, or element with background-image' };
	})()`;

	return executePageScript<ImageInfo>(tabId, code);
}

async function getPageMetrics(tabId: number): Promise<PageMetrics> {
	const code = `(() => {
		const doc = document.documentElement;
		const body = document.body;
		return {
			success: true,
			value: {
				viewportWidth: window.innerWidth,
				viewportHeight: window.innerHeight,
				scrollWidth: Math.max(doc?.scrollWidth || 0, body?.scrollWidth || 0, window.innerWidth),
				scrollHeight: Math.max(doc?.scrollHeight || 0, body?.scrollHeight || 0, window.innerHeight),
				scrollX: window.scrollX,
				scrollY: window.scrollY,
			},
		};
	})()`;

	return executePageScript<PageMetrics>(tabId, code);
}

async function scrollPageTo(tabId: number, x: number, y: number): Promise<{ scrollX: number; scrollY: number }> {
	const code = `(async () => {
		window.scrollTo(${JSON.stringify(x)}, ${JSON.stringify(y)});
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
		return { success: true, value: { scrollX: window.scrollX, scrollY: window.scrollY } };
	})()`;

	return executePageScript<{ scrollX: number; scrollY: number }>(tabId, code);
}

async function getElementRectFromPage(tabId: number, selector: string): Promise<ElementRect> {
	const code = `(() => {
		const sel = ${JSON.stringify(selector)};
		const el = document.querySelector(sel);
		if (!el) return { success: false, error: 'No element found for selector: ' + sel };
		const rect = el.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) {
			return { success: false, error: 'Element has no visible size: ' + sel };
		}
		return {
			success: true,
			value: {
				x: rect.x,
				y: rect.y,
				width: rect.width,
				height: rect.height,
				viewportWidth: window.innerWidth,
				viewportHeight: window.innerHeight,
				tagName: el.tagName.toLowerCase(),
			},
		};
	})()`;

	return executePageScript<ElementRect>(tabId, code);
}

/**
 * Fetch an image URL from the extension context (has host_permissions),
 * resize it, and return as base64 ImageContent.
 */
async function fetchAndResizeImage(src: string, maxWidth: number): Promise<ImageContent> {
	let blob: Blob;

	if (src.startsWith("data:")) {
		const response = await fetch(src);
		blob = await response.blob();
	} else {
		const response = await fetch(src);
		if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
		blob = await response.blob();
	}

	const img = await createImageBitmap(blob);
	const imageContent = await bitmapToImageContent(img, maxWidth);
	img.close();
	return imageContent;
}

async function canvasToImageContent(source: OffscreenCanvas, maxWidth: number): Promise<ImageContent> {
	let output = source;
	if (source.width > maxWidth) {
		const width = maxWidth;
		const height = Math.round(source.height * (maxWidth / source.width));
		output = new OffscreenCanvas(width, height);
		output.getContext("2d")!.drawImage(source, 0, 0, width, height);
	}

	const outBlob = await output.convertToBlob({ type: "image/png" });
	const reader = new FileReader();
	const base64 = await new Promise<string>((resolve) => {
		reader.onload = () => resolve((reader.result as string).split(",")[1]);
		reader.readAsDataURL(outBlob);
	});

	return { type: "image", data: base64, mimeType: "image/png" };
}

async function bitmapToImageContent(img: ImageBitmap, maxWidth: number): Promise<ImageContent> {
	let width = img.width;
	let height = img.height;

	if (width > maxWidth) {
		height = Math.round(height * (maxWidth / width));
		width = maxWidth;
	}

	const canvas = new OffscreenCanvas(width, height);
	canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
	return canvasToImageContent(canvas, maxWidth);
}

async function captureVisibleTabBitmap(windowId: number): Promise<ImageBitmap> {
	const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
	const response = await fetch(dataUrl);
	return createImageBitmap(await response.blob());
}

async function captureScreenshot(maxWidth: number, windowId: number): Promise<ImageContent> {
	const bitmap = await captureVisibleTabBitmap(windowId);
	const imageContent = await bitmapToImageContent(bitmap, maxWidth);
	bitmap.close();
	return imageContent;
}

export function buildFullPageScrollPositions(targetHeight: number, viewportHeight: number): number[] {
	if (targetHeight <= 0 || viewportHeight <= 0) {
		return [];
	}

	const positions: number[] = [];
	let y = 0;
	while (y + viewportHeight < targetHeight) {
		positions.push(y);
		y += viewportHeight;
	}
	positions.push(Math.max(0, targetHeight - viewportHeight));
	return [...new Set(positions)].sort((a, b) => a - b);
}

export function getVisibleElementCrop(rect: ElementRect, bitmapWidth: number, bitmapHeight: number): CropRect | null {
	if (rect.viewportWidth <= 0 || rect.viewportHeight <= 0 || bitmapWidth <= 0 || bitmapHeight <= 0) {
		return null;
	}

	const left = Math.max(0, rect.x);
	const top = Math.max(0, rect.y);
	const right = Math.min(rect.viewportWidth, rect.x + rect.width);
	const bottom = Math.min(rect.viewportHeight, rect.y + rect.height);

	if (right <= left || bottom <= top) {
		return null;
	}

	const scaleX = bitmapWidth / rect.viewportWidth;
	const scaleY = bitmapHeight / rect.viewportHeight;
	const sourceX = Math.max(0, Math.round(left * scaleX));
	const sourceY = Math.max(0, Math.round(top * scaleY));
	if (sourceX >= bitmapWidth || sourceY >= bitmapHeight) {
		return null;
	}

	return {
		sourceX,
		sourceY,
		sourceWidth: Math.max(1, Math.min(bitmapWidth - sourceX, Math.round((right - left) * scaleX))),
		sourceHeight: Math.max(1, Math.min(bitmapHeight - sourceY, Math.round((bottom - top) * scaleY))),
	};
}

async function waitAfterScroll(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, SCREENSHOT_SCROLL_DELAY_MS));
}

async function captureFullPage(
	maxWidth: number,
	windowId: number,
	tabId: number,
): Promise<{ image: ImageContent; height: number }> {
	const metrics = await getPageMetrics(tabId);
	const targetHeight = Math.min(metrics.scrollHeight, FULL_PAGE_MAX_HEIGHT);
	const positions = buildFullPageScrollPositions(targetHeight, metrics.viewportHeight);
	if (positions.length === 0) {
		throw new Error("Could not determine page dimensions for full-page capture");
	}

	const captures: Array<{ scrollY: number; bitmap: ImageBitmap }> = [];
	try {
		for (const y of positions) {
			const actualScroll = await scrollPageTo(tabId, metrics.scrollX, y);
			await waitAfterScroll();
			captures.push({ scrollY: actualScroll.scrollY, bitmap: await captureVisibleTabBitmap(windowId) });
		}
	} finally {
		await scrollPageTo(tabId, metrics.scrollX, metrics.scrollY);
	}

	const firstCapture = captures[0];
	if (!firstCapture) {
		throw new Error("Full-page capture did not produce any screenshots");
	}

	const scaleY = firstCapture.bitmap.height / metrics.viewportHeight;
	const stitched = new OffscreenCanvas(firstCapture.bitmap.width, Math.ceil(targetHeight * scaleY));
	const ctx = stitched.getContext("2d")!;
	let coveredUntil = 0;

	for (const capture of captures.sort((a, b) => a.scrollY - b.scrollY)) {
		const captureTop = capture.scrollY;
		const captureBottom = capture.scrollY + metrics.viewportHeight;
		const drawStart = Math.max(captureTop, coveredUntil);
		const drawEnd = Math.min(captureBottom, targetHeight);
		if (drawEnd <= drawStart) {
			capture.bitmap.close();
			continue;
		}

		const sourceY = Math.round((drawStart - captureTop) * scaleY);
		const sourceHeight = Math.round((drawEnd - drawStart) * scaleY);
		const destY = Math.round(drawStart * scaleY);
		ctx.drawImage(
			capture.bitmap,
			0,
			sourceY,
			capture.bitmap.width,
			sourceHeight,
			0,
			destY,
			capture.bitmap.width,
			sourceHeight,
		);
		coveredUntil = drawEnd;
		capture.bitmap.close();
	}

	return { image: await canvasToImageContent(stitched, maxWidth), height: targetHeight };
}

async function captureElementRegion(
	maxWidth: number,
	windowId: number,
	tabId: number,
	selector: string,
): Promise<{ image: ImageContent; rect: ElementRect }> {
	const rect = await getElementRectFromPage(tabId, selector);
	const bitmap = await captureVisibleTabBitmap(windowId);
	const crop = getVisibleElementCrop(rect, bitmap.width, bitmap.height);
	if (!crop) {
		bitmap.close();
		throw new Error(`Element "${selector}" is outside the visible viewport`);
	}

	const canvas = new OffscreenCanvas(crop.sourceWidth, crop.sourceHeight);
	canvas
		.getContext("2d")!
		.drawImage(
			bitmap,
			crop.sourceX,
			crop.sourceY,
			crop.sourceWidth,
			crop.sourceHeight,
			0,
			0,
			crop.sourceWidth,
			crop.sourceHeight,
		);
	bitmap.close();

	return { image: await canvasToImageContent(canvas, maxWidth), rect };
}

export class ExtractImageTool implements AgentTool<typeof extractImageSchema, ExtractImageDetails> {
	name = "extract_image";
	label = "Extract Image";
	description = EXTRACT_IMAGE_DESCRIPTION;
	parameters = extractImageSchema;
	windowId?: number;

	async execute(
		_toolCallId: string,
		params: unknown,
		_signal?: AbortSignal,
	): Promise<AgentToolResult<ExtractImageDetails>> {
		const args = params as ExtractImageParams;
		const maxWidth = args.maxWidth || 800;
		const content: (TextContent | ImageContent)[] = [];
		const details: ExtractImageDetails = { mode: args.mode, selector: args.selector };

		if (args.mode === "screenshot") {
			if (!this.windowId) throw new Error("windowId not set on ExtractImageTool");
			const image = await captureScreenshot(maxWidth, this.windowId);
			content.push(image);
			content.push({ type: "text", text: `Screenshot captured (max ${maxWidth}px width)` });
		} else if (args.mode === "fullpage") {
			if (!this.windowId) throw new Error("windowId not set on ExtractImageTool");
			const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
			if (!tab?.id) throw new Error("No active tab");

			const result = await captureFullPage(maxWidth, this.windowId, tab.id);
			content.push(result.image);
			content.push({
				type: "text",
				text: `Full-page screenshot captured (${result.height}px page height, max ${maxWidth}px width)`,
			});
		} else if (args.mode === "selector") {
			if (!args.selector) throw new Error("selector is required for 'selector' mode");
			const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
			if (!tab?.id) throw new Error("No active tab");

			const info = await getImageInfoFromPage(tab.id, args.selector);
			const image = await fetchAndResizeImage(info.src, maxWidth);
			content.push(image);
			content.push({
				type: "text",
				text: `Image extracted from "${args.selector}" (${info.width}x${info.height}, resized to max ${maxWidth}px)`,
			});
		} else if (args.mode === "element") {
			if (!this.windowId) throw new Error("windowId not set on ExtractImageTool");
			if (!args.selector) throw new Error("selector is required for 'element' mode");
			const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
			if (!tab?.id) throw new Error("No active tab");

			const result = await captureElementRegion(maxWidth, this.windowId, tab.id, args.selector);
			content.push(result.image);
			content.push({
				type: "text",
				text: `Element screenshot captured from "${args.selector}" (<${result.rect.tagName}>, ${Math.round(result.rect.width)}x${Math.round(result.rect.height)} CSS pixels, max ${maxWidth}px width)`,
			});
		}

		return { content, details };
	}
}

// Renderer
const extractImageRenderer: ToolRenderer<ExtractImageParams, ExtractImageDetails> = {
	render(
		params: ExtractImageParams | undefined,
		result: ToolResultMessage<ExtractImageDetails> | undefined,
	): ToolRenderResult {
		const mode = params?.mode || "unknown";
		const selector = params?.selector || "";
		const labels: Record<string, string> = {
			screenshot: "Screenshot",
			fullpage: "Full-page screenshot",
			element: `Element: ${selector}`,
			selector: `Image: ${selector}`,
		};
		const label = labels[mode] || "Image";
		const state = result ? (result.isError ? "error" : "complete") : "inprogress";

		const hasImage = result?.content?.some((c) => c.type === "image");

		return {
			content: html`
				${renderHeader(state, ImageIcon, label)}
				${
					hasImage
						? html`<div class="p-2">
							${result?.content
								?.filter((c) => c.type === "image")
								.map(
									(c) =>
										html`<img
											src="data:${(c as ImageContent).mimeType};base64,${(c as ImageContent).data}"
											class="max-w-full rounded"
										/>`,
								)}
						</div>`
						: ""
				}
			`,
			isCustom: false,
		};
	},
};

export function registerExtractImageRenderer() {
	registerToolRenderer("extract_image", extractImageRenderer);
}
