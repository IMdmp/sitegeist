declare module "ws" {
	import type { EventEmitter } from "node:events";
	import type { IncomingMessage } from "node:http";

	export default class WebSocket extends EventEmitter {
		static readonly OPEN: number;

		readonly readyState: number;

		constructor(url: string);

		send(data: string): void;
		close(code?: number, reason?: string): void;
	}

	export class WebSocketServer extends EventEmitter {
		constructor(options: { host?: string; port: number });

		on(event: "connection", listener: (socket: WebSocket, request: IncomingMessage) => void): this;
		on(event: "listening", listener: () => void): this;
		on(event: "error", listener: (error: Error) => void): this;
	}
}
