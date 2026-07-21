import "@mariozechner/mini-lit/dist/MarkdownBlock.js";
import { SettingsTab } from "@earendil-works/pi-web-ui";
import { icon } from "@mariozechner/mini-lit";
import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { Input } from "@mariozechner/mini-lit/dist/Input.js";
import { html, type TemplateResult } from "lit";
import { Download, FileText, Pin, PinOff, Trash2 } from "lucide";
import { Toast } from "../components/Toast.js";
import { getSitegeistStorage } from "../storage/app-storage.js";
import type { SavedArtifact } from "../storage/stores/artifacts-store.js";

const TEXT_PREVIEW_EXTENSIONS = new Set([
	"md",
	"markdown",
	"txt",
	"json",
	"csv",
	"tsv",
	"html",
	"svg",
	"js",
	"ts",
	"xml",
]);

export class ArtifactsTab extends SettingsTab {
	private artifacts: SavedArtifact[] = [];
	private filtered: SavedArtifact[] = [];
	private searchQuery = "";
	private expandedKey: string | null = null;

	getTabName(): string {
		return "Artifacts";
	}

	async connectedCallback() {
		super.connectedCallback();
		await this.loadArtifacts();
	}

	private keyOf(a: SavedArtifact): string {
		return `${a.sessionId}::${a.filename}`;
	}

	private extensionOf(filename: string): string {
		const idx = filename.lastIndexOf(".");
		return idx >= 0 ? filename.slice(idx + 1).toLowerCase() : "";
	}

	async loadArtifacts() {
		this.artifacts = await getSitegeistStorage().artifacts.list();
		// Pinned first, then most recently updated.
		this.artifacts.sort((a, b) => {
			if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
			return b.updatedAt.localeCompare(a.updatedAt);
		});
		this.filter();
	}

	private filter() {
		const q = this.searchQuery.toLowerCase();
		this.filtered = q
			? this.artifacts.filter(
					(a) =>
						a.filename.toLowerCase().includes(q) ||
						(a.sessionTitle ?? "").toLowerCase().includes(q) ||
						a.content.toLowerCase().includes(q),
				)
			: this.artifacts;
		this.requestUpdate();
	}

	private onSearchInput(e: Event) {
		this.searchQuery = (e.target as HTMLInputElement).value;
		this.filter();
	}

	private async togglePin(a: SavedArtifact) {
		await getSitegeistStorage().artifacts.setPinned(a.sessionId, a.filename, !a.pinned);
		await this.loadArtifacts();
	}

	private async deleteArtifact(a: SavedArtifact) {
		if (!confirm(`Delete artifact "${a.filename}"?`)) return;
		await getSitegeistStorage().artifacts.delete(a.sessionId, a.filename);
		await this.loadArtifacts();
	}

	private async clearUnpinned() {
		const unpinned = this.artifacts.filter((a) => !a.pinned).length;
		if (unpinned === 0) return;
		if (!confirm(`Delete ${unpinned} unpinned artifact(s)? Pinned artifacts are kept.`)) return;
		await getSitegeistStorage().artifacts.clearUnpinned();
		await this.loadArtifacts();
		Toast.success("Cleared unpinned artifacts");
	}

	private download(a: SavedArtifact) {
		const blob = new Blob([a.content], { type: "text/plain" });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = a.filename;
		link.click();
		URL.revokeObjectURL(url);
	}

	private toggleExpand(a: SavedArtifact) {
		const key = this.keyOf(a);
		this.expandedKey = this.expandedKey === key ? null : key;
		this.requestUpdate();
	}

	private renderPreview(a: SavedArtifact): TemplateResult | "" {
		const ext = this.extensionOf(a.filename);
		if (ext === "md" || ext === "markdown") {
			return html`<div class="mt-3 p-3 rounded border border-border bg-muted/30"><markdown-block .content=${a.content}></markdown-block></div>`;
		}
		if (TEXT_PREVIEW_EXTENSIONS.has(ext)) {
			return html`<pre class="mt-3 p-3 rounded border border-border bg-muted/30 text-xs overflow-x-auto whitespace-pre-wrap">${a.content.slice(0, 4000)}</pre>`;
		}
		return html`<div class="mt-3 text-xs text-muted-foreground">No inline preview for .${ext} — use Download.</div>`;
	}

	private renderArtifact(a: SavedArtifact): TemplateResult {
		const key = this.keyOf(a);
		const expanded = this.expandedKey === key;
		return html`
			<div class="rounded-lg border border-border bg-card p-3">
				<div class="flex items-center gap-3">
					<span class="text-muted-foreground shrink-0">${icon(FileText, "sm")}</span>
					<button type="button" class="flex-1 min-w-0 text-left" @click=${() => this.toggleExpand(a)}>
						<div class="text-sm font-medium text-foreground truncate">${a.filename}</div>
						<div class="text-xs text-muted-foreground truncate">
							${a.sessionTitle ? html`${a.sessionTitle} · ` : ""}${new Date(a.updatedAt).toLocaleString()}
						</div>
					</button>
					<div class="flex items-center gap-1 shrink-0">
						${Button({
							variant: a.pinned ? "default" : "ghost",
							size: "sm",
							onClick: () => this.togglePin(a),
							title: a.pinned ? "Unpin" : "Pin",
							children: icon(a.pinned ? PinOff : Pin, "sm"),
						})}
						${Button({
							variant: "ghost",
							size: "sm",
							onClick: () => this.download(a),
							title: "Download",
							children: icon(Download, "sm"),
						})}
						${Button({
							variant: "ghost",
							size: "sm",
							onClick: () => this.deleteArtifact(a),
							title: "Delete",
							children: icon(Trash2, "sm"),
						})}
					</div>
				</div>
				${expanded ? this.renderPreview(a) : ""}
			</div>
		`;
	}

	render(): TemplateResult {
		return html`
			<div class="flex flex-col gap-4">
				<div>
					<h3 class="text-sm font-semibold text-foreground mb-2">Saved Artifacts</h3>
					<p class="text-sm text-muted-foreground">
						Files created during sessions, saved across sessions. Click a name to preview. Pin to keep.
					</p>
				</div>

				<div class="flex items-center gap-2">
					<div class="flex-1">
						${Input({
							placeholder: "Search artifacts...",
							value: this.searchQuery,
							onInput: (e: Event) => this.onSearchInput(e),
						})}
					</div>
					${Button({
						variant: "outline",
						size: "sm",
						onClick: () => this.clearUnpinned(),
						children: "Clear unpinned",
					})}
				</div>

				${
					this.filtered.length === 0
						? html`<div class="text-sm text-muted-foreground py-8 text-center">
								${this.artifacts.length === 0 ? "No saved artifacts yet." : "No artifacts match your search."}
							</div>`
						: html`<div class="flex flex-col gap-2">${this.filtered.map((a) => this.renderArtifact(a))}</div>`
				}
			</div>
		`;
	}
}

if (!customElements.get("artifacts-tab")) {
	customElements.define("artifacts-tab", ArtifactsTab);
}
