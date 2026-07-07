import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const miniLitRoot = join(packageRoot, "..", "mini-lit");

const requiredRootFiles = [
	["pdfjs-dist", "node_modules/pdfjs-dist/build/pdf.mjs"],
	["pdfjs-dist worker", "node_modules/pdfjs-dist/build/pdf.worker.min.mjs"],
	["typebox", "node_modules/typebox/build/index.mjs"],
	["typebox/compile", "node_modules/typebox/build/compile/index.mjs"],
	["typebox/value", "node_modules/typebox/build/value/index.mjs"],
];

const missingRootFiles = requiredRootFiles.filter(([, path]) => !existsSync(join(packageRoot, path)));
if (missingRootFiles.length > 0) {
	console.error("Error: Sitegeist dependencies are not installed or are stale.");
	console.error("Missing required files:");
	for (const [name, path] of missingRootFiles) {
		console.error(`  - ${name}: ${path}`);
	}
	console.error("Run:");
	console.error("  npm install");
	process.exit(1);
}

if (!existsSync(miniLitRoot)) {
	console.error("Error: mini-lit not found at ../mini-lit");
	console.error("Clone https://github.com/badlogic/mini-lit next to this repo, then run:");
	console.error("  (cd ../mini-lit && npm install)");
	process.exit(1);
}

const miniLitNodeModules = join(miniLitRoot, "node_modules");
if (!existsSync(miniLitNodeModules)) {
	console.error("Error: mini-lit dependencies are not installed.");
	console.error("Run:");
	console.error("  (cd ../mini-lit && npm install)");
	process.exit(1);
}

execFileSync("npm", ["run", "build"], {
	cwd: miniLitRoot,
	stdio: "inherit",
});
