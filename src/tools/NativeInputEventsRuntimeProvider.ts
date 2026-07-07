import type { SandboxRuntimeProvider } from "@earendil-works/pi-web-ui";
import { NATIVE_INPUT_EVENTS_DESCRIPTION } from "../prompts/prompts.js";
import { computeDragPath, type NativeInputPoint } from "./native-input-math.js";

type NativeInputModifier = "Alt" | "Control" | "Meta" | "Shift";
type NativeMouseButton = "left" | "right" | "middle";
type CdpMouseButton = NativeMouseButton | "none";
type NativePointInput = { xPct: number; yPct: number } | { x: number; y: number };

interface NativeClickOptions {
	pos?: NativePointInput;
	clickCount?: number;
	button?: NativeMouseButton;
	modifiers?: NativeInputModifier[];
}

interface NativeDragOptions {
	steps?: number;
	stepDelayMs?: number;
	modifiers?: NativeInputModifier[];
}

interface NativeWheelOptions {
	modifiers?: NativeInputModifier[];
}

interface RuntimeEvaluationResult<T> {
	exceptionDetails?: {
		exception?: {
			description?: string;
		};
		text?: string;
	};
	result?: {
		value?: T;
	};
}

interface NativeMouseEventParams extends Record<string, unknown> {
	type: "mouseMoved" | "mousePressed" | "mouseReleased" | "mouseWheel";
	x: number;
	y: number;
	button?: CdpMouseButton;
	buttons?: number;
	clickCount?: number;
	deltaX?: number;
	deltaY?: number;
	modifiers?: number;
}

/**
 * Provides native input event functions to JavaScript REPL using Chrome Debugger API.
 * Dispatches REAL browser events (isTrusted: true) for automation of anti-bot sites.
 * Operates on the currently active tab.
 */
export class NativeInputEventsRuntimeProvider implements SandboxRuntimeProvider {
	private modifiers = 0; // Track currently pressed modifiers
	// Modifier bit flags for CDP
	private readonly MODIFIER_ALT = 1;
	private readonly MODIFIER_CTRL = 2;
	private readonly MODIFIER_META = 4;
	private readonly MODIFIER_SHIFT = 8;

	getData(): Record<string, any> {
		return {};
	}

	/**
	 * Get the currently active tab ID
	 */
	private async getActiveTabId(): Promise<number> {
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		if (!tab?.id) {
			throw new Error("No active tab found");
		}
		return tab.id;
	}

	private getKeyInfo(key: string): { key: string; code: string; keyCode: number } {
		// Key mapping: simple names -> CDP parameters
		// Supports standard key names that LLMs typically know
		const keyMap: Record<string, { key: string; code: string; keyCode: number }> = {
			// Arrow keys
			ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
			ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
			ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
			ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },

			// Navigation keys
			Enter: { key: "Enter", code: "Enter", keyCode: 13 },
			Tab: { key: "Tab", code: "Tab", keyCode: 9 },
			Escape: { key: "Escape", code: "Escape", keyCode: 27 },
			Backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
			Delete: { key: "Delete", code: "Delete", keyCode: 46 },
			Home: { key: "Home", code: "Home", keyCode: 36 },
			End: { key: "End", code: "End", keyCode: 35 },
			PageUp: { key: "PageUp", code: "PageUp", keyCode: 33 },
			PageDown: { key: "PageDown", code: "PageDown", keyCode: 34 },

			// Modifier keys
			Shift: { key: "Shift", code: "ShiftLeft", keyCode: 16 },
			Control: { key: "Control", code: "ControlLeft", keyCode: 17 },
			Alt: { key: "Alt", code: "AltLeft", keyCode: 18 },
			Meta: { key: "Meta", code: "MetaLeft", keyCode: 91 },

			// Function keys
			F1: { key: "F1", code: "F1", keyCode: 112 },
			F2: { key: "F2", code: "F2", keyCode: 113 },
			F3: { key: "F3", code: "F3", keyCode: 114 },
			F4: { key: "F4", code: "F4", keyCode: 115 },
			F5: { key: "F5", code: "F5", keyCode: 116 },
			F6: { key: "F6", code: "F6", keyCode: 117 },
			F7: { key: "F7", code: "F7", keyCode: 118 },
			F8: { key: "F8", code: "F8", keyCode: 119 },
			F9: { key: "F9", code: "F9", keyCode: 120 },
			F10: { key: "F10", code: "F10", keyCode: 121 },
			F11: { key: "F11", code: "F11", keyCode: 122 },
			F12: { key: "F12", code: "F12", keyCode: 123 },

			// Special keys
			Space: { key: " ", code: "Space", keyCode: 32 },
			Insert: { key: "Insert", code: "Insert", keyCode: 45 },
		};

