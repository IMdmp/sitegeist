import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { TextContent, ToolResultMessage } from "@earendil-works/pi-ai";
import { type Static, Type } from "@earendil-works/pi-ai/base";
import {
	registerToolRenderer,
	renderHeader,
	type ToolRenderer,
	type ToolRenderResult,
} from "@earendil-works/pi-web-ui";
import { html } from "lit";
import { Cable } from "lucide";
import { capturePageCase, isLocalBridgeConnected, requestLocalAgentReview } from "../cli-bridge.js";

const LOCAL_AGENT_REVIEW_DESCRIPTION = `Ask a local Sitegeist bridge to investigate the current page against local workspace files, generated data, git state, or a coding harness.

Use this when the user wants to check local files, compare a prod or localhost page with the repo, diagnose site data issues, or hand browser evidence to a local coding agent.`;

const localAgentReviewSchema = Type.Object({
	problem: Type.String({
		description: "The concrete page issue or question for the local agent to investigate.",
	}),
	workspaceHint: Type.Optional(
		Type.String({
			description: "Optional repo, project, domain, or workspace hint for the local harness.",
		}),
	),
	includeScreenshot: Type.Optional(
		Type.Boolean({
			description: "Set true when a screenshot would materially help diagnose the issue.",
		}),
	),
});

type LocalAgentReviewParams = Static<typeof localAgentReviewSchema>;

type LocalAgentReviewDetails = {
	problem: string;
	workspaceHint?: string;
	adapter?: string;
	text: string;
};

function getRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function getString(record: Record<string, unknown> | undefined, key: string): string | undefined {
	const value = record?.[key];
	return typeof value === "string" ? value : undefined;
}

function formatLocalAgentResult(result: unknown): { adapter?: string; text: string } {
	if (typeof result === "string") {
		return { text: result };
	}

	const record = getRecord(result);
	const text = getString(record, "text");
	const adapter = getString(record, "adapter");
	if (text) {
		return { adapter, text };
	}

	return {
		adapter,
		text: JSON.stringify(result, null, 2),
	};
}

export class LocalAgentReviewTool implements AgentTool<typeof localAgentReviewSchema, LocalAgentReviewDetails> {
	name = "local_agent_review";
	label = "Local Agent Review";
	description = LOCAL_AGENT_REVIEW_DESCRIPTION;
	parameters = localAgentReviewSchema;
	windowId?: number;

	async execute(
		_toolCallId: string,
		params: unknown,
		signal?: AbortSignal,
	): Promise<AgentToolResult<LocalAgentReviewDetails>> {
		const args = params as LocalAgentReviewParams;
		const problem = args.problem?.trim();
		if (!problem) {
			throw new Error("local_agent_review requires a problem to investigate");
		}
		if (!this.windowId) {
			throw new Error("windowId not set on LocalAgentReviewTool");
		}
		if (!isLocalBridgeConnected()) {
			throw new Error("Local Sitegeist bridge is not connected. Start it with `sitegeist bridge` and try again.");
		}

		const evidence = await capturePageCase(!!args.includeScreenshot, this.windowId);
		const result = await requestLocalAgentReview(
			{
				problem,
				workspaceHint: args.workspaceHint,
				evidence,
			},
			signal,
		);
		const formatted = formatLocalAgentResult(result);
		const content: TextContent[] = [{ type: "text", text: formatted.text }];

		return {
			content,
			details: {
				problem,
				workspaceHint: args.workspaceHint,
				adapter: formatted.adapter,
				text: formatted.text,
			},
		};
	}
}

const localAgentReviewRenderer: ToolRenderer<LocalAgentReviewParams, LocalAgentReviewDetails> = {
	render(
		params: LocalAgentReviewParams | undefined,
		result: ToolResultMessage<LocalAgentReviewDetails> | undefined,
	): ToolRenderResult {
		const label = params?.workspaceHint ? `Local review: ${params.workspaceHint}` : "Local agent review";
		const state = result ? (result.isError ? "error" : "complete") : "inprogress";
		const details = result?.details;

		return {
			content: html`
				${renderHeader(state, Cable, label)}
				${details?.adapter ? html`<div class="px-3 pb-2 text-xs opacity-70">Adapter: ${details.adapter}</div>` : ""}
			`,
			isCustom: false,
		};
	},
};

export function registerLocalAgentReviewRenderer() {
	registerToolRenderer("local_agent_review", localAgentReviewRenderer);
}
