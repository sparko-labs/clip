import { z } from "zod";

const PLATFORM_PATTERN =
	/^(?:darwin-(?:aarch64|x86_64)|windows-(?:aarch64|x86_64)|linux-(?:aarch64|x86_64)-(?:deb|appimage))$/;

const platformEntrySchema = z.object({
	url: z.string().url().startsWith("https://"),
	signature: z.string().min(1),
});

export const updateManifestSchema = z.object({
	version: z.string().min(1),
	notes: z.string().optional(),
	platforms: z.record(platformEntrySchema),
});

export type UpdateManifest = z.infer<typeof updateManifestSchema>;

export const isSupportedPlatform = (platform: string) =>
	PLATFORM_PATTERN.test(platform);

type ParsedVersion = {
	core: [number, number, number];
	prerelease: string[];
};

const parseVersion = (value: string): ParsedVersion | null => {
	const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(
		value.trim(),
	);
	if (!match) return null;
	return {
		core: [Number(match[1]), Number(match[2]), Number(match[3])],
		prerelease: match[4] ? match[4].split(".") : [],
	};
};

const comparePrerelease = (a: string[], b: string[]) => {
	if (a.length === 0 && b.length === 0) return 0;
	if (a.length === 0) return 1;
	if (b.length === 0) return -1;
	for (let index = 0; index < Math.max(a.length, b.length); index++) {
		const left = a[index];
		const right = b[index];
		if (left === undefined) return -1;
		if (right === undefined) return 1;
		const leftNumeric = /^\d+$/.test(left);
		const rightNumeric = /^\d+$/.test(right);
		if (leftNumeric && rightNumeric) {
			const difference = Number(left) - Number(right);
			if (difference !== 0) return difference < 0 ? -1 : 1;
		} else if (leftNumeric !== rightNumeric) {
			return leftNumeric ? -1 : 1;
		} else if (left !== right) {
			return left < right ? -1 : 1;
		}
	}
	return 0;
};

export function compareVersions(a: string, b: string): number | null {
	const left = parseVersion(a);
	const right = parseVersion(b);
	if (!left || !right) return null;
	for (let index = 0; index < 3; index++) {
		const difference = (left.core[index] ?? 0) - (right.core[index] ?? 0);
		if (difference !== 0) return difference < 0 ? -1 : 1;
	}
	return comparePrerelease(left.prerelease, right.prerelease);
}

export function selectUpdate(
	manifest: UpdateManifest,
	platform: string,
	currentVersion: string,
) {
	if (!isSupportedPlatform(platform)) return null;
	const entry = manifest.platforms[platform];
	if (!entry) return null;
	const comparison = compareVersions(manifest.version, currentVersion);
	if (comparison === null || comparison <= 0) return null;
	return {
		version: manifest.version,
		url: entry.url,
		signature: entry.signature,
		...(manifest.notes ? { notes: manifest.notes } : {}),
	};
}
