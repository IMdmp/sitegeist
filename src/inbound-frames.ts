import type { ImageContent } from "@earendil-works/pi-ai";

/**
 * Normalized frame vocabulary streamed over the local bridge for inbound
 * agent turns. Kept independent of pi AgentEvent shapes so bridge consumers
 * are insulated from runtime package churn.
 */
export type SitegeistTurnFrame =
	| { kind: "started"; sessionId: string }
	| { kind: "text"; delta: string }
	| { kind: "thinking"; delta: string }
	| { kind: "usage"; usage: TurnUsage }
	| { kind: "tool_call"; callId: string; tool: string; title: string; input: unknown }
	| {
			kind: "tool_result";
			callId: string;
			status: "ok" | "error";
			outputText?: string;
			image?: ImageContent;
			raw?: unknown;
	  };

export type TurnUsage = {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	totalCostUsd?: number;
};

export type AgentTurnCompletion = {
	status: "completed" | "failed" | "interrupted";
	finalText?: string;
	error?: string;
	usage?: TurnUsage;
	sessionId?: string;
};
