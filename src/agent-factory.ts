import type { StreamFn } from "@earendil-works/pi-agent-core";
import { getModel, getModels, getProviders, type Model } from "@earendil-works/pi-ai";
import { createStreamFn } from "@earendil-works/pi-web-ui";
import { resolveApiKey } from "./oauth/index.js";
import {
	applyCloudflareWorkersAiCredentials,
	isCloudflareWorkersAiProvider,
} from "./providers/cloudflare-workers-ai.js";
import type { SitegeistAppStorage } from "./storage/app-storage.js";

export const DEFAULT_MODELS: Record<string, string> = {
	"amazon-bedrock": "us.anthropic.claude-opus-4-6-v1",
	anthropic: "claude-sonnet-4-6",
	"azure-openai-responses": "gpt-5.2",
	cerebras: "zai-glm-4.6",
	"cloudflare-workers-ai": "@cf/moonshotai/kimi-k2.6",
	"github-copilot": "gpt-4o",
	google: "gemini-2.5-flash",
	"google-antigravity": "gemini-3.1-pro-high",
	"google-gemini-cli": "gemini-2.5-pro",
	"google-vertex": "gemini-3-pro-preview",
	groq: "openai/gpt-oss-20b",
	huggingface: "moonshotai/Kimi-K2.5",
	"kimi-coding": "kimi-k2-thinking",
	minimax: "MiniMax-M2.1",
	"minimax-cn": "MiniMax-M2.1",
	mistral: "devstral-medium-latest",
	openai: "gpt-4o-mini",
	"openai-codex": "gpt-5.1-codex-mini",
	opencode: "claude-opus-4-6",
	"opencode-go": "kimi-k2.5",
	openrouter: "openai/gpt-5.1-codex",
	"vercel-ai-gateway": "anthropic/claude-opus-4-6",
	xai: "grok-4-fast-non-reasoning",
	zai: "glm-4.6",
};

export async function getProvidersWithKeys(storage: SitegeistAppStorage): Promise<string[]> {
	const providers = await storage.providerKeys.list();
	const result: string[] = [];
	for (const provider of providers) {
		const key = await storage.providerKeys.get(provider);
		if (key) result.push(provider);
	}
	return result;
}

async function getStoredProviderKey(storage: SitegeistAppStorage, provider: string) {
	if (!isCloudflareWorkersAiProvider(provider)) return undefined;
	return (await storage.providerKeys.get(provider)) || undefined;
}

type SitegeistStreamFn = StreamFn;
type SitegeistStreamFnArgs = Parameters<SitegeistStreamFn>;

export function createSitegeistStreamFn(storage: SitegeistAppStorage): SitegeistStreamFn {
	const baseStreamFn = createStreamFn(async () => {
		const enabled = await storage.settings.get<boolean>("proxy.enabled");
		if (!enabled) return undefined;
		return (await storage.settings.get<string>("proxy.url")) || undefined;
	});

	return (async (...args: SitegeistStreamFnArgs) => {
		const [model, context, options] = args;
		const storedProviderKey = await getStoredProviderKey(storage, model.provider);
		const resolvedModel = applyCloudflareWorkersAiCredentials(model, storedProviderKey);
		return baseStreamFn(resolvedModel, context, options) as unknown as ReturnType<SitegeistStreamFn>;
	}) as SitegeistStreamFn;
}

export function createProviderKeyResolver(
	storage: SitegeistAppStorage,
): (provider: string) => Promise<string | undefined> {
	return async (provider: string) => {
		const stored = await storage.providerKeys.get(provider);
		if (!stored) return undefined;
		const proxyEnabled = await storage.settings.get<boolean>("proxy.enabled");
		const proxyUrl = proxyEnabled ? (await storage.settings.get<string>("proxy.url")) || undefined : undefined;
		return resolveApiKey(stored, provider, storage.providerKeys, proxyUrl);
	};
}

export async function resolveDefaultModel(storage: SitegeistAppStorage): Promise<Model<any>> {
	const savedModel = await storage.settings.get<Model<any>>("lastUsedModel");
	if (savedModel) return savedModel;

	const providersWithKeys = await getProvidersWithKeys(storage);
	for (const provider of providersWithKeys) {
		const modelId = DEFAULT_MODELS[provider];
		if (modelId) {
			const model = getModel(provider as any, modelId);
			if (model) return model;
		}
	}

	return getModel("anthropic", "claude-sonnet-4-6");
}

/** Resolve a model reference of the form "provider:model-id" or a bare model id. */
export function findModelById(reference: string): Model<any> | undefined {
	const separator = reference.indexOf(":");
	if (separator > 0) {
		const providerName = reference.slice(0, separator);
		const modelId = reference.slice(separator + 1);
		const provider = getProviders().find((candidate) => candidate === providerName);
		if (provider) {
			const match = getModels(provider).find((model) => model.id === modelId);
			if (match) return match;
		}
	}

	for (const provider of getProviders()) {
		const match = getModels(provider).find((model) => model.id === reference);
		if (match) return match;
	}
	return undefined;
}
