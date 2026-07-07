import type { SandboxRuntimeProvider } from "@earendil-works/pi-web-ui";
import { CHART_HELPERS_RUNTIME_PROVIDER_DESCRIPTION } from "../../prompts/prompts.js";

interface ChartXAxisTick {
	label: string;
	xPct: number;
}

interface ChartYAxisTick {
	label: string;
	yPct: number;
}

interface ChartTicksResult {
	xTicks: ChartXAxisTick[];
	yTicks: ChartYAxisTick[];
}

/**
 * Provides DOM chart helpers to JavaScript REPL and browserjs page scripts.
 */
export class ChartHelpersRuntimeProvider implements SandboxRuntimeProvider {
	getData(): Record<string, never> {
		return {};
	}

	getRuntime(): (sandboxId: string) => void {
		return (_sandboxId: string) => {
			const helpersWindow = window as Window & {
				chartTicks?: (selector: string) => ChartTicksResult;
			};

			helpersWindow.chartTicks = (selector: string): ChartTicksResult => {
				const emptyResult = (): ChartTicksResult => ({ xTicks: [], yTicks: [] });

				try {
					const root = document.querySelector(selector);
					if (!root) {
						return emptyResult();
					}

					const rootRect = root.getBoundingClientRect();
					if (rootRect.width <= 0 || rootRect.height <= 0) {
						return emptyResult();
					}

					const textElements = Array.from(root.querySelectorAll("text")).filter(
						(element) => element.namespaceURI === "http://www.w3.org/2000/svg",
					);
					if (textElements.length === 0) {
						return emptyResult();
					}

					const maxTicks = 50;
					const xTicks: ChartXAxisTick[] = [];
					const yTicks: ChartYAxisTick[] = [];
					const normalizeLabel = (label: string | null): string => label?.replace(/\s+/g, " ").trim() ?? "";
					const clampPct = (value: number): number => Math.min(1, Math.max(0, value));

					for (const textElement of textElements) {
						const label = normalizeLabel(textElement.textContent);
						if (!label) {
							continue;
						}

						const textRect = textElement.getBoundingClientRect();
						if (textRect.width <= 0 || textRect.height <= 0) {
							continue;
						}

						const centerX = textRect.left + textRect.width / 2;
						const centerY = textRect.top + textRect.height / 2;
						const rawXPct = (centerX - rootRect.left) / rootRect.width;
						const rawYPct = (centerY - rootRect.top) / rootRect.height;
						if (rawXPct < -0.05 || rawXPct > 1.05 || rawYPct < -0.05 || rawYPct > 1.05) {
							continue;
						}

						const xPct = clampPct(rawXPct);
						const yPct = clampPct(rawYPct);
						if (yPct >= 0.8) {
							xTicks.push({ label, xPct });
						}
						if (xPct <= 0.2) {
							yTicks.push({ label, yPct });
						}
					}

					return {
						xTicks: [...xTicks].sort((a, b) => a.xPct - b.xPct).slice(0, maxTicks),
						yTicks: [...yTicks].sort((a, b) => a.yPct - b.yPct).slice(0, maxTicks),
					};
				} catch {
					return emptyResult();
				}
			};
		};
	}

	getDescription(): string {
		return CHART_HELPERS_RUNTIME_PROVIDER_DESCRIPTION;
	}
}
