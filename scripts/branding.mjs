import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const defaultPackageRoot = join(__dirname, "..");
const defaultBrandName = "sitegeist";
const iconSizes = ["16", "48", "128"];

function assertSafeBrandName(brandName) {
	if (!/^[a-z0-9_-]+$/i.test(brandName)) {
		throw new Error(`Invalid brand name "${brandName}". Use letters, numbers, dashes, or underscores.`);
	}
}

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function normalizeBrandingConfig(config) {
	return {
		...config,
		manifestName: config.manifestName ?? config.productName,
		documentTitle: config.documentTitle ?? config.productName,
		iconsDir: config.iconsDir ?? undefined,
	};
}

export function getBrandNameFromArgs(args = process.argv.slice(2)) {
	const brandFlagIndex = args.indexOf("--brand");
	if (brandFlagIndex === -1) {
		return defaultBrandName;
	}

	const brandName = args[brandFlagIndex + 1];
	if (!brandName || brandName.startsWith("-")) {
		throw new Error("Missing brand name after --brand");
	}

	assertSafeBrandName(brandName);
	return brandName;
}

export function loadBrandingConfig(brandName = defaultBrandName, packageRoot = defaultPackageRoot) {
	assertSafeBrandName(brandName);
	const configPath = join(packageRoot, "branding", `${brandName}.json`);
	if (!existsSync(configPath)) {
		throw new Error(`Brand config not found: ${configPath}`);
	}

	return normalizeBrandingConfig(readJson(configPath));
}

export function applyBrandingToManifest(manifestPath, branding) {
	const manifest = readJson(manifestPath);
	const manifestName = branding.manifestName ?? branding.productName;

	if (manifest.name === manifestName && manifest.description === branding.manifestDescription) {
		return false;
	}

	manifest.name = manifestName;
	manifest.description = branding.manifestDescription;
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`);
	return true;
}

function escapeHtmlText(value) {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function applyBrandingToSidepanelHtml(sidepanelPath, branding) {
	const html = readFileSync(sidepanelPath, "utf8");
	const title = escapeHtmlText(branding.documentTitle ?? branding.productName);
	const nextHtml = html.replace(/<title>.*?<\/title>/, `<title>${title}</title>`);

	if (nextHtml === html) {
		return false;
	}

	writeFileSync(sidepanelPath, nextHtml);
	return true;
}

function resolveBrandAssetPath(packageRoot, brandName, assetPath) {
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

function copyAsset(source, destination) {
	mkdirSync(dirname(destination), { recursive: true });
	copyFileSync(source, destination);
}

export function copyBrandAssets(packageRoot, outDir, brandName, branding) {
	if (branding.iconsDir) {
		const iconsDir = resolveBrandAssetPath(packageRoot, brandName, branding.iconsDir);
		for (const size of iconSizes) {
			copyAsset(join(iconsDir, `icon-${size}.png`), join(outDir, `icon-${size}.png`));
		}
	}

	if (branding.mascot.type === "image" || branding.mascot.type === "video") {
		const source = resolveBrandAssetPath(packageRoot, brandName, branding.mascot.src);
		copyAsset(source, join(outDir, branding.mascot.src));
	}
}
