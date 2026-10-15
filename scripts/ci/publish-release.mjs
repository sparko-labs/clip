import { readdir, readFile, stat } from "node:fs/promises";
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

const contentTypes = {
	".json": "application/json",
	".dmg": "application/x-apple-diskimage",
	".exe": "application/vnd.microsoft.portable-executable",
	".gz": "application/gzip",
	".deb": "application/vnd.debian.binary-package",
	".AppImage": "application/octet-stream",
	".sig": "text/plain",
};

const trimSlashes = (value) => value.replace(/^\/+|\/+$/g, "");

export function objectKey(prefix, version, platform, file) {
	return [trimSlashes(prefix), version, platform, file]
		.filter((part) => part && part.length > 0)
		.join("/");
}

export async function collectAssets(assetsDirectory) {
	const platforms = [];
	for (const entry of await readdir(assetsDirectory, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const directory = path.join(assetsDirectory, entry.name);
		const files = (await readdir(directory)).sort();
		platforms.push({
			platform: entry.name,
			directory,
			files: files.map((file) => path.join(directory, file)),
		});
	}
	return platforms.sort((a, b) => a.platform.localeCompare(b.platform));
}

export async function buildManifest({
	assetsDirectory,
	version,
	baseUrl,
	prefix = "",
	notes,
}) {
	if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
		throw new Error(`"${version}" is not a semver version`);
	}
	if (!/^https:\/\//.test(baseUrl)) {
		throw new Error("The updates base URL must be https");
	}
	const manifest = { version, platforms: {} };
	if (notes) manifest.notes = notes;
	for (const { platform, files } of await collectAssets(assetsDirectory)) {
		if (!UPDATER_PLATFORMS.includes(platform)) continue;
		const family = platform.split("-")[0];
		const pattern = UPDATER_ARTIFACT[family];
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
		manifest.platforms[platform] = {
			url: `${baseUrl.replace(/\/+$/, "")}/${objectKey(prefix, version, platform, path.basename(artifact))}`,
			signature,
		};
	}
	if (Object.keys(manifest.platforms).length === 0) {
		throw new Error(`No updater artifacts found under ${assetsDirectory}`);
	}
	return manifest;
}

export async function publish({
	assetsDirectory,
	version,
	baseUrl,
	prefix = "",
	notes,
	channel = "stable",
	client,
	bucket,
}) {
	const manifest = await buildManifest({
		assetsDirectory,
		version,
		baseUrl,
		prefix,
		notes,
	});
	const { PutObjectCommand } = await import("@aws-sdk/client-s3");
	const put = async (key, body, contentType) => {
		await client.send(
			new PutObjectCommand({
				Bucket: bucket,
				Key: key,
				Body: body,
				ContentType: contentType,
			}),
		);
		console.log(`Uploaded ${key}`);
	};
	for (const { platform, files } of await collectAssets(assetsDirectory)) {
		for (const file of files) {
			if (!(await stat(file)).isFile()) continue;
			const name = path.basename(file);
			const type =
				contentTypes[path.extname(name)] ?? "application/octet-stream";
			await put(
				objectKey(prefix, version, platform, name),
				await readFile(file),
				type,
			);
		}
	}
	const manifestName =
		channel === "nightly" ? "manifest-nightly.json" : "manifest.json";
	await put(
		[trimSlashes(prefix), manifestName].filter(Boolean).join("/"),
		JSON.stringify(manifest, null, 2),
		"application/json",
	);
	return manifest;
}

async function main() {
	const env = process.env;
	const required = [
		"UPDATES_S3_BUCKET",
		"UPDATES_S3_ACCESS_KEY",
		"UPDATES_S3_SECRET_KEY",
		"UPDATES_BASE_URL",
		"RELEASE_VERSION",
	];
	const missing = required.filter((name) => !env[name]);
	if (missing.length > 0) {
		throw new Error(`Missing environment: ${missing.join(", ")}`);
	}
	const { S3Client } = await import("@aws-sdk/client-s3");
	const client = new S3Client({
		region: env.UPDATES_S3_REGION || "auto",
		endpoint: env.UPDATES_S3_ENDPOINT || undefined,
		forcePathStyle: env.UPDATES_S3_PATH_STYLE !== "false",
		credentials: {
			accessKeyId: env.UPDATES_S3_ACCESS_KEY,
			secretAccessKey: env.UPDATES_S3_SECRET_KEY,
		},
	});
	await publish({
		assetsDirectory: env.RELEASE_ASSETS_DIR || "release-assets",
		version: env.RELEASE_VERSION,
		baseUrl: env.UPDATES_BASE_URL,
		prefix: env.UPDATES_S3_PREFIX || "",
		notes: env.RELEASE_NOTES || undefined,
		channel: env.RELEASE_CHANNEL || "stable",
		client,
		bucket: env.UPDATES_S3_BUCKET,
	});
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
