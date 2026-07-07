import assert from "node:assert/strict";
import test from "node:test";
import { loadSiteBranding, renderBrandTemplate } from "./site-branding.mjs";

test("loads default Sitegeist site branding", () => {
	const branding = loadSiteBranding("sitegeist");

	assert.equal(branding.productName, "Sitegeist");
	assert.equal(branding.pageTitle, "Sitegeist - Your AI Companion for the Web");
	assert.equal(branding.downloadUrl, "https://github.com/badlogic/sitegeist/releases/latest");
	assert.equal(branding.downloadLabel, "Download from GitHub");
	assert.equal(branding.downloadLatestLabel, "Download Latest Version");
	assert.equal(branding.sourceLabel, "View on GitHub");
	assert.equal(branding.installFolderName, "sitegeist");
	assert.equal(branding.initialTaglineWord, "automate");
	assert.match(branding.mascotMarkup, /<orb-animation/);
});

test("loads Acme site branding from the shared brand JSON", () => {
	const branding = loadSiteBranding("acme");

	assert.equal(branding.productName, "Acme Copilot");
	assert.equal(branding.pageTitle, "Acme Copilot - Your operations copilot");
	assert.equal(branding.downloadUrl, "https://example.com/acme/releases");
	assert.equal(branding.downloadLabel, "Download");
	assert.equal(branding.downloadLatestLabel, "Download Latest Version");
	assert.equal(branding.initialTaglineWord, "inspect");
	assert.match(branding.mascotMarkup, /<img/);
	assert.match(branding.mascotMarkup, /brand-assets\/acme-mascot\.png/);
	assert.equal(branding.mascotAsset?.fileName, "brand-assets/acme-mascot.png");
});

test("renders brand placeholders in site HTML", () => {
	const branding = loadSiteBranding("acme");
	const html = renderBrandTemplate(
		"<title>%%BRAND_PAGE_TITLE%%</title><h1>%%BRAND_PRODUCT_NAME%%</h1>%%BRAND_MASCOT_MARKUP%%",
		branding,
	);

	assert.match(html, /<title>Acme Copilot - Your operations copilot<\/title>/);
	assert.match(html, /<h1>Acme Copilot<\/h1>/);
	assert.match(html, /brand-assets\/acme-mascot\.png/);
});
