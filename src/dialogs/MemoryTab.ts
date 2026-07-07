import "@mariozechner/mini-lit/dist/MarkdownBlock.js";
import { SettingsTab } from "@earendil-works/pi-web-ui";
import { icon } from "@mariozechner/mini-lit";
import { Badge } from "@mariozechner/mini-lit/dist/Badge.js";
import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { Input } from "@mariozechner/mini-lit/dist/Input.js";
import { html, type TemplateResult } from "lit";
import { Brain, Pencil, Plus, Trash2 } from "lucide";
import { Toast } from "../components/Toast.js";
import { getSitegeistStorage } from "../storage/app-storage.js";
import type { Memory } from "../storage/stores/memory-store.js";

interface Draft {
	id?: string;
	title: string;
	content: string;
	tags: string;
}

const EMPTY_DRAFT: Draft = { title: "", content: "", tags: "" };

export class MemoryTab extends SettingsTab {
	private memories: Memory[] = [];
	private filtered: Memory[] = [];
	private searchQuery = "";
	private draft: Draft | null = null;

	getTabName(): string {
		return "Memory";
	}

	async connectedCallback() {
		super.connectedCallback();
		await this.loadMemories();
	}

	async loadMemories() {
		this.memories = await getSitegeistStorage().memories.list();
		this.filter();
	}

	private filter() {
		const q = this.searchQuery.toLowerCase();
		this.filtered = q
			? this.memories.filter(
					(m) =>
						m.title.toLowerCase().includes(q) ||
						m.content.toLowerCase().includes(q) ||
						m.tags.some((t) => t.toLowerCase().includes(q)),
				)
			: this.memories;
		this.requestUpdate();
	}

	private onSearchInput(e: Event) {
		this.searchQuery = (e.target as HTMLInputElement).value;
		this.filter();
	}

	private startCreate() {
		this.draft = { ...EMPTY_DRAFT };
		this.requestUpdate();
	}

	private startEdit(m: Memory) {
		this.draft = { id: m.id, title: m.title, content: m.content, tags: m.tags.join(", ") };
		this.requestUpdate();
	}

	private cancelEdit() {
		this.draft = null;
		this.requestUpdate();
	}

	private updateDraft(field: keyof Draft, value: string) {
		if (!this.draft) return;
		this.draft = { ...this.draft, [field]: value };
		this.requestUpdate();
	}

	private async saveDraft() {
		if (!this.draft) return;
		const title = this.draft.title.trim();
		const content = this.draft.content.trim();
		if (!title || !content) {
			Toast.error("Title and content are required");
			return;
		}
		const tags = this.draft.tags
			.split(",")
			.map((t) => t.trim())
			.filter(Boolean);
		await getSitegeistStorage().memories.save({
			id: this.draft.id,
			title,
			content,
			tags,
			source: "user",
		});
		this.draft = null;
		await this.loadMemories();
		Toast.success("Memory saved");
	}

	private async deleteMemory(m: Memory) {
		if (!confirm(`Delete memory "${m.title}"?`)) return;
		await getSitegeistStorage().memories.delete(m.id);
		await this.loadMemories();
	}

	private renderEditor(): TemplateResult {
		const draft = this.draft;
		if (!draft) return html``;
		return html`
			<div class="rounded-lg border border-border bg-card p-4 flex flex-col gap-3">
				<div class="text-sm font-medium text-foreground">${draft.id ? "Edit memory" : "New memory"}</div>
				${Input({
					placeholder: "Title",
					value: draft.title,
					onInput: (e: Event) => this.updateDraft("title", (e.target as HTMLInputElement).value),
				})}
				<textarea
					class="min-h-24 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					placeholder="Content — the durable fact to remember"
					.value=${draft.content}
					@input=${(e: Event) => this.updateDraft("content", (e.target as HTMLTextAreaElement).value)}
				></textarea>
				${Input({
					placeholder: "Tags (comma-separated, optional)",
					value: draft.tags,
					onInput: (e: Event) => this.updateDraft("tags", (e.target as HTMLInputElement).value),
				})}
				<div class="flex items-center gap-2 justify-end">
					${Button({ variant: "ghost", size: "sm", onClick: () => this.cancelEdit(), children: "Cancel" })}
					${Button({ variant: "default", size: "sm", onClick: () => this.saveDraft(), children: "Save" })}
				</div>
			</div>
		`;
	}

	private renderMemory(m: Memory): TemplateResult {
		return html`
			<div class="rounded-lg border border-border bg-card p-3 flex flex-col gap-2">
				<div class="flex items-start gap-3">
					<span class="text-muted-foreground shrink-0 mt-0.5">${icon(Brain, "sm")}</span>
					<div class="flex-1 min-w-0">
						<div class="flex items-center gap-2 flex-wrap">
							<span class="text-sm font-medium text-foreground">${m.title}</span>
							${Badge(m.source === "user" ? "you" : "agent", "outline")}
						</div>
						<div class="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">${m.content}</div>
						${
							m.tags.length
								? html`<div class="flex flex-wrap gap-1 mt-2">${m.tags.map((t) => Badge(t, "secondary"))}</div>`
								: ""
						}
					</div>
					<div class="flex items-center gap-1 shrink-0">
						${Button({
							variant: "ghost",
							size: "sm",
							onClick: () => this.startEdit(m),
							title: "Edit",
							children: icon(Pencil, "sm"),
						})}
						${Button({
							variant: "ghost",
							size: "sm",
							onClick: () => this.deleteMemory(m),
							title: "Delete",
							children: icon(Trash2, "sm"),
						})}
					</div>
				</div>
			</div>
		`;
	}

	render(): TemplateResult {
		return html`
			<div class="flex flex-col gap-4">
				<div>
					<h3 class="text-sm font-semibold text-foreground mb-2">Memory</h3>
					<p class="text-sm text-muted-foreground">
						Durable facts the assistant remembers across sessions. It can add these itself, or you can here.
					</p>
				</div>

				<div class="flex items-center gap-2">
					<div class="flex-1">
						${Input({
							placeholder: "Search memories...",
							value: this.searchQuery,
							onInput: (e: Event) => this.onSearchInput(e),
						})}
					</div>
					${Button({
						variant: "default",
						size: "sm",
						onClick: () => this.startCreate(),
						children: html`<span class="inline-flex items-center gap-1">${icon(Plus, "sm")} Add</span>`,
					})}
				</div>

				${this.draft ? this.renderEditor() : ""}

				${
					this.filtered.length === 0
						? html`<div class="text-sm text-muted-foreground py-8 text-center">
								${this.memories.length === 0 ? "No memories yet." : "No memories match your search."}
							</div>`
						: html`<div class="flex flex-col gap-2">${this.filtered.map((m) => this.renderMemory(m))}</div>`
				}
			</div>
		`;
	}
}

if (!customElements.get("memory-tab")) {
	customElements.define("memory-tab", MemoryTab);
}
