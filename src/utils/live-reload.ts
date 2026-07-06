// Dev mode hot reload - check if we're in development
let reloadScheduled = false;

const connectWebSocket = () => {
	try {
		const ws = new WebSocket("ws://localhost:8765");

		ws.onopen = () => {
			console.log("[HotReload] Connected to dev server");
		};

		ws.onmessage = (event) => {
			const data = JSON.parse(event.data);
			if (data.type === "reload" && !reloadScheduled) {
				reloadScheduled = true;
				console.log("[HotReload] Reloading extension page...");
				window.setTimeout(() => window.location.reload(), 50);
			}
		};

		ws.onerror = () => {
			// Silent fail - dev server might not be running
		};

		ws.onclose = () => {
			// Reconnect after 2 seconds
			setTimeout(connectWebSocket, 2000);
		};
	} catch (_e) {
		// Silent fail if WebSocket not available
	}
};
connectWebSocket();
