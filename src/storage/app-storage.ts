import {
	AppStorage as BaseAppStorage,
	CustomProvidersStore,
	getAppStorage,
	IndexedDBStorageBackend,
	ProviderKeysStore,
	SessionsStore,
	SettingsStore,
} from "@earendil-works/pi-web-ui";
import { ArtifactsStore } from "./stores/artifacts-store.js";
import { CostStore } from "./stores/cost-store.js";
import { MemoryStore } from "./stores/memory-store.js";
import { SitegeistSessionsStore } from "./stores/sessions-store.js";
import { SkillsStore } from "./stores/skills-store.js";

/**
 * Extended AppStorage with skills, memories, artifacts, and cost stores.
 */
export class SitegeistAppStorage extends BaseAppStorage {
	readonly skills: SkillsStore;
	readonly costs: CostStore;
	readonly artifacts: ArtifactsStore;
	readonly memories: MemoryStore;

	constructor() {
		// 1. Create all stores (no backend yet)
		const settings = new SettingsStore();
		const providerKeys = new ProviderKeysStore();
		const sessions = new SitegeistSessionsStore();
		const customProviders = new CustomProvidersStore();
		const skills = new SkillsStore();
		const costs = new CostStore();
		const artifacts = new ArtifactsStore();
		const memories = new MemoryStore();

		// 2. Gather configs from all stores
		const configs = [
			settings.getConfig(),
			SessionsStore.getMetadataConfig(),
			providerKeys.getConfig(),
			customProviders.getConfig(),
			sessions.getConfig(),
			skills.getConfig(),
			SkillsStore.getVersionsConfig(),
			costs.getConfig(),
			artifacts.getConfig(),
			memories.getConfig(),
		];

		// 3. Create backend with all configs
		const backend = new IndexedDBStorageBackend({
			dbName: "sitegeist-storage",
			version: 5, // v5: add artifacts + memories stores
			stores: configs,
		});

		// 4. Wire backend to all stores
		settings.setBackend(backend);
		providerKeys.setBackend(backend);
		customProviders.setBackend(backend);
		sessions.setBackend(backend);
		skills.setBackend(backend);
		costs.setBackend(backend);
		artifacts.setBackend(backend);
		memories.setBackend(backend);

		// 5. Pass base stores to parent
		super(settings, providerKeys, sessions, customProviders, backend);

		// 6. Store references to extension-specific stores
		this.skills = skills;
		this.costs = costs;
		this.artifacts = artifacts;
		this.memories = memories;
	}
}

/**
 * Helper to get typed extension storage.
 */
export function getSitegeistStorage(): SitegeistAppStorage {
	return getAppStorage() as SitegeistAppStorage;
}