		// Check if it's in the keyMap first
		const keyInfo = keyMap[key];
		if (keyInfo) {
			return keyInfo;
		}

		// For single character keys (a-z, A-Z, 0-9, etc.), generate the info
		if (key.length === 1) {
			const char = key;
			const upperChar = char.toUpperCase();
			const keyCode = upperChar.charCodeAt(0);

			// Letter keys (a-z, A-Z)
			if (/[a-zA-Z]/.test(char)) {
				return {
					key: char,
					code: `Key${upperChar}`,
					keyCode: keyCode,
				};
			}

			// Number keys (0-9)
			if (/[0-9]/.test(char)) {
				return {
					key: char,
					code: `Digit${char}`,
					keyCode: keyCode,
				};
			}

			// For other single characters, just use the character itself
			return {
				key: char,
				code: `Key${upperChar}`,
				keyCode: keyCode,
			};
		}

		throw new Error(
			`Unknown key name: ${key}. Supported keys: ${Object.keys(keyMap).join(", ")}, or any single character (a-z, 0-9, etc.)`,
		);
	}

	private getOptionsRecord(value: unknown, name: string): Record<string, unknown> {
		if (value === undefined || value === null) {
			return {};
		}
		if (typeof value !== "object" || Array.isArray(value)) {
			throw new Error(`${name} must be an object`);
		}
		return value as Record<string, unknown>;
	}

	private getPointInput(value: unknown, name: string): NativePointInput | undefined {
		if (value === undefined || value === null) {
			return undefined;
		}
		if (typeof value !== "object" || Array.isArray(value)) {
			throw new Error(`${name} must be a point object`);
		}

		const point = value as Record<string, unknown>;
		if (point.x !== undefined || point.y !== undefined) {
			if (
				typeof point.x !== "number" ||
				typeof point.y !== "number" ||
				!Number.isFinite(point.x) ||
				!Number.isFinite(point.y)
			) {
				throw new Error(`${name} with x/y requires finite viewport pixel numbers`);
			}
			return { x: point.x, y: point.y };
		}

		if (point.xPct !== undefined || point.yPct !== undefined) {
			if (
				typeof point.xPct !== "number" ||
				typeof point.yPct !== "number" ||
				!Number.isFinite(point.xPct) ||
				!Number.isFinite(point.yPct)
			) {
				throw new Error(`${name} with xPct/yPct requires finite numbers from 0 to 1`);
			}
			return { xPct: point.xPct, yPct: point.yPct };
		}

		throw new Error(`${name} must be either {xPct, yPct} or {x, y}`);
	}

	private getModifierList(value: unknown): NativeInputModifier[] | undefined {
		if (value === undefined || value === null) {
			return undefined;
		}
		if (!Array.isArray(value)) {
			throw new Error("options.modifiers must be an array");
		}

		return value.map((modifier) => {
			if (modifier === "Alt" || modifier === "Control" || modifier === "Meta" || modifier === "Shift") {
				return modifier;
			}
			throw new Error(`Unsupported modifier: ${String(modifier)}`);
		});
	}

	private getModifierMask(modifiers?: NativeInputModifier[]): number {
		let mask = this.modifiers;
		if (!modifiers) {
			return mask;
		}

		for (const modifier of modifiers) {
			if (modifier === "Alt") mask |= this.MODIFIER_ALT;
			if (modifier === "Control") mask |= this.MODIFIER_CTRL;
			if (modifier === "Meta") mask |= this.MODIFIER_META;
			if (modifier === "Shift") mask |= this.MODIFIER_SHIFT;
		}

		return mask;
	}

	private getMouseButton(value: unknown): NativeMouseButton | undefined {
		if (value === undefined || value === null) {
			return undefined;
		}
		if (value === "left" || value === "right" || value === "middle") {
			return value;
		}
		throw new Error(`Unsupported mouse button: ${String(value)}`);
	}

	private getButtonMask(button: NativeMouseButton): number {
		if (button === "left") return 1;
		if (button === "right") return 2;
		return 4;
	}

	private getPositiveInteger(value: unknown, defaultValue: number, name: string): number {
		if (value === undefined || value === null) {
			return defaultValue;
		}
		if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
			throw new Error(`${name} must be a positive number`);
		}
		return Math.trunc(value);
	}

	private getNonNegativeNumber(value: unknown, defaultValue: number, name: string): number {
		if (value === undefined || value === null) {
			return defaultValue;
		}
		if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
			throw new Error(`${name} must be a non-negative number`);
		}
		return value;
	}

	private getClickOptions(value: unknown): NativeClickOptions {
		const options = this.getOptionsRecord(value, "nativeClick options");
		return {
			pos: this.getPointInput(options.pos, "options.pos"),
			clickCount: this.getPositiveInteger(options.clickCount, 1, "options.clickCount"),
			button: this.getMouseButton(options.button) ?? "left",
			modifiers: this.getModifierList(options.modifiers),
		};
	}

	private getDragOptions(value: unknown): Required<NativeDragOptions> {
		const options = this.getOptionsRecord(value, "nativeDrag options");
		return {
			// A drag needs at least one interpolated move between press and
			// release; steps: 0 would collapse to a single press/release jump,
			// which the docs warn against and many brush-zoom plugins ignore.
			steps: this.getPositiveInteger(options.steps, 16, "options.steps"),
			stepDelayMs: this.getNonNegativeNumber(options.stepDelayMs, 15, "options.stepDelayMs"),
			modifiers: this.getModifierList(options.modifiers) ?? [],
		};
	}

	private getWheelOptions(value: unknown): NativeWheelOptions {
		const options = this.getOptionsRecord(value, "nativeWheel options");
		return {
			modifiers: this.getModifierList(options.modifiers),
		};
	}

	private getRuntimeErrorMessage<T>(result: RuntimeEvaluationResult<T>, fallback: string): string {
		return result.exceptionDetails?.exception?.description ?? result.exceptionDetails?.text ?? fallback;
	}

	private getRuntimeValue<T>(result: RuntimeEvaluationResult<T>, fallback: string): T {
		if (result.exceptionDetails) {
			throw new Error(this.getRuntimeErrorMessage(result, fallback));
		}

		const value = result.result?.value;
		if (value === undefined) {
			throw new Error(fallback);
		}

		return value;
	}

	private async resolvePoint(tabId: number, selector: string, point?: NativePointInput): Promise<NativeInputPoint> {
		const requestedPoint = point ?? { xPct: 0.5, yPct: 0.5 };
		const result = (await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
			expression: `(() => {
				const selector = ${JSON.stringify(selector)};
				const point = ${JSON.stringify(requestedPoint)};
				const el = document.querySelector(selector);
				if (!el) throw new Error("Selector not found: " + selector);
				if (el instanceof HTMLIFrameElement) {
					throw new Error("Native input target is an iframe; cross-origin iframe coordinate translation is out of scope");
				}
				const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
				if ("x" in point || "y" in point) {
					if (!isFiniteNumber(point.x) || !isFiniteNumber(point.y)) {
						throw new Error("Absolute point requires finite x/y viewport pixel numbers");
					}
					return { x: point.x, y: point.y };
				}
				if (!isFiniteNumber(point.xPct) || !isFiniteNumber(point.yPct) || point.xPct < 0 || point.xPct > 1 || point.yPct < 0 || point.yPct > 1) {
					throw new Error("Percentage point requires xPct/yPct numbers from 0 to 1");
				}
				const rect = el.getBoundingClientRect();
				return {
					x: rect.left + rect.width * point.xPct,
					y: rect.top + rect.height * point.yPct,
				};
			})()`,
			returnByValue: true,
		})) as RuntimeEvaluationResult<NativeInputPoint>;

		return this.getRuntimeValue(result, "Could not resolve native input coordinates");
	}

	private async dispatchMouseEvent(tabId: number, params: NativeMouseEventParams): Promise<void> {
		await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", params);
	}

	private async sleep(ms: number): Promise<void> {
		if (ms <= 0) {
			return;
		}
		await new Promise<void>((resolve) => setTimeout(resolve, ms));
	}

	getRuntime(): (sandboxId: string) => void {
		// This function will be stringified and injected into the user script
		return (_sandboxId: string) => {
			const sendRuntimeMessage = (window as any).sendRuntimeMessage;
			if (typeof sendRuntimeMessage !== "function") {
				throw new Error("sendRuntimeMessage is not available in this context");
			}

			(window as any).nativeClick = async (selector: string, options?: NativeClickOptions): Promise<void> => {
				await sendRuntimeMessage({
					type: "native-input",
					action: "click",
					selector,
					options,
				});
				// sendRuntimeMessage throws on error, so if we get here, it succeeded
			};

			(window as any).nativeDrag = async (
				selector: string,
				from: NativePointInput,
				to: NativePointInput,
				options?: NativeDragOptions,
			): Promise<void> => {
				await sendRuntimeMessage({
					type: "native-input",
					action: "drag",
					selector,
					from,
					to,
					options,
				});
			};

			(window as any).nativeHover = async (selector: string, pos?: NativePointInput): Promise<void> => {
				await sendRuntimeMessage({
					type: "native-input",
					action: "hover",
					selector,
					pos,
				});
			};

			(window as any).nativeWheel = async (
				selector: string,
				posOrDeltaY: NativePointInput | number | undefined,
				deltaYOrOptions?: number | NativeWheelOptions,
				options?: NativeWheelOptions,
			): Promise<void> => {
				let pos: NativePointInput | undefined;
				let deltaY: number | undefined;
				let wheelOptions: NativeWheelOptions | undefined;

				if (typeof posOrDeltaY === "number") {
					deltaY = posOrDeltaY;
					wheelOptions = deltaYOrOptions as NativeWheelOptions | undefined;
				} else {
					pos = posOrDeltaY;
					if (typeof deltaYOrOptions !== "number") {
						throw new Error("nativeWheel requires deltaY");
					}
					deltaY = deltaYOrOptions;
					wheelOptions = options;
				}

				await sendRuntimeMessage({
					type: "native-input",
					action: "wheel",
					selector,
					pos,
					deltaY,
					options: wheelOptions,
				});
			};

			(window as any).nativeType = async (selector: string, text: string): Promise<void> => {
				await sendRuntimeMessage({
					type: "native-input",
					action: "type",
					selector,
					text,
				});
			};

			(window as any).nativePress = async (key: string): Promise<void> => {
				await sendRuntimeMessage({
					type: "native-input",
					action: "press",
					key,
				});
			};

			(window as any).nativeKeyDown = async (key: string): Promise<void> => {
				await sendRuntimeMessage({
					type: "native-input",
					action: "keyDown",
					key,
				});
			};

			(window as any).nativeKeyUp = async (key: string): Promise<void> => {
				await sendRuntimeMessage({
					type: "native-input",
					action: "keyUp",
					key,
				});
			};
		};
	}

	async handleMessage(message: any, respond: (response: any) => void): Promise<void> {
		if (message.type !== "native-input") {
			return;
		}

		console.log("[NativeInput] Received event:", message.action, message);

		// Get active tab ID once at the start
		const tabId = await this.getActiveTabId();

		try {
			// Attach debugger to tab
			await new Promise<void>((resolve, reject) => {
				chrome.debugger.attach({ tabId }, "1.3", () => {
					if (chrome.runtime.lastError) {
						// Check if already attached
						if (chrome.runtime.lastError.message?.includes("already attached")) {
							console.log("[NativeInput] Debugger already attached (OK)");
							resolve(); // Already attached is fine
						} else {
							console.error("[NativeInput] Debugger attach failed:", chrome.runtime.lastError.message);
							reject(new Error(chrome.runtime.lastError.message));
						}
					} else {
						console.log("[NativeInput] Debugger attached successfully");
						resolve();
					}
				});
			});

			if (message.action === "click") {
				const options = this.getClickOptions(message.options);
				const { x, y } = await this.resolvePoint(tabId, message.selector, options.pos);
				const button = options.button ?? "left";
				const clickCount = options.clickCount ?? 1;
				const modifiers = this.getModifierMask(options.modifiers);
				console.log("[NativeInput] Clicking at coordinates:", { x, y, button, clickCount, modifiers });

				await this.dispatchMouseEvent(tabId, {
					type: "mousePressed",
					x,
					y,
					button,
					buttons: this.getButtonMask(button),
					clickCount,
					modifiers,
				});
				await this.dispatchMouseEvent(tabId, {
					type: "mouseReleased",
					x,
					y,
					button,
					buttons: 0,
					clickCount,
					modifiers,
				});

				console.log("[NativeInput] Click completed successfully");
				respond({ success: true });
			} else if (message.action === "drag") {
				const from = this.getPointInput(message.from, "from");
				const to = this.getPointInput(message.to, "to");
				if (!from || !to) {
					throw new Error("nativeDrag requires from and to points");
				}
				const options = this.getDragOptions(message.options);
				const fromPx = await this.resolvePoint(tabId, message.selector, from);
				const toPx = await this.resolvePoint(tabId, message.selector, to);
				const path = computeDragPath(fromPx, toPx, options.steps);
				const modifiers = this.getModifierMask(options.modifiers);

				console.log("[NativeInput] Dragging:", {
					fromPx,
					toPx,
					steps: options.steps,
					stepDelayMs: options.stepDelayMs,
					modifiers,
				});

				await this.dispatchMouseEvent(tabId, {
					type: "mouseMoved",
					x: fromPx.x,
					y: fromPx.y,
					button: "none",
					buttons: 0,
					modifiers,
				});
				await this.dispatchMouseEvent(tabId, {
					type: "mousePressed",
					x: fromPx.x,
					y: fromPx.y,
					button: "left",
					buttons: 1,
					clickCount: 1,
					modifiers,
				});

				for (const point of path.slice(1, -1)) {
					await this.dispatchMouseEvent(tabId, {
						type: "mouseMoved",
						x: point.x,
						y: point.y,
						button: "left",
						buttons: 1,
						modifiers,
					});
					await this.sleep(options.stepDelayMs);
				}

				await this.dispatchMouseEvent(tabId, {
					type: "mouseReleased",
					x: toPx.x,
					y: toPx.y,
					button: "left",
					buttons: 0,
					clickCount: 1,
					modifiers,
				});

				console.log("[NativeInput] Drag completed successfully");
				respond({ success: true });
			} else if (message.action === "hover") {
				const pos = this.getPointInput(message.pos, "pos");
				const { x, y } = await this.resolvePoint(tabId, message.selector, pos);

				console.log("[NativeInput] Hovering at coordinates:", { x, y });
				await this.dispatchMouseEvent(tabId, {
					type: "mouseMoved",
					x,
					y,
					button: "none",
					buttons: 0,
					modifiers: this.modifiers,
				});

				console.log("[NativeInput] Hover completed successfully");
				respond({ success: true });
			} else if (message.action === "wheel") {
				if (typeof message.deltaY !== "number" || !Number.isFinite(message.deltaY)) {
					throw new Error("nativeWheel requires finite deltaY");
				}
				const pos = this.getPointInput(message.pos, "pos");
				const options = this.getWheelOptions(message.options);
				const { x, y } = await this.resolvePoint(tabId, message.selector, pos);
				const modifiers = this.getModifierMask(options.modifiers);

				console.log("[NativeInput] Wheeling at coordinates:", { x, y, deltaY: message.deltaY, modifiers });
				await this.dispatchMouseEvent(tabId, {
					type: "mouseWheel",
					x,
					y,
					button: "none",
					buttons: 0,
					deltaX: 0,
					deltaY: message.deltaY,
					modifiers,
				});

				console.log("[NativeInput] Wheel completed successfully");
				respond({ success: true });
			} else if (message.action === "type") {
				console.log("[NativeInput] Typing text:", message.text, "into:", message.selector);

				// Focus element first
				const focusResult = (await chrome.debugger.sendCommand({ tabId: tabId }, "Runtime.evaluate", {
					expression: `(() => {
							const el = document.querySelector(${JSON.stringify(message.selector)});
							if (!el) throw new Error('Selector not found: ${message.selector}');
							el.focus();
							return true;
						})()`,
					returnByValue: true,
				})) as any;

				console.log("[NativeInput] Focus result:", focusResult);

				if (focusResult?.exceptionDetails) {
					console.error("[NativeInput] Element not found for typing:", focusResult.exceptionDetails);
					throw new Error(focusResult.exceptionDetails.exception.description || "Element not found");
				}

				// Type each character
				for (const char of message.text) {
					await chrome.debugger.sendCommand({ tabId: tabId }, "Input.dispatchKeyEvent", {
						type: "keyDown",
						text: char,
					});

					await chrome.debugger.sendCommand({ tabId: tabId }, "Input.dispatchKeyEvent", {
						type: "keyUp",
						text: char,
					});
				}

				console.log("[NativeInput] Typing completed successfully");
				respond({ success: true });
			} else if (message.action === "press") {
				console.log("[NativeInput] Pressing key:", message.key);

				const keyInfo = this.getKeyInfo(message.key);

				// Press single key with proper CDP parameters
				const keyDownResult = await chrome.debugger.sendCommand({ tabId: tabId }, "Input.dispatchKeyEvent", {
					type: "keyDown",
					key: keyInfo.key,
					code: keyInfo.code,
					windowsVirtualKeyCode: keyInfo.keyCode,
					nativeVirtualKeyCode: keyInfo.keyCode,
				});
				console.log("[NativeInput] Key down result:", keyDownResult);

				const keyUpResult = await chrome.debugger.sendCommand({ tabId: tabId }, "Input.dispatchKeyEvent", {
					type: "keyUp",
					key: keyInfo.key,
					code: keyInfo.code,
					windowsVirtualKeyCode: keyInfo.keyCode,
					nativeVirtualKeyCode: keyInfo.keyCode,
				});
				console.log("[NativeInput] Key up result:", keyUpResult);

				console.log("[NativeInput] Key press completed successfully");
				respond({ success: true });
			} else if (message.action === "keyDown") {
				console.log("[NativeInput] Key down:", message.key);

				const keyInfo = this.getKeyInfo(message.key);

				// Update modifier state
				if (message.key === "Alt") this.modifiers |= this.MODIFIER_ALT;
				if (message.key === "Control") this.modifiers |= this.MODIFIER_CTRL;
				if (message.key === "Meta") this.modifiers |= this.MODIFIER_META;
				if (message.key === "Shift") this.modifiers |= this.MODIFIER_SHIFT;

				const keyDownResult = await chrome.debugger.sendCommand({ tabId: tabId }, "Input.dispatchKeyEvent", {
					type: "keyDown",
					key: keyInfo.key,
					code: keyInfo.code,
					windowsVirtualKeyCode: keyInfo.keyCode,
					nativeVirtualKeyCode: keyInfo.keyCode,
					modifiers: this.modifiers,
				});
				console.log("[NativeInput] Key down result:", keyDownResult, "modifiers:", this.modifiers);

				console.log("[NativeInput] Key down completed successfully");
				respond({ success: true });
			} else if (message.action === "keyUp") {
				console.log("[NativeInput] Key up:", message.key);

				const keyInfo = this.getKeyInfo(message.key);

				const keyUpResult = await chrome.debugger.sendCommand({ tabId: tabId }, "Input.dispatchKeyEvent", {
					type: "keyUp",
					key: keyInfo.key,
					code: keyInfo.code,
					windowsVirtualKeyCode: keyInfo.keyCode,
					nativeVirtualKeyCode: keyInfo.keyCode,
					modifiers: this.modifiers,
				});
				console.log("[NativeInput] Key up result:", keyUpResult, "modifiers:", this.modifiers);

				// Update modifier state after keyUp
				if (message.key === "Alt") this.modifiers &= ~this.MODIFIER_ALT;
				if (message.key === "Control") this.modifiers &= ~this.MODIFIER_CTRL;
				if (message.key === "Meta") this.modifiers &= ~this.MODIFIER_META;
				if (message.key === "Shift") this.modifiers &= ~this.MODIFIER_SHIFT;

				console.log("[NativeInput] Key up completed successfully");
				respond({ success: true });
			} else {
				console.error("[NativeInput] Unknown action:", message.action);
				respond({ success: false, error: `Unknown action: ${message.action}` });
			}
		} catch (error: any) {
			console.error("[NativeInput] Error during operation:", error);
			respond({ success: false, error: error.message || String(error) });
		} finally {
			// Detach debugger to remove the banner
			try {
				await chrome.debugger.detach({ tabId });
				console.log("[NativeInput] Debugger detached successfully");
			} catch (detachError: any) {
				// Ignore errors if already detached or tab closed
				if (!detachError.message?.includes("not attached")) {
					console.warn("[NativeInput] Detach warning:", detachError.message);
				}
			}
		}
	}

	getDescription(): string {
		return NATIVE_INPUT_EVENTS_DESCRIPTION;
	}
}
