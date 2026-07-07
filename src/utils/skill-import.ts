import type { Skill } from "../storage/stores/skills-store.js";

export interface SkillValidationResult {
	valid: boolean;
	error?: string;
}

export type SkillLibraryValidator = (code: string) => Promise<SkillValidationResult>;

const requiredSkillStringFields = [
	"name",
	"shortDescription",
	"description",
	"createdAt",
	"lastUpdated",
	"examples",
	"library",
] as const;

export async function parseAndValidateSkillsJson(
	jsonText: string,
	validateLibrary: SkillLibraryValidator,
): Promise<Skill[]> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(jsonText);
	} catch (error) {
		throw new Error(`Invalid JSON: ${(error as Error).message}`);
	}

	const rawSkills = Array.isArray(parsed) ? parsed : [parsed];
	if (rawSkills.length === 0) {
		throw new Error("Invalid skills file: expected at least one skill");
	}

	const seenNames = new Set<string>();
	const skills: Skill[] = [];

	for (const [index, rawSkill] of rawSkills.entries()) {
		const skill = readSkill(rawSkill, index);
		if (seenNames.has(skill.name)) {
			throw new Error(`Invalid skills file: duplicate skill name "${skill.name}"`);
		}
		seenNames.add(skill.name);

		const validation = await validateLibrary(skill.library);
		if (!validation.valid) {
			throw new Error(`Invalid library code in "${skill.name}": ${validation.error || "Unknown error"}`);
		}

		skills.push(skill);
	}

	return skills;
}

function readSkill(value: unknown, index: number): Skill {
	if (!isRecord(value)) {
		throw new Error(`Invalid skill at index ${index}: expected an object`);
	}

	const name = readString(value, "name", index);
	const shortDescription = readString(value, "shortDescription", index);
	const description = readString(value, "description", index);
	const createdAt = readString(value, "createdAt", index);
	const lastUpdated = readString(value, "lastUpdated", index);
	const examples = readString(value, "examples", index);
	const library = readString(value, "library", index);

	if (!Array.isArray(value.domainPatterns) || !value.domainPatterns.every((pattern) => typeof pattern === "string")) {
		throw new Error(`Invalid skill at index ${index}: expected "domainPatterns" to be an array of strings`);
	}

	if (name.trim().length === 0) {
		throw new Error(`Invalid skill at index ${index}: expected "name" to be non-empty`);
	}

	if (value.domainPatterns.length === 0) {
		throw new Error(`Invalid skill "${name}": expected at least one domain pattern`);
	}

	return {
		name,
		domainPatterns: [...value.domainPatterns],
		shortDescription,
		description,
		createdAt,
		lastUpdated,
		examples,
		library,
	};
}

function readString(
	value: Record<string, unknown>,
	field: (typeof requiredSkillStringFields)[number],
	index: number,
): string {
	if (typeof value[field] !== "string") {
		throw new Error(`Invalid skill at index ${index}: expected "${field}" to be a string`);
	}
	return value[field];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
