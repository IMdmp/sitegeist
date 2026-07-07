export type BrandMascot =
	| {
			type: "orb";
	  }
	| {
			type: "image";
			src: string;
			alt: string;
	  }
	| {
			type: "video";
			src: string;
	  };

export interface Branding {
	productName: string;
	manifestName?: string;
	manifestDescription: string;
	documentTitle?: string;
	taglinePrefix: string;
	taglineWords: string[];
	welcomeChips: {
		label: string;
		prompt: string;
	}[];
	mascot: BrandMascot;
	links: {
		homepage: string;
		releases?: string;
	};
	iconsDir?: string;
}

const sitegeistFallbackBranding: Branding = {
	productName: "Sitegeist",
	manifestName: "sitegeist",
	manifestDescription: "Your AI companion for the web - Research, automate, create",
	documentTitle: "pi-ai",
	taglinePrefix: "Your AI companion for the web to",
	taglineWords: ["automate", "write", "transform", "research", "scrape", "create"],
	welcomeChips: [
		{
			label: "What is Sitegeist?",
			prompt:
				"You are about to help a non-technical user understand Sitegeist through an interactive tutorial. Guide them step-by-step through Sitegeist's capabilities.",
		},
	],
	mascot: { type: "orb" },
	links: {
		homepage: "https://sitegeist.ai",
		releases: "https://sitegeist.ai/install.html#updating",
	},
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isWelcomeChips(value: unknown): value is Branding["welcomeChips"] {
	return (
		Array.isArray(value) &&
		value.every((entry) => isRecord(entry) && typeof entry.label === "string" && typeof entry.prompt === "string")
	);
}

function isMascot(value: unknown): value is BrandMascot {
	if (!isRecord(value) || typeof value.type !== "string") {
		return false;
	}

	if (value.type === "orb") {
		return true;
	}

	if (value.type === "image") {
		return typeof value.src === "string" && typeof value.alt === "string";
	}

	if (value.type === "video") {
		return typeof value.src === "string";
	}

	return false;
}

function normalizeBranding(value: unknown): Branding | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const links = value.links;
	if (
		typeof value.productName !== "string" ||
		typeof value.manifestDescription !== "string" ||
		typeof value.taglinePrefix !== "string" ||
		!isStringArray(value.taglineWords) ||
		!isWelcomeChips(value.welcomeChips) ||
		!isMascot(value.mascot) ||
		!isRecord(links) ||
		typeof links.homepage !== "string"
	) {
		return undefined;
	}

	return {
		productName: value.productName,
		manifestName: typeof value.manifestName === "string" ? value.manifestName : undefined,
		manifestDescription: value.manifestDescription,
		documentTitle: typeof value.documentTitle === "string" ? value.documentTitle : undefined,
		taglinePrefix: value.taglinePrefix,
		taglineWords: value.taglineWords,
		welcomeChips: value.welcomeChips,
		mascot: value.mascot,
		links: {
			homepage: links.homepage,
			releases: typeof links.releases === "string" ? links.releases : undefined,
		},
		iconsDir: typeof value.iconsDir === "string" ? value.iconsDir : undefined,
	};
}

function getInjectedBranding(): Branding | undefined {
	try {
		if (typeof __BRANDING_JSON__ !== "string" || __BRANDING_JSON__.trim() === "") {
			return undefined;
		}

		const parsed: unknown = JSON.parse(__BRANDING_JSON__);
		return normalizeBranding(parsed);
	} catch (error) {
		console.warn("[Branding] Failed to parse injected branding:", error);
		return undefined;
	}
}

export const branding = getInjectedBranding() ?? sitegeistFallbackBranding;

export function brandUrl(path: string): string {
	return new URL(path, branding.links.homepage).toString();
}

export function brandReleaseUrl(): string {
	return branding.links.releases ?? brandUrl("/install.html#updating");
}
