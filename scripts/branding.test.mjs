import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyBrandingToManifest, applyBrandingToSidepanelHtml, loadBrandingConfig } from "./branding.mjs";

test("loads the default Sitegeist branding config", async () => {
	const branding = await loadBrandingConfig();

	assert.equal(branding.productName, "Sitegeist");
	assert.equal(branding.manifestName, "sitegeist");
	assert.equal(branding.manifestDescription, "Your AI companion for the web - Research, automate, create");
	assert.deepEqual(branding.taglineWords, ["automate", "write", "transform", "research", "scrape", "create"]);
	assert.equal(branding.mascot.type, "orb");
	assert.equal(branding.links.homepage, "https://sitegeist.ai");
	assert.equal(branding.cliCommand, "sitegeist");
});

test("loads a named brand and rewrites a manifest copy", async () => {
	const branding = await loadBrandingConfig("sitegeist");
	const tempDir = await mkdtemp(join(tmpdir(), "sitegeist-branding-"));
	const manifestPath = join(tempDir, "manifest.json");

	await writeFile(
		manifestPath,
		JSON.stringify(
			{
				manifest_version: 3,
				name: "old",
				description: "old",
				icons: {
					16: "icon-16.png",
					48: "icon-48.png",
					128: "icon-128.png",
				},
			},
			null,
			"\t",
		),
	);

	await applyBrandingToManifest(manifestPath, branding);

	const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
	assert.equal(manifest.name, "sitegeist");
	assert.equal(manifest.description, "Your AI companion for the web - Research, automate, create");
	assert.deepEqual(manifest.icons, {
		16: "icon-16.png",
		48: "icon-48.png",
		128: "icon-128.png",
	});
});

test("rewrites the copied sidepanel title from branding", async () => {
	const tempDir = await mkdtemp(join(tmpdir(), "sitegeist-branding-html-"));
	const sidepanelPath = join(tempDir, "sidepanel.html");

	await writeFile(sidepanelPath, "<!doctype html><html><head><title>pi-ai</title></head></html>");
	await applyBrandingToSidepanelHtml(sidepanelPath, {
		productName: "Acme Copilot",
		manifestDescription: "Acme description",
		taglinePrefix: "Acme to",
		taglineWords: ["inspect"],
		welcomeChips: [],
		mascot: { type: "orb" },
		links: { homepage: "https://example.com" },
	});

	const sidepanel = await readFile(sidepanelPath, "utf8");
	assert.match(sidepanel, /<title>Acme Copilot<\/title>/);
});

test("brandable source surfaces do not hard-code the default brand", async () => {
	const checks = [
		["src/messages/WelcomeMessage.ts", ["Sitegeist", "Your AI companion for the web to"]],
		["src/dialogs/WelcomeSetupDialog.ts", ["Welcome to Sitegeist"]],
		["src/dialogs/AboutTab.ts", ["Sitegeist", "https://sitegeist.ai"]],
		["src/dialogs/UpdateNotificationDialog.ts", ["https://sitegeist.ai"]],
		["src/tutorials.ts", ["Sitegeist"]],
		["src/prompts/prompts.ts", ["Sitegeist"]],
		["src/tools/local-agent.ts", ["Sitegeist"]],
		["src/tools/debugger.ts", ["Sitegeist"]],
		["src/sidepanel.ts", ["https://sitegeist.ai"]],
	];

	for (const [filePath, forbiddenValues] of checks) {
		const source = await readFile(filePath, "utf8");
		for (const forbidden of forbiddenValues) {
			assert.equal(source.includes(forbidden), false, `${filePath} still contains ${forbidden}`);
		}
	}
});

test("welcome renders the brand mascot abstraction", async () => {
	const mascotSource = await readFile("src/components/BrandMascot.ts", "utf8");
	const welcomeSource = await readFile("src/messages/WelcomeMessage.ts", "utf8");

	assert.match(mascotSource, /@customElement\("brand-mascot"\)/);
	assert.match(mascotSource, /<orb-animation><\/orb-animation>/);
	assert.match(mascotSource, /<img/);
	assert.match(mascotSource, /<video/);
	assert.equal(welcomeSource.includes("<brand-mascot></brand-mascot>"), true);
	assert.equal(welcomeSource.includes("<orb-animation></orb-animation>"), false);
});

test("loads the Acme proof brand", async () => {
	const branding = await loadBrandingConfig("acme");

	assert.equal(branding.productName, "Acme Copilot");
	assert.equal(branding.manifestName, "Acme Copilot");
	assert.equal(branding.welcomeChips.length, 3);
	assert.equal(branding.mascot.type, "image");
	assert.equal(branding.mascot.src, "acme-mascot.png");
	assert.equal(branding.iconsDir, "icons");
	assert.equal(branding.cliCommand, "acme");
});
