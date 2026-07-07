import { Store, type StoreConfig } from "@earendil-works/pi-web-ui";
import { minimatch } from "minimatch";

const SKILL_VERSIONS_STORE = "skill_versions";
const SKILL_HISTORY_LIMIT = 10;

export interface Skill {
	name: string;
	domainPatterns: string[];
	shortDescription: string;
	description: string;
	createdAt: string;
	lastUpdated: string;
	examples: string;
	library: string;
}

export type SkillHistorySource = "user" | "agent";

export interface SkillVersionSnapshot {
	id: string;
	skillName: string;
	createdAt: string;
	source: SkillHistorySource;
	skill: Skill;
}

export interface SaveSkillOptions {
	source?: SkillHistorySource;
	snapshot?: boolean;
}

/**
 * Store for managing site skills.
 */
export class SkillsStore extends Store {
	private lastSnapshotMs = 0;

	getConfig(): StoreConfig {
		return {
			name: "skills",
		};
	}

	static getVersionsConfig(): StoreConfig {
		return {
			name: SKILL_VERSIONS_STORE,
		};
	}

	async get(name: string): Promise<Skill | null> {
		return this.getBackend().get("skills", name);
	}

	async save(skill: Skill, options: SaveSkillOptions = {}): Promise<void> {
		const existing = await this.get(skill.name);
		await this.getBackend().set("skills", skill.name, skill);

		if (options.snapshot === false || !this.hasContentChanged(existing, skill)) {
			return;
		}

		await this.addHistorySnapshot(skill, options.source ?? "user");
	}

	async delete(name: string): Promise<void> {
		await this.getBackend().delete("skills", name);
	}

	async list(currentUrl?: string): Promise<Skill[]> {
		const keys = await this.getBackend().keys("skills");
		const skills = await Promise.all(keys.map((key) => this.getBackend().get<Skill>("skills", key)));
		const validSkills = skills.filter((s): s is Skill => s !== null);

		if (currentUrl) {
			return validSkills.filter((skill) => this.matchesAnyPattern(currentUrl, skill.domainPatterns));
		}

		return validSkills;
	}

	async getForUrl(url: string): Promise<Skill[]> {
		return this.list(url);
	}

	// Alias methods for backward compatibility
	async getSkillsForUrl(url: string): Promise<Skill[]> {
		return this.getForUrl(url);
	}

	async getSkill(name: string): Promise<Skill | null> {
		return this.get(name);
	}

	async saveSkill(skill: Skill, options: SaveSkillOptions = {}): Promise<void> {
		return this.save(skill, options);
	}

	async deleteSkill(name: string): Promise<void> {
		return this.delete(name);
	}

	async listSkills(currentUrl?: string): Promise<Skill[]> {
		return this.list(currentUrl);
	}

	async getHistory(skillName: string): Promise<SkillVersionSnapshot[]> {
		const keys = await this.getBackend().keys(SKILL_VERSIONS_STORE, this.historyKeyPrefix(skillName));
		const snapshots = await Promise.all(
			keys.map((key) => this.getBackend().get<SkillVersionSnapshot>(SKILL_VERSIONS_STORE, key)),
		);

		return snapshots
			.filter((snapshot): snapshot is SkillVersionSnapshot => snapshot !== null)
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}

	async restoreVersion(skillName: string, snapshotId: string, source: SkillHistorySource = "user"): Promise<Skill> {
		const history = await this.getHistory(skillName);
		const snapshot = history.find((item) => item.id === snapshotId);
		if (!snapshot) {
			throw new Error(`Skill history snapshot '${snapshotId}' not found.`);
		}

		const restored: Skill = {
			...snapshot.skill,
			name: skillName,
			lastUpdated: new Date().toISOString(),
		};
		await this.save(restored, { source });
		return restored;
	}

	/**
	 * Check if URL matches any of the domain patterns using glob matching.
	 */
	matchesAnyPattern(url: string, patterns: string[]): boolean {
		try {
			const urlObj = new URL(url);
			const hostname = urlObj.hostname;
			const path = urlObj.pathname;

			for (const pattern of patterns) {
				const parts = pattern.split("/");
				const domainPattern = parts[0];
				const pathPattern = parts.length > 1 ? `/${parts.slice(1).join("/")}` : "";

				const normalizedHostname = hostname.replace(/^www\./, "");
				const normalizedPattern = domainPattern.replace(/^www\./, "");

				const domainMatches = minimatch(normalizedHostname, normalizedPattern, {
					nocase: true,
				});

				if (!pathPattern || pathPattern === "/") {
					if (domainMatches) return true;
				} else {
					const pathMatches = minimatch(path, pathPattern, { nocase: true });
					if (domainMatches && pathMatches) return true;
				}
			}

			return false;
		} catch {
			return false;
		}
	}

	private async addHistorySnapshot(skill: Skill, source: SkillHistorySource): Promise<void> {
		const createdAt = this.createSnapshotTimestamp();
		const id = this.createSnapshotId(createdAt);
		const snapshot: SkillVersionSnapshot = {
			id,
			skillName: skill.name,
			createdAt,
			source,
			skill: { ...skill, domainPatterns: [...skill.domainPatterns] },
		};

		await this.getBackend().set(SKILL_VERSIONS_STORE, this.historyKey(skill.name, id), snapshot);
		await this.pruneHistory(skill.name);
	}

	private async pruneHistory(skillName: string): Promise<void> {
		const history = await this.getHistory(skillName);
		const snapshotsToDelete = history.slice(SKILL_HISTORY_LIMIT);
		await Promise.all(
			snapshotsToDelete.map((snapshot) =>
				this.getBackend().delete(SKILL_VERSIONS_STORE, this.historyKey(skillName, snapshot.id)),
			),
		);
	}

	private hasContentChanged(existing: Skill | null, next: Skill): boolean {
		if (!existing) {
			return true;
		}

		return (
			existing.name !== next.name ||
			existing.shortDescription !== next.shortDescription ||
			existing.description !== next.description ||
			existing.examples !== next.examples ||
			existing.library !== next.library ||
			existing.domainPatterns.length !== next.domainPatterns.length ||
			existing.domainPatterns.some((pattern, index) => pattern !== next.domainPatterns[index])
		);
	}

	private historyKeyPrefix(skillName: string): string {
		return `${encodeURIComponent(skillName)}::`;
	}

	private historyKey(skillName: string, snapshotId: string): string {
		return `${this.historyKeyPrefix(skillName)}${snapshotId}`;
	}

	private createSnapshotId(createdAt: string): string {
		const entropy = Math.random().toString(36).slice(2);
		return `${createdAt}::${entropy}`;
	}

	private createSnapshotTimestamp(): string {
		const nextMs = Math.max(Date.now(), this.lastSnapshotMs + 1);
		this.lastSnapshotMs = nextMs;
		return new Date(nextMs).toISOString();
	}
}
