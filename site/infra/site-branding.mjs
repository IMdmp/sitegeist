import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBrandingConfig } from "../../scripts/branding.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = join(__dirname, "../..");
const defaultBrandName = "sitegeist";

function escapeHtml(value) {
	return String(value)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function getSiteMetadata(branding) {
	return branding.site && typeof branding.site === "object" ? branding.site : {};
}

function getPageTitle(branding, siteMetadata) {
	if (typeof siteMetadata.pageTitle === "string") {
		return siteMetadata.pageTitle;
	}

	const tagline = branding.taglinePrefix.replace(/\s+to$/i, "");
	return `${branding.productName} - ${tagline}`;
}

function getInstallFolderName(branding, siteMetadata) {
	if (typeof siteMetadata.installFolderName === "string") {
		return siteMetadata.installFolderName;
	}

	return branding.productName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function resolveBrandAssetPath(brandName, assetPath) {
	const candidates = [
		join(packageRoot, assetPath),
		join(packageRoot, "branding", brandName, "assets", assetPath),
		join(packageRoot, "branding", brandName, assetPath),
		join(packageRoot, "static", assetPath),
	];

	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}

	throw new Error(`Brand asset not found for ${brandName}: ${assetPath}`);
}

function createMascotData(brandName, mascot) {
	if (mascot.type === "orb") {
		return {
			mascotMarkup: `<div class="w-full max-w-[320px] aspect-square mx-auto mb-12">
                <orb-animation class="block w-full h-full"></orb-animation>
            </div>`,
			mascotScript: '<script type="module" src="OrbAnimation.ts"></script>',
		};
	}

	const fileName = `brand-assets/${basename(mascot.src)}`;
	const sourcePath = resolveBrandAssetPath(brandName, mascot.src);

	if (mascot.type === "image") {
		return {
			mascotMarkup: `<div class="w-full max-w-[320px] aspect-square mx-auto mb-12">
                <img src="${escapeHtml(fileName)}" alt="${escapeHtml(mascot.alt)}" class="block w-full h-full object-contain">
            </div>`,
			mascotScript: "",
			mascotAsset: { sourcePath, fileName },
		};
	}

	return {
		mascotMarkup: `<div class="w-full max-w-[320px] aspect-square mx-auto mb-12">
                <video src="${escapeHtml(fileName)}" class="block w-full h-full object-contain" autoplay loop muted playsinline></video>
            </div>`,
		mascotScript: "",
		mascotAsset: { sourcePath, fileName },
	};
}

export function getSiteBrandName() {
	const brandName = process.env.SITE_BRAND ?? defaultBrandName;
	if (!/^[a-z0-9_-]+$/i.test(brandName)) {
		throw new Error(`Invalid site brand name "${brandName}"`);
	}

	return brandName;
}

export function loadSiteBranding(brandName = defaultBrandName) {
	const branding = loadBrandingConfig(brandName, packageRoot);
	const siteMetadata = getSiteMetadata(branding);
	const mascotData = createMascotData(brandName, branding.mascot);
	const taglineWords = Array.isArray(siteMetadata.taglineWords) ? siteMetadata.taglineWords : branding.taglineWords;
	const ctaWords = Array.isArray(siteMetadata.ctaWords) ? siteMetadata.ctaWords : taglineWords;

	return {
		productName: branding.productName,
		pageTitle: getPageTitle(branding, siteMetadata),
		taglinePrefix: branding.taglinePrefix,
		taglineWords,
		ctaWords,
		initialTaglineWord: taglineWords[0] ?? "",
		downloadUrl: siteMetadata.downloadUrl ?? branding.links.releases ?? branding.links.homepage,
		downloadLabel: siteMetadata.downloadLabel ?? "Download",
		downloadLatestLabel: siteMetadata.downloadLatestLabel ?? "Download Latest Version",
		sourceUrl: siteMetadata.sourceUrl ?? "https://github.com/badlogic/sitegeist",
		sourceLabel: siteMetadata.sourceLabel ?? "View source",
		installFolderName: getInstallFolderName(branding, siteMetadata),
		...mascotData,
	};
}

export function getClientSiteBranding(siteBranding) {
	return {
		taglineWords: siteBranding.taglineWords,
		ctaWords: siteBranding.ctaWords,
	};
}

export function renderBrandTemplate(html, siteBranding) {
	const replacements = {
		"%%BRAND_PRODUCT_NAME%%": escapeHtml(siteBranding.productName),
		"%%BRAND_PAGE_TITLE%%": escapeHtml(siteBranding.pageTitle),
		"%%BRAND_TAGLINE_PREFIX%%": escapeHtml(siteBranding.taglinePrefix),
		"%%BRAND_INITIAL_TAGLINE_WORD%%": escapeHtml(siteBranding.initialTaglineWord),
		"%%BRAND_DOWNLOAD_URL%%": escapeHtml(siteBranding.downloadUrl),
		"%%BRAND_DOWNLOAD_LABEL%%": escapeHtml(siteBranding.downloadLabel),
		"%%BRAND_DOWNLOAD_LATEST_LABEL%%": escapeHtml(siteBranding.downloadLatestLabel),
		"%%BRAND_SOURCE_URL%%": escapeHtml(siteBranding.sourceUrl),
		"%%BRAND_SOURCE_LABEL%%": escapeHtml(siteBranding.sourceLabel),
		"%%BRAND_INSTALL_FOLDER_NAME%%": escapeHtml(siteBranding.installFolderName),
		"%%BRAND_MASCOT_MARKUP%%": siteBranding.mascotMarkup,
		"%%BRAND_MASCOT_SCRIPT%%": siteBranding.mascotScript,
	};

	let output = html;
	for (const [token, value] of Object.entries(replacements)) {
		output = output.replaceAll(token, value);
	}

	return output;
}

export function readMascotAsset(siteBranding) {
	if (!siteBranding.mascotAsset) {
		return undefined;
	}

	return {
		fileName: siteBranding.mascotAsset.fileName,
		source: readFileSync(siteBranding.mascotAsset.sourcePath),
	};
}
