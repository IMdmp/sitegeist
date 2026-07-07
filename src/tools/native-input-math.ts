export interface NativeInputPoint {
	x: number;
	y: number;
}

export function computeDragPath(fromPx: NativeInputPoint, toPx: NativeInputPoint, steps: number): NativeInputPoint[] {
	const normalizedSteps = Math.max(0, Math.trunc(steps));
	const segmentCount = normalizedSteps + 1;
	const path: NativeInputPoint[] = [];

	for (let index = 0; index <= segmentCount; index++) {
		const t = index / segmentCount;
		path.push({
			x: fromPx.x + (toPx.x - fromPx.x) * t,
			y: fromPx.y + (toPx.y - fromPx.y) * t,
		});
	}

	return path;
}
