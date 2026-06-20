import { getModels, getProviders, type Model, modelsAreEqual } from "@earendil-works/pi-ai";
import {
	type AutoDiscoveryProviderType,
	formatModelCost,
	getAppStorage,
	Input,
	ModelSelector,
} from "@earendil-works/pi-web-ui";
import { icon } from "@mariozechner/mini-lit";
import { Badge } from "@mariozechner/mini-lit/dist/Badge.js";
import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { DialogHeader } from "@mariozechner/mini-lit/dist/Dialog.js";
import { DialogBase } from "@mariozechner/mini-lit/dist/DialogBase.js";
import { html, type PropertyValues, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { createRef, ref } from "lit/directives/ref.js";
import { Brain, Image as ImageIcon } from "lucide";
import { discoverModels } from "../../node_modules/@earendil-works/pi-web-ui/dist/utils/model-discovery.js";

type ModelListItem = {
	id: string;
	model: Model<any>;
	provider: string;
};

export const SITEGEIST_MODEL_SELECTED_EVENT = "sitegeist-model-selected";

@customElement("sitegeist-model-selector")
class SitegeistModelSelector extends DialogBase {
	@state() currentModel: Model<any> | null = null;
	@state() private customProviderModels: Model<any>[] = [];
	@state() private customProvidersLoading = false;
	@state() private filterProvider = "";
	@state() private filterThinking = false;
	@state() private filterVision = false;
	@state() private searchQuery = "";
	@state() private selectedIndex = 0;
	@state() private navigationMode: "mouse" | "keyboard" = "mouse";

	private lastMousePosition = { x: 0, y: 0 };
	private onSelectCallback?: (model: Model<any>) => void;
	private scrollContainerRef = createRef<HTMLDivElement>();
	private searchInputRef = createRef<HTMLInputElement>();

	protected override modalWidth = "min(760px, 92vw)";

	static async open(currentModel: Model<any> | null, onSelect: (model: Model<any>) => void) {
		const selector = new SitegeistModelSelector();
		selector.currentModel = currentModel;
		selector.filterProvider = currentModel?.provider || "";
		selector.onSelectCallback = onSelect;
		selector.open();
		selector.loadCustomProviders();
	}

	override async firstUpdated(changedProperties: PropertyValues): Promise<void> {
		super.firstUpdated(changedProperties);
		await this.updateComplete;
		this.searchInputRef.value?.focus();

		this.addEventListener("mousemove", (event: MouseEvent) => {
			if (event.clientX === this.lastMousePosition.x && event.clientY === this.lastMousePosition.y) return;
			this.lastMousePosition = { x: event.clientX, y: event.clientY };
			if (this.navigationMode !== "keyboard") return;

			this.navigationMode = "mouse";
			const modelItem = (event.target as HTMLElement).closest("[data-model-item]");
			const allItems = this.scrollContainerRef.value?.querySelectorAll("[data-model-item]");
			if (!modelItem || !allItems) return;

			const index = Array.from(allItems).indexOf(modelItem);
			if (index !== -1) {
				this.selectedIndex = index;
			}
		});

		this.addEventListener("keydown", (event: KeyboardEvent) => {
			const filteredModels = this.getFilteredModels();

			if (event.key === "ArrowDown") {
				event.preventDefault();
				this.navigationMode = "keyboard";
				this.selectedIndex = Math.min(this.selectedIndex + 1, filteredModels.length - 1);
				this.scrollToSelected();
			} else if (event.key === "ArrowUp") {
				event.preventDefault();
				this.navigationMode = "keyboard";
				this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
				this.scrollToSelected();
			} else if (event.key === "Enter") {
				event.preventDefault();
				if (filteredModels[this.selectedIndex]) {
					this.handleSelect(filteredModels[this.selectedIndex].model);
				}
			}
		});
	}

	private async loadCustomProviders() {
		this.customProvidersLoading = true;
		const allCustomModels: Model<any>[] = [];

		try {
			const storage = getAppStorage();
			const customProviders = await storage.customProviders.getAll();

			for (const provider of customProviders) {
				const isAutoDiscovery =
					provider.type === "ollama" ||
					provider.type === "llama.cpp" ||
					provider.type === "vllm" ||
					provider.type === "lmstudio";

				if (isAutoDiscovery) {
					try {
						const models = await discoverModels(
							provider.type as AutoDiscoveryProviderType,
							provider.baseUrl,
							provider.apiKey,
						);
						allCustomModels.push(...models.map((model) => ({ ...model, provider: provider.name })));
					} catch (error) {
						console.debug(`Failed to load models from ${provider.name}:`, error);
					}
				} else if (provider.models) {
					allCustomModels.push(...provider.models);
				}
			}
		} catch (error) {
			console.error("Failed to load custom providers:", error);
		} finally {
			this.customProviderModels = allCustomModels;
			this.customProvidersLoading = false;
			this.requestUpdate();
		}
	}

	private resetSelection() {
		this.selectedIndex = 0;
		if (this.scrollContainerRef.value) {
			this.scrollContainerRef.value.scrollTop = 0;
		}
	}

	private formatTokens(tokens: number): string {
		if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(0)}M`;
		if (tokens >= 1000) return `${(tokens / 1000).toFixed(0)}K`;
		return String(tokens);
	}

	private getAllModels(): ModelListItem[] {
		const allModels: ModelListItem[] = [];

		for (const provider of getProviders()) {
			for (const model of getModels(provider as any)) {
				allModels.push({ provider, id: model.id, model });
			}
		}
		for (const model of this.customProviderModels) {
			allModels.push({ provider: model.provider, id: model.id, model });
		}
		return allModels;
	}

	private getProvidersForFilter(): string[] {
		return Array.from(new Set(this.getAllModels().map(({ provider }) => provider))).sort((a, b) =>
			a.localeCompare(b),
		);
	}

	private getFilteredModels(): ModelListItem[] {
		let filteredModels = this.getAllModels();

		if (this.filterProvider) {
			filteredModels = filteredModels.filter(({ provider }) => provider === this.filterProvider);
		}

		if (this.searchQuery) {
			const searchTokens = this.searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
			filteredModels = filteredModels.filter(({ provider, id, model }) => {
				const searchText = `${provider} ${id} ${model.name}`.toLowerCase();
				return searchTokens.every((token) => searchText.includes(token));
			});
		}

		if (this.filterThinking) {
			filteredModels = filteredModels.filter(({ model }) => model.reasoning);
		}
		if (this.filterVision) {
			filteredModels = filteredModels.filter(({ model }) => model.input.includes("image"));
		}

		filteredModels.sort((a, b) => {
			const aIsCurrent = modelsAreEqual(this.currentModel, a.model);
			const bIsCurrent = modelsAreEqual(this.currentModel, b.model);
			if (aIsCurrent && !bIsCurrent) return -1;
			if (!aIsCurrent && bIsCurrent) return 1;
			const providerSort = a.provider.localeCompare(b.provider);
			return providerSort || a.id.localeCompare(b.id);
		});

		return filteredModels;
	}

	private handleSelect(model: Model<any>) {
		this.onSelectCallback?.(model);
		window.dispatchEvent(new CustomEvent<Model<any>>(SITEGEIST_MODEL_SELECTED_EVENT, { detail: model }));
		this.close();
	}

	private scrollToSelected() {
		requestAnimationFrame(() => {
			const selectedElement = this.scrollContainerRef.value?.querySelectorAll("[data-model-item]")[
				this.selectedIndex
			] as HTMLElement;
			selectedElement?.scrollIntoView({ block: "nearest", behavior: "smooth" });
		});
	}

	protected override renderContent(): TemplateResult {
		const providers = this.getProvidersForFilter();
		const filteredModels = this.getFilteredModels();

		return html`
			<div class="p-6 pb-4 flex flex-col gap-4 border-b border-border flex-shrink-0">
				${DialogHeader({ title: "Select Model" })}
				<div class="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_220px] gap-3">
					${Input({
						placeholder: "Search models...",
						value: this.searchQuery,
						inputRef: this.searchInputRef,
						onInput: (event: Event) => {
							this.searchQuery = (event.target as HTMLInputElement).value;
							this.resetSelection();
						},
					})}
					<select
						class="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						.value=${this.filterProvider}
						@change=${(event: Event) => {
							this.filterProvider = (event.target as HTMLSelectElement).value;
							this.resetSelection();
						}}
						title="Filter by provider"
					>
						<option value="">All providers</option>
						${providers.map((provider) => html`<option value=${provider}>${provider}</option>`)}
					</select>
				</div>
				<div class="flex flex-wrap items-center gap-2">
					${Button({
						variant: this.filterThinking ? "default" : "secondary",
						size: "sm",
						onClick: () => {
							this.filterThinking = !this.filterThinking;
							this.resetSelection();
						},
						className: "rounded-full",
						children: html`<span class="inline-flex items-center gap-1">${icon(Brain, "sm")} Thinking</span>`,
					})}
					${Button({
						variant: this.filterVision ? "default" : "secondary",
						size: "sm",
						onClick: () => {
							this.filterVision = !this.filterVision;
							this.resetSelection();
						},
						className: "rounded-full",
						children: html`<span class="inline-flex items-center gap-1">${icon(ImageIcon, "sm")} Vision</span>`,
					})}
					<span class="text-xs text-muted-foreground ml-auto">
						${this.customProvidersLoading ? "Loading custom providers..." : `${filteredModels.length} models`}
					</span>
				</div>
			</div>

			<div class="flex-1 overflow-y-auto" ${ref(this.scrollContainerRef)}>
				${filteredModels.map(({ provider, id, model }, index) => {
					const isCurrent = modelsAreEqual(this.currentModel, model);
					const isSelected = index === this.selectedIndex;
					return html`
						<button
							type="button"
							data-model-item
							class="block w-full text-left px-4 py-3 ${
								this.navigationMode === "mouse" ? "hover:bg-muted" : ""
							} border-b border-border ${isSelected ? "bg-accent" : ""}"
							@click=${() => this.handleSelect(model)}
							@mouseenter=${() => {
								if (this.navigationMode === "mouse") {
									this.selectedIndex = index;
								}
							}}
						>
							<div class="flex items-start justify-between gap-3 mb-2">
								<div class="min-w-0">
									<div class="text-sm font-medium text-foreground break-all" title=${id}>${id}</div>
									${
										model.name && model.name !== id
											? html`<div class="text-xs text-muted-foreground break-all mt-0.5" title=${model.name}>${model.name}</div>`
											: ""
									}
								</div>
								<div class="flex items-center gap-2 shrink-0">
									${isCurrent ? html`<span class="text-green-500 text-sm">Current</span>` : ""}
									<span title=${provider}>${Badge(provider, "outline")}</span>
								</div>
							</div>
							<div class="flex items-center justify-between text-xs text-muted-foreground gap-3">
								<div class="flex items-center gap-2 min-w-0">
									<span class="${model.reasoning ? "" : "opacity-30"}">${icon(Brain, "sm")}</span>
									<span class="${model.input.includes("image") ? "" : "opacity-30"}">${icon(ImageIcon, "sm")}</span>
									<span>${this.formatTokens(model.contextWindow)}/${this.formatTokens(model.maxTokens)}</span>
								</div>
								<span class="shrink-0">${formatModelCost(model.cost)}</span>
							</div>
						</button>
					`;
				})}
			</div>
		`;
	}
}

export function installSitegeistModelSelector() {
	ModelSelector.open = SitegeistModelSelector.open;
}
