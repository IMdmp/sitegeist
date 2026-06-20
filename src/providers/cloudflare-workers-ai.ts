import type { Model } from "@earendil-works/pi-ai";

export const CLOUDFLARE_WORKERS_AI_PROVIDER = "cloudflare-workers-ai";

const CREDENTIAL_PREFIX = "sitegeist-cloudflare-workers-ai:";

export interface CloudflareWorkersAiCredentials {
	apiKey: string;
	accountId: string;
}

export function isCloudflareWorkersAiProvider(provider: string): boolean {
	return provider === CLOUDFLARE_WORKERS_AI_PROVIDER;
}

export function serializeCloudflareWorkersAiCredentials(credentials: CloudflareWorkersAiCredentials): string {
	const params = new URLSearchParams({
		apiKey: credentials.apiKey.trim(),
		accountId: credentials.accountId.trim(),
	});
	return `${CREDENTIAL_PREFIX}${params.toString()}`;
}

export function parseCloudflareWorkersAiCredentials(value: string): CloudflareWorkersAiCredentials | undefined {
	if (!value.startsWith(CREDENTIAL_PREFIX)) return undefined;

	const params = new URLSearchParams(value.slice(CREDENTIAL_PREFIX.length));
	const apiKey = params.get("apiKey")?.trim() || "";
	const accountId = params.get("accountId")?.trim() || "";
	if (!apiKey || !accountId) return undefined;

	return { apiKey, accountId };
}

export function resolveCloudflareWorkersAiApiKey(value: string): string | undefined {
	return parseCloudflareWorkersAiCredentials(value)?.apiKey;
}

export function getCloudflareWorkersAiEnv(value: string): Record<string, string> | undefined {
	const credentials = parseCloudflareWorkersAiCredentials(value);
	if (!credentials) return undefined;
	return {
		CLOUDFLARE_ACCOUNT_ID: credentials.accountId,
	};
}

export function applyCloudflareWorkersAiCredentials<TModel extends Model<any>>(
	model: TModel,
	storedValue: string | undefined,
): TModel {
	if (!isCloudflareWorkersAiProvider(model.provider) || !storedValue) return model;

	const credentials = parseCloudflareWorkersAiCredentials(storedValue);
	if (!credentials) return model;

	return {
		...model,
		baseUrl: model.baseUrl.replace("{CLOUDFLARE_ACCOUNT_ID}", encodeURIComponent(credentials.accountId)),
	} as TModel;
}
