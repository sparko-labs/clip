import {
	copyFile,
	mkdir,
	readdir,
	readFile,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const UPDATER_PLATFORMS = [
	"darwin-aarch64",
	"darwin-x86_64",
	"windows-x86_64",
	"windows-aarch64",
	"linux-x86_64-deb",
	"linux-x86_64-appimage",
];

const UPDATER_ARTIFACT = {
	darwin: /\.app\.tar\.gz$/,
	windows: /\.exe$/,
	linux: /\.(?:deb|AppImage)$/,
};

export async function collectAssets(assetsDirectory) {
	const platforms = [];
	for (const entry of await readdir(assetsDirectory, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const directory = path.join(assetsDirectory, entry.name);
		const files = (await readdir(directory)).sort();
		platforms.push({
			platform: entry.name,
			files: files.map((file) => path.join(directory, file)),
		});
	}
	return platforms.sort((a, b) => a.platform.localeCompare(b.platform));
}

export async function buildManifest({
	assetsDirectory,
	version,
	urlFor,
	notes,
}) {
	if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
		throw new Error(`"${version}" is not a semver version`);
	}
	const manifest = { version, platforms: {} };
	if (notes) manifest.notes = notes;
	for (const { platform, files } of await collectAssets(assetsDirectory)) {
		if (!UPDATER_PLATFORMS.includes(platform)) continue;
		const pattern = UPDATER_ARTIFACT[platform.split("-")[0]];
		const artifacts = files.filter(
			(file) => pattern?.test(file) && !file.endsWith(".sig"),
		);
		if (artifacts.length !== 1) {
			throw new Error(
				`${platform} must contain exactly one updater artifact, found ${artifacts.length}`,
			);
		}
		const artifact = artifacts[0];
		const signatureFile = `${artifact}.sig`;
		const signature = (
			await readFile(signatureFile, "utf8").catch(() => "")
		).trim();
		if (!signature) throw new Error(`${signatureFile} is missing or empty`);
		const url = urlFor({ platform, file: path.basename(artifact), version });
		if (!/^https:\/\//.test(url)) {
			throw new Error(`Updater URL for ${platform} must be https: ${url}`);
		}
		manifest.platforms[platform] = { url, signature };
	}
	if (Object.keys(manifest.platforms).length === 0) {
		throw new Error(`No updater artifacts found under ${assetsDirectory}`);
	}
	return manifest;
}

export async function stageRelease({
	assetsDirectory,
	outputDirectory,
	version,
	urlFor,
	notes,
}) {
	const manifest = await buildManifest({
		assetsDirectory,
		version,
		urlFor,
		notes,
	});
	await mkdir(outputDirectory, { recursive: true });
	const seen = new Map();
	for (const { platform, files } of await collectAssets(assetsDirectory)) {
		for (const file of files) {
			const name = path.basename(file);
			if (seen.has(name)) {
				throw new Error(
					`Release asset name "${name}" appears in ${seen.get(name)} and ${platform}`,
				);
			}
			seen.set(name, platform);
			await copyFile(file, path.join(outputDirectory, name));
		}
	}
	await writeFile(
		path.join(outputDirectory, "manifest.json"),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);
	return manifest;
}

export function githubReleaseUrl({ repository, tag }) {
	return ({ file }) =>
		`https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(file)}`;
}

async function main() {
	const {
		GITHUB_REPOSITORY,
		RELEASE_TAG,
		RELEASE_ASSETS_DIR,
		RELEASE_OUT_DIR,
	} = process.env;
	if (!GITHUB_REPOSITORY || !RELEASE_TAG) {
		throw new Error("GITHUB_REPOSITORY and RELEASE_TAG are required");
	}
	const version = RELEASE_TAG.replace(/^desktop-v/, "");
	const manifest = await stageRelease({
		assetsDirectory: RELEASE_ASSETS_DIR || "release-assets",
		outputDirectory: RELEASE_OUT_DIR || "release-upload",
		version,
		urlFor: githubReleaseUrl({
			repository: GITHUB_REPOSITORY,
			tag: RELEASE_TAG,
		}),
		notes: process.env.RELEASE_NOTES || undefined,
	});
	console.log(JSON.stringify(manifest, null, 2));
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	main().catch((error) => {
		console.error(error?.message ?? error);
		process.exitCode = 1;
	});
}
