import { getAppStorage } from "@earendil-works/pi-web-ui";
import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { Input } from "@mariozechner/mini-lit/dist/Input.js";
import { html, LitElement, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Toast } from "../components/Toast.js";
import {
	CLOUDFLARE_WORKERS_AI_PROVIDER,
	parseCloudflareWorkersAiCredentials,
	serializeCloudflareWorkersAiCredentials,
} from "../providers/cloudflare-workers-ai.js";

@customElement("cloudflare-workers-ai-key-input")
export class CloudflareWorkersAiKeyInput extends LitElement {
	@state() private accountId = "";
	@state() private apiKey = "";
	@state() private connected = false;
	@state() private error = "";

	override createRenderRoot(): HTMLElement | DocumentFragment {
		return this;
	}

	override async connectedCallback() {
		super.connectedCallback();
		await this.loadCredentials();
	}

	private async loadCredentials() {
		const stored = await getAppStorage().providerKeys.get(CLOUDFLARE_WORKERS_AI_PROVIDER);
		if (!stored) {
			this.connected = false;
			this.accountId = "";
			this.apiKey = "";
			return;
		}

		const credentials = parseCloudflareWorkersAiCredentials(stored);
		if (credentials) {
			this.connected = true;
			this.accountId = credentials.accountId;
			this.apiKey = credentials.apiKey;
			return;
		}

		this.connected = true;
		this.apiKey = stored;
	}

	private async saveCredentials() {
		const accountId = this.accountId.trim();
		const apiKey = this.apiKey.trim();
		if (!accountId || !apiKey) {
			this.error = "Account ID and API token are required.";
			return;
		}

		await getAppStorage().providerKeys.set(
			CLOUDFLARE_WORKERS_AI_PROVIDER,
			serializeCloudflareWorkersAiCredentials({ accountId, apiKey }),
		);
		this.connected = true;
		this.error = "";
		Toast.success("Cloudflare Workers AI credentials saved");
		this.requestUpdate();
	}

	private async clearCredentials() {
		await getAppStorage().providerKeys.delete(CLOUDFLARE_WORKERS_AI_PROVIDER);
		this.connected = false;
		this.accountId = "";
		this.apiKey = "";
		this.error = "";
		Toast.success("Cloudflare Workers AI credentials removed");
		this.requestUpdate();
	}

	override render(): TemplateResult {
		return html`
			<div class="flex flex-col gap-4 p-4 rounded-lg border border-border bg-card">
				<div class="flex items-start justify-between gap-4">
					<div class="min-w-0">
						<div class="text-sm font-medium text-foreground">Cloudflare Workers AI</div>
						<div class="text-xs text-muted-foreground mt-1">
							${this.connected ? html`<span class="text-green-600 dark:text-green-400">Connected</span>` : "Not connected"}
						</div>
					</div>
				</div>

				<div class="grid grid-cols-1 gap-3">
					${Input({
						label: "Account ID",
						type: "text",
						value: this.accountId,
						autocomplete: "off",
						onInput: (event: Event) => {
							this.accountId = (event.target as HTMLInputElement).value;
							this.error = "";
						},
					})}
					${Input({
						label: "API token",
						type: "password",
						value: this.apiKey,
						autocomplete: "off",
						onInput: (event: Event) => {
							this.apiKey = (event.target as HTMLInputElement).value;
							this.error = "";
						},
					})}
				</div>

				${this.error ? html`<div class="text-sm text-destructive">${this.error}</div>` : ""}

				<div class="flex justify-end gap-2">
					${
						this.connected
							? Button({
									variant: "outline",
									size: "sm",
									onClick: () => this.clearCredentials(),
									children: "Remove",
								})
							: ""
					}
					${Button({
						variant: "default",
						size: "sm",
						onClick: () => this.saveCredentials(),
						children: "Save",
					})}
				</div>
			</div>
		`;
	}
}
