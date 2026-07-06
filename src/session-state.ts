import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ImageContent, TextContent, ThinkingContent, UserMessage } from "@earendil-works/pi-ai";
import type { UserMessageWithAttachments } from "@earendil-works/pi-web-ui";

type PersistableUserMessage = UserMessage | UserMessageWithAttachments;

function isTextContent(content: TextContent | ImageContent): content is TextContent {
	return content.type === "text";
}

function isAssistantPreviewContent(
	content: AssistantMessage["content"][number],
): content is TextContent | ThinkingContent {
	return content.type === "text" || content.type === "thinking";
}

export function isUserConversationMessage(message: AgentMessage): message is PersistableUserMessage {
	return message.role === "user" || message.role === "user-with-attachments";
}

export function shouldSaveSession(messages: AgentMessage[]): boolean {
	return messages.some(isUserConversationMessage);
}

function getUserMessageText(message: PersistableUserMessage): string {
	const { content } = message;
	if (typeof content === "string") return content;
	return content
		.filter(isTextContent)
		.map((item) => item.text)
		.join(" ");
}

function getAssistantMessageText(message: AssistantMessage): string {
	return message.content
		.filter(isAssistantPreviewContent)
		.map((item) => (item.type === "text" ? item.text : item.thinking))
		.join("\n");
}

export function generateSessionTitle(messages: AgentMessage[]): string {
	const firstUserMsg = messages.find(isUserConversationMessage);
	if (!firstUserMsg) return "";

	const text = getUserMessageText(firstUserMsg).trim();
	if (!text) return "";

	const sentenceEnd = text.search(/[.!?]/);
	if (sentenceEnd > 0 && sentenceEnd <= 50) {
		return text.substring(0, sentenceEnd + 1);
	}
	return text.length <= 50 ? text : `${text.substring(0, 47)}...`;
}

export function buildSessionPreview(messages: AgentMessage[], maxLength = 2048): string {
	let preview = "";
	for (const msg of messages) {
		if (preview.length >= maxLength) break;

		const text = isUserConversationMessage(msg)
			? getUserMessageText(msg)
			: msg.role === "assistant"
				? getAssistantMessageText(msg)
				: "";

		if (text) {
			preview += `${text}\n`;
		}
	}
	return preview.substring(0, maxLength);
}
