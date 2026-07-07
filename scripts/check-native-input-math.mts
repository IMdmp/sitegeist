import { computeDragPath, type NativeInputPoint } from "../src/tools/native-input-math.js";

const green = "\u001b[32m";
const red = "\u001b[31m";
const reset = "\u001b[0m";

interface Check {
	name: string;
	run: () => void;
}

function assert(condition: boolean, message: string): void {
	if (!condition) {
		throw new Error(message);
	}
}

function assertPoint(actual: NativeInputPoint, expected: NativeInputPoint, message: string): void {
	assert(
		actual.x === expected.x && actual.y === expected.y,
		`${message}: expected ${formatPoint(expected)}, got ${formatPoint(actual)}`,
	);
}

function formatPoint(point: NativeInputPoint): string {
	return `(${point.x}, ${point.y})`;
}

function isMonotonic(values: number[]): boolean {
	if (values.length < 2) {
		return true;
	}

	const direction = Math.sign(values.at(-1)! - values[0]);
	if (direction === 0) {
		return values.every((value) => value === values[0]);
	}

	return values.every((value, index) => index === 0 || (value - values[index - 1]) * direction >= 0);
}

const checks: Check[] = [
	{
		name: "includes exact endpoints",
		run: () => {
			const from = { x: 12, y: 34 };
			const to = { x: 98, y: 76 };
			const path = computeDragPath(from, to, 16);

			assertPoint(path[0], from, "start point");
			assertPoint(path.at(-1)!, to, "end point");
		},
	},
	{
		name: "returns steps plus two total points",
		run: () => {
			for (const steps of [0, 1, 2, 16]) {
				const path = computeDragPath({ x: 0, y: 0 }, { x: 10, y: 20 }, steps);
				assert(path.length === steps + 2, `steps=${steps} expected ${steps + 2} points, got ${path.length}`);
			}
		},
	},
	{
		name: "interpolates monotonically",
		run: () => {
			const path = computeDragPath({ x: 10, y: 100 }, { x: 50, y: 20 }, 8);
			assert(isMonotonic(path.map((point) => point.x)), "x values must be monotonic");
			assert(isMonotonic(path.map((point) => point.y)), "y values must be monotonic");
		},
	},
	{
		name: "steps=1 creates one midpoint",
		run: () => {
			const path = computeDragPath({ x: 0, y: 0 }, { x: 10, y: 20 }, 1);
			assert(path.length === 3, `expected 3 points, got ${path.length}`);
			assertPoint(path[1], { x: 5, y: 10 }, "midpoint");
		},
	},
];

let failures = 0;
for (const check of checks) {
	try {
		check.run();
		console.log(`${green}PASS${reset} ${check.name}`);
	} catch (error) {
		failures += 1;
		const message = error instanceof Error ? error.message : String(error);
		console.error(`${red}FAIL${reset} ${check.name}: ${message}`);
	}
}

if (failures > 0) {
	process.exitCode = 1;
}
