import { Store, type StoreConfig } from "@earendil-works/pi-web-ui";

const MEMORIES_STORE = "memories";

export type MemorySource = "user" | "agent";

/**
 * A durable fact the assistant remembers across sessions (user preferences,
 * recurring context, project constraints). Surfaced as a compact index in the
 * system prompt; full content is fetched on demand via the `memory` tool.
 */
export interface Memory {
	id: string;
	title: string;
	content: string;
	tags: string[];
	source: MemorySource;
	createdAt: string;
	updatedAt: string;
}

export interface SaveMemoryInput {
	id?: string;
	title: string;
	content: string;
	tags?: string[];
	source?: MemorySource;
}

/** One line per memory for cheap system-prompt injection. */
export interface MemoryIndexEntry {
	id: string;
	title: string;
}

export class MemoryStore extends Store {
	getConfig(): StoreConfig {
		return { name: MEMORIES_STORE };
	}

	async get(id: string): Promise<Memory | null> {
		return this.getBackend().get<Memory>(MEMORIES_STORE, id);
	}

	async list(): Promise<Memory[]> {
		const keys = await this.getBackend().keys(MEMORIES_STORE);
		const memories = await Promise.all(keys.map((key) => this.getBackend().get<Memory>(MEMORIES_STORE, key)));
		return memories.filter((m): m is Memory => m !== null).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	}

	async save(input: SaveMemoryInput): Promise<Memory> {
		const now = new Date().toISOString();
		const existing = input.id ? await this.get(input.id) : null;
		const memory: Memory = {
			id: existing?.id ?? input.id ?? crypto.randomUUID(),
			title: input.title,
			content: input.content,
			tags: input.tags ?? existing?.tags ?? [],
			source: input.source ?? existing?.source ?? "agent",
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
		};
		await this.getBackend().set(MEMORIES_STORE, memory.id, memory);
		return memory;
	}

	async delete(id: string): Promise<void> {
		await this.getBackend().delete(MEMORIES_STORE, id);
	}

	async search(query: string): Promise<Memory[]> {
		const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
		if (tokens.length === 0) return this.list();
		const all = await this.list();
		return all.filter((m) => {
			const haystack = `${m.title} ${m.content} ${m.tags.join(" ")}`.toLowerCase();
			return tokens.every((t) => haystack.includes(t));
		});
	}

	/** Compact index (id + title) for injecting into the system prompt. */
	async getIndex(): Promise<MemoryIndexEntry[]> {
		const all = await this.list();
		return all.map((m) => ({ id: m.id, title: m.title }));
	}
}
