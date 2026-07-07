import { defineConfig } from "vite";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import {
	getClientSiteBranding,
	getSiteBrandName,
	loadSiteBranding,
	readMascotAsset,
	renderBrandTemplate,
} from "./site-branding.mjs";

const siteBranding = loadSiteBranding(getSiteBrandName());
const mascotAsset = readMascotAsset(siteBranding);

export default defineConfig({
	plugins: [
		{
			name: "site-branding",
			transformIndexHtml(html) {
				return renderBrandTemplate(html, siteBranding);
			},
			generateBundle() {
				if (!mascotAsset) {
					return;
				}

				this.emitFile({
					type: "asset",
					fileName: mascotAsset.fileName,
					source: mascotAsset.source,
				});
			},
		},
		tailwindcss(),
	],
	define: {
		__SITE_BRANDING_JSON__: JSON.stringify(JSON.stringify(getClientSiteBranding(siteBranding))),
	},
	root: path.resolve(__dirname, "../src/frontend"),
	publicDir: path.resolve(__dirname, "../src/frontend/public"),
	server: {
		port: 8080,
		host: "0.0.0.0",
		fs: {
			allow: [path.resolve(__dirname, "..")],
		},
	},
	build: {
		outDir: path.resolve(__dirname, "../dist"),
		emptyOutDir: true,
		rollupOptions: {
			input: {
				main: path.resolve(__dirname, "../src/frontend/index.html"),
				install: path.resolve(__dirname, "../src/frontend/install.html"),
			},
		},
	},
});
