import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const miniLitRoot = join(packageRoot, "..", "mini-lit");

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
