import "@mariozechner/mini-lit/dist/MarkdownBlock.js";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { type Static, Type } from "@earendil-works/pi-ai/base";
import {
	registerToolRenderer,
	renderHeader,
	type ToolRenderer,
	type ToolRenderResult,
} from "@earendil-works/pi-web-ui";
import { icon } from "@mariozechner/mini-lit";
import { html } from "lit";
import { Brain } from "lucide";
import { MEMORY_TOOL_DESCRIPTION } from "../prompts/prompts.js";
import { getSitegeistStorage } from "../storage/app-storage.js";
import type { Memory } from "../storage/stores/memory-store.js";

const getMemories = () => getSitegeistStorage().memories;

function stringEnum<const T extends readonly string[]>(values: T, options?: Parameters<typeof Type.String>[0]) {
	return Type.Unsafe<T[number]>({ type: "string", enum: [...values], ...options });
}

// IMPORTANT: Use stringEnum for Google API compatibility (NOT Type.Union!)
const memoryParamsSchema = Type.Object({
	action: stringEnum(["save", "get", "list", "search", "delete"], {
		description: "Action to perform",
	}),
	id: Type.Optional(Type.String({ description: "Memory id (required for get/delete; pass to save to update)" })),
	title: Type.Optional(Type.String({ description: "Short title (required for save)" })),
	content: Type.Optional(Type.String({ description: "Full memory content (required for save)" })),
	tags: Type.Optional(Type.Array(Type.String(), { description: "Optional tags" })),
	query: Type.Optional(Type.String({ description: "Search query (for search action)" })),
});

type MemoryParams = Static<typeof memoryParamsSchema>;

function formatMemoryLine(m: Memory): string {
	return `[${m.id}] ${m.title}`;
}

export const memoryTool: AgentTool<typeof memoryParamsSchema, any> = {
	label: "Memory",
	name: "memory",
	description: MEMORY_TOOL_DESCRIPTION,
	parameters: memoryParamsSchema,
	execute: async (_toolCallId: string, args: MemoryParams) => {
		const memories = getMemories();

		switch (args.action) {
			case "save": {
				if (!args.title || !args.content) {
					throw new Error("Missing 'title' or 'content' parameter for save.");
				}
				const saved = await memories.save({
					id: args.id,
					title: args.title,
					content: args.content,
					tags: args.tags,
					source: "agent",
				});
				return {
					content: [{ type: "text", text: `Memory saved: [${saved.id}] ${saved.title}` }],
					details: saved,
				};
			}

			case "get": {
				if (!args.id) throw new Error("Missing 'id' parameter for get.");
				const memory = await memories.get(args.id);
				if (!memory) throw new Error(`Memory '${args.id}' not found.`);
				return {
					content: [{ type: "text", text: `${memory.title}\n\n${memory.content}` }],
					details: memory,
				};
			}

			case "list": {
				const all = await memories.list();
				if (all.length === 0) {
					return { content: [{ type: "text", text: "No memories saved." }], details: { memories: [] } };
				}
				const text = all.map((m) => `${formatMemoryLine(m)}: ${m.content}`).join("\n");
				return { content: [{ type: "text", text }], details: { memories: all } };
			}

			case "search": {
				if (!args.query) throw new Error("Missing 'query' parameter for search.");
				const results = await memories.search(args.query);
				if (results.length === 0) {
					return { content: [{ type: "text", text: "No matching memories." }], details: { memories: [] } };
				}
				const text = results.map((m) => `${formatMemoryLine(m)}: ${m.content}`).join("\n");
				return { content: [{ type: "text", text }], details: { memories: results } };
			}

			case "delete": {
				if (!args.id) throw new Error("Missing 'id' parameter for delete.");
				const existing = await memories.get(args.id);
				if (!existing) {
					return { content: [{ type: "text", text: `Memory '${args.id}' not found.` }], details: {} };
				}
				await memories.delete(args.id);
				return { content: [{ type: "text", text: `Memory deleted: ${existing.title}` }], details: { id: args.id } };
			}

			default:
				throw new Error(`Unknown action: ${(args as any).action}`);
		}
	},
};

interface MemoryResultDetails {
	id?: string;
	title?: string;
	content?: string;
	memories?: Memory[];
}

export const memoryRenderer: ToolRenderer<MemoryParams, MemoryResultDetails> = {
	render(
		params: MemoryParams | undefined,
		result: ToolResultMessage<MemoryResultDetails> | undefined,
	): ToolRenderResult {
		const state = result ? (result.isError ? "error" : "complete") : "inprogress";
		const action = params?.action;

		const labels: Record<string, string> = {
			save: "Saving memory",
			get: "Reading memory",
			list: "Listing memories",
			search: "Searching memories",
			delete: "Deleting memory",
		};

		if (result?.isError) {
			return {
				content: html`
					<div class="space-y-2">
						${renderHeader(state, Brain, labels[action ?? ""] || action || "")}
						<div class="text-sm text-destructive">${result.content.find((c) => c.type === "text")?.text || ""}</div>
					</div>
				`,
				isCustom: false,
			};
		}

		const details = result?.details;
		const statusIcon = html`<span class="inline-block text-green-600 dark:text-green-500">${icon(Brain, "sm")}</span>`;

		if (result && details) {
			if (action === "list" || action === "search") {
				const list = details.memories ?? [];
				return {
					content: html`
						<div class="space-y-2">
							<div class="flex items-center gap-2 text-sm text-muted-foreground">
								${statusIcon}
								<span>${action === "search" ? "Matching memories" : "Saved memories"} (${list.length})</span>
							</div>
							<div class="flex flex-col gap-1">
								${list.map(
									(m) =>
										html`<div class="text-sm text-foreground"><span class="font-medium">${m.title}</span></div>`,
								)}
							</div>
						</div>
					`,
					isCustom: false,
				};
			}

			const title = details.title;
			const verb = action === "delete" ? "Deleted memory" : action === "save" ? "Saved memory" : "Memory";
			return {
				content: html`
					<div class="flex items-center gap-2 text-sm text-muted-foreground">
						${statusIcon}
						<span>${verb}${title ? html`: <span class="text-foreground font-medium">${title}</span>` : ""}</span>
					</div>
				`,
				isCustom: false,
			};
		}

		return { content: renderHeader(state, Brain, labels[action ?? ""] || "Memory"), isCustom: false };
	},
};

registerToolRenderer(memoryTool.name, memoryRenderer);
