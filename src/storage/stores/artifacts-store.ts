import { Store, type StoreConfig } from "@earendil-works/pi-web-ui";

const ARTIFACTS_STORE = "artifacts";

/**
 * An artifact persisted independently of the session message history.
 *
 * Artifacts in pi-web-ui are normally reconstructed from a session's messages
 * (ArtifactsPanel.reconstructFromMessages). This store keeps a durable,
 * cross-session copy so they can be browsed, pinned, and downloaded from the
 * "Saved Artifacts" view even after the originating session is gone.
 */
export interface SavedArtifact {
	filename: string;
	content: string;
	sessionId: string;
	sessionTitle?: string;
	createdAt: string;
	updatedAt: string;
	pinned?: boolean;
}

/** In-memory shape emitted by ArtifactsPanel (createdAt/updatedAt are Dates). */
export interface LiveArtifact {
	filename: string;
	content: string;
	createdAt: Date;
	updatedAt: Date;
}

const UNSAVED_SESSION = "unsaved";

/**
 * Store for artifacts persisted across sessions. Keyed by
 * `${sessionId}::${filename}` so same-named artifacts from different sessions
 * stay distinct.
 */
export class ArtifactsStore extends Store {
	getConfig(): StoreConfig {
		return { name: ARTIFACTS_STORE };
	}

	private key(sessionId: string, filename: string): string {
		return `${sessionId}::${filename}`;
	}

	async get(sessionId: string, filename: string): Promise<SavedArtifact | null> {
		return this.getBackend().get<SavedArtifact>(ARTIFACTS_STORE, this.key(sessionId, filename));
	}

	async save(artifact: SavedArtifact): Promise<void> {
		await this.getBackend().set(ARTIFACTS_STORE, this.key(artifact.sessionId, artifact.filename), artifact);
	}

	async delete(sessionId: string, filename: string): Promise<void> {
		await this.getBackend().delete(ARTIFACTS_STORE, this.key(sessionId, filename));
	}

	async list(): Promise<SavedArtifact[]> {
		const keys = await this.getBackend().keys(ARTIFACTS_STORE);
		const artifacts = await Promise.all(
			keys.map((key) => this.getBackend().get<SavedArtifact>(ARTIFACTS_STORE, key)),
		);
		return artifacts
			.filter((a): a is SavedArtifact => a !== null)
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	}

	async listForSession(sessionId: string): Promise<SavedArtifact[]> {
		const keys = await this.getBackend().keys(ARTIFACTS_STORE, `${sessionId}::`);
		const artifacts = await Promise.all(
			keys.map((key) => this.getBackend().get<SavedArtifact>(ARTIFACTS_STORE, key)),
		);
		return artifacts.filter((a): a is SavedArtifact => a !== null);
	}

	async setPinned(sessionId: string, filename: string, pinned: boolean): Promise<void> {
		const existing = await this.get(sessionId, filename);
		if (!existing) return;
		await this.save({ ...existing, pinned });
	}

	async clearUnpinned(): Promise<void> {
		const all = await this.list();
		await Promise.all(all.filter((a) => !a.pinned).map((a) => this.delete(a.sessionId, a.filename)));
	}

	/**
	 * Reconcile the persisted copy of a session's artifacts with the live panel
	 * state: upsert everything currently present, and prune persisted artifacts
	 * for this session that the panel no longer has (deletions), except pinned ones.
	 */
	async syncSession(
		sessionId: string | undefined,
		live: Map<string, LiveArtifact>,
		sessionTitle?: string,
	): Promise<void> {
		const sid = sessionId || UNSAVED_SESSION;
		const now = new Date().toISOString();
		const liveNames = new Set(live.keys());

		for (const [filename, artifact] of live) {
			const existing = await this.get(sid, filename);
			await this.save({
				filename,
				content: artifact.content,
				sessionId: sid,
				sessionTitle: sessionTitle ?? existing?.sessionTitle,
				createdAt: existing?.createdAt ?? artifact.createdAt?.toISOString?.() ?? now,
				updatedAt: artifact.updatedAt?.toISOString?.() ?? now,
				pinned: existing?.pinned,
			});
		}

		// Prune persisted artifacts removed from the live panel (keep pinned).
		const persisted = await this.listForSession(sid);
		await Promise.all(
			persisted
				.filter((a) => !liveNames.has(a.filename) && !a.pinned)
				.map((a) => this.delete(a.sessionId, a.filename)),
		);
	}
}
