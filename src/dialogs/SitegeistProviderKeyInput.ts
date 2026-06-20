import {
	type Context,
	complete,
	getModel,
	type KnownProvider,
	type Model,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { applyProxyIfNeeded, getAppStorage, Input } from "@earendil-works/pi-web-ui";
import { i18n } from "@mariozechner/mini-lit";
import { Badge } from "@mariozechner/mini-lit/dist/Badge.js";
import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { html, LitElement, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { Toast } from "../components/Toast.js";

const TEST_MODELS: Partial<Record<KnownProvider, string>> = {
	anthropic: "claude-3-5-haiku-20241022",
	cerebras: "gpt-oss-120b",
	google: "gemini-2.5-flash",
	groq: "openai/gpt-oss-20b",
	openai: "gpt-4o-mini",
	openrouter: "z-ai/glm-4.6",
	"vercel-ai-gateway": "anthropic/claude-opus-4.5",
	xai: "grok-4-fast-non-reasoning",
	zai: "glm-4.5-air",
};

@customElement("sitegeist-provider-key-input")
export class SitegeistProviderKeyInput extends LitElement {
	@property() provider = "";
	@state() private failed = false;
	@state() private hasKey = false;
	@state() private inputChanged = false;
	@state() private keyInput = "";
	@state() private removing = false;
	@state() private testing = false;

	override createRenderRoot(): HTMLElement | DocumentFragment {
		return this;
	}

	override async connectedCallback() {
		super.connectedCallback();
		await this.checkKeyStatus();
	}

	private async checkKeyStatus() {
		try {
			const key = await getAppStorage().providerKeys.get(this.provider);
			this.hasKey = !!key;
		} catch (error) {
			console.error("Failed to check key status:", error);
		}
	}

	private getTestModel(provider: string): Model<any> | undefined {
		const knownProvider = provider as KnownProvider;
		const modelId = TEST_MODELS[knownProvider];
		if (!modelId) return undefined;
		return getModel(knownProvider, modelId as never);
	}

	private async testApiKey(provider: string, apiKey: string): Promise<boolean> {
		try {
			let model = this.getTestModel(provider);
			if (!model) return true;

			const proxyEnabled = await getAppStorage().settings.get<boolean>("proxy.enabled");
			const proxyUrl = await getAppStorage().settings.get<string>("proxy.url");
			model = applyProxyIfNeeded(model, apiKey, proxyEnabled ? proxyUrl || undefined : undefined);

			const context: Context = {
				messages: [{ role: "user", content: "Reply with: ok", timestamp: Date.now() }],
			};

			const result = await complete(model, context, {
				apiKey,
				maxTokens: 200,
			} satisfies SimpleStreamOptions);

			return result.stopReason === "stop";
		} catch (error) {
			console.error(`API key test failed for ${provider}:`, error);
			return false;
		}
	}

	private async saveKey() {
		const key = this.keyInput.trim();
		if (!key) return;

		this.testing = true;
		this.failed = false;

		const success = await this.testApiKey(this.provider, key);
		this.testing = false;

		if (!success) {
			this.failed = true;
			setTimeout(() => {
				this.failed = false;
				this.requestUpdate();
			}, 5000);
			return;
		}

		try {
			await getAppStorage().providerKeys.set(this.provider, key);
			this.hasKey = true;
			this.inputChanged = false;
			this.keyInput = "";
			Toast.success(`${this.provider} API key saved`);
			this.requestUpdate();
		} catch (error) {
			console.error("Failed to save API key:", error);
			this.failed = true;
			setTimeout(() => {
				this.failed = false;
				this.requestUpdate();
			}, 5000);
		}
	}

	private async removeKey() {
		if (!this.hasKey || this.removing) return;
		this.removing = true;
		try {
			await getAppStorage().providerKeys.delete(this.provider);
			this.hasKey = false;
			this.inputChanged = false;
			this.keyInput = "";
			this.failed = false;
			Toast.success(`${this.provider} API key removed`);
		} catch (error) {
			console.error("Failed to remove API key:", error);
			this.failed = true;
		} finally {
			this.removing = false;
			this.requestUpdate();
		}
	}

	override render(): TemplateResult {
		return html`
			<div class="space-y-3">
				<div class="flex items-center gap-2">
					<span class="text-sm font-medium capitalize text-foreground">${this.provider}</span>
					${
						this.testing
							? Badge({ children: i18n("Testing..."), variant: "secondary" })
							: this.hasKey
								? html`<span class="text-green-600 dark:text-green-400">✓</span>`
								: ""
					}
					${this.failed ? Badge({ children: i18n("✗ Invalid"), variant: "destructive" }) : ""}
				</div>
				<div class="flex items-center gap-2">
					${Input({
						type: "password",
						placeholder: this.hasKey ? "••••••••••••" : i18n("Enter API key"),
						value: this.keyInput,
						onInput: (event: Event) => {
							this.keyInput = (event.target as HTMLInputElement).value;
							this.inputChanged = true;
							this.requestUpdate();
						},
						className: "flex-1",
					})}
					${Button({
						onClick: () => this.saveKey(),
						variant: "default",
						size: "sm",
						disabled: !this.keyInput || this.testing || (this.hasKey && !this.inputChanged),
						children: i18n("Save"),
					})}
					${
						this.hasKey
							? Button({
									onClick: () => this.removeKey(),
									variant: "outline",
									size: "sm",
									disabled: this.testing || this.removing,
									children: this.removing ? "Removing..." : "Remove",
								})
							: ""
					}
				</div>
			</div>
		`;
	}
}
