import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
	buildManifest,
	githubReleaseUrl,
	stageRelease,
} from "./release-manifest.mjs";

async function fixture(layout) {
	const root = await mkdtemp(path.join(tmpdir(), "release-assets-"));
	for (const [file, contents] of Object.entries(layout)) {
		const target = path.join(root, file);
		await mkdir(path.dirname(target), { recursive: true });
		await writeFile(target, contents);
	}
	return root;
}

const urlFor = githubReleaseUrl({
	repository: "SparkoSol/clip",
	tag: "desktop-v0.6.2",
});

test("release urls point at the tag's assets", () => {
	assert.equal(
		urlFor({ file: "ClipSpark_0.6.2_x64-setup.exe" }),
		"https://github.com/SparkoSol/clip/releases/download/desktop-v0.6.2/ClipSpark_0.6.2_x64-setup.exe",
	);
});

test("the manifest lists one signed artifact per updater platform", async () => {
	const assetsDirectory = await fixture({
		"darwin-aarch64/App.app.tar.gz": "tar",
		"darwin-aarch64/App.app.tar.gz.sig": "sig-mac\n",
		"windows-x86_64/App_0.6.2_x64-setup.exe": "exe",
		"windows-x86_64/App_0.6.2_x64-setup.exe.sig": "sig-win",
		"dmg/App.dmg": "dmg",
	});
	const manifest = await buildManifest({
		assetsDirectory,
		version: "0.6.2",
		urlFor,
		notes: "Fixes",
	});
	assert.deepEqual(manifest, {
		version: "0.6.2",
		notes: "Fixes",
		platforms: {
			"darwin-aarch64": {
				url: "https://github.com/SparkoSol/clip/releases/download/desktop-v0.6.2/App.app.tar.gz",
				signature: "sig-mac",
			},
			"windows-x86_64": {
				url: "https://github.com/SparkoSol/clip/releases/download/desktop-v0.6.2/App_0.6.2_x64-setup.exe",
				signature: "sig-win",
			},
		},
	});
});

test("a missing signature refuses to publish", async () => {
	const assetsDirectory = await fixture({
		"darwin-aarch64/App.app.tar.gz": "tar",
	});
	await assert.rejects(
		buildManifest({ assetsDirectory, version: "0.6.2", urlFor }),
		/missing or empty/,
	);
});

test("an ambiguous platform directory refuses to publish", async () => {
	const assetsDirectory = await fixture({
		"windows-x86_64/a-setup.exe": "a",
		"windows-x86_64/a-setup.exe.sig": "s",
		"windows-x86_64/b-setup.exe": "b",
		"windows-x86_64/b-setup.exe.sig": "s",
	});
	await assert.rejects(
		buildManifest({ assetsDirectory, version: "0.6.2", urlFor }),
		/exactly one updater artifact/,
	);
});

test("only https urls and semver versions are accepted", async () => {
	const assetsDirectory = await fixture({
		"darwin-aarch64/App.app.tar.gz": "tar",
		"darwin-aarch64/App.app.tar.gz.sig": "s",
	});
	await assert.rejects(
		buildManifest({
			assetsDirectory,
			version: "0.6.2",
			urlFor: ({ file }) => `http://example.test/${file}`,
		}),
		/must be https/,
	);
	await assert.rejects(
		buildManifest({ assetsDirectory, version: "latest", urlFor }),
		/semver/,
	);
});

test("staging flattens assets beside the manifest", async () => {
	const assetsDirectory = await fixture({
		"darwin-aarch64/App.app.tar.gz": "tar",
		"darwin-aarch64/App.app.tar.gz.sig": "s",
		"dmg/App.dmg": "dmg",
	});
	const outputDirectory = await mkdtemp(path.join(tmpdir(), "release-out-"));
	await stageRelease({
		assetsDirectory,
		outputDirectory,
		version: "0.6.2",
		urlFor,
	});
	assert.deepEqual((await readdir(outputDirectory)).sort(), [
		"App.app.tar.gz",
		"App.app.tar.gz.sig",
		"App.dmg",
		"manifest.json",
	]);
	const manifest = JSON.parse(
		await readFile(path.join(outputDirectory, "manifest.json"), "utf8"),
	);
	assert.equal(manifest.version, "0.6.2");
});

test("duplicate asset names across platforms refuse to stage", async () => {
	const assetsDirectory = await fixture({
		"darwin-aarch64/App.app.tar.gz": "tar",
		"darwin-aarch64/App.app.tar.gz.sig": "s",
		"dmg/App.app.tar.gz": "dup",
	});
	const outputDirectory = await mkdtemp(path.join(tmpdir(), "release-out-"));
	await assert.rejects(
		stageRelease({
			assetsDirectory,
			outputDirectory,
			version: "0.6.2",
			urlFor,
		}),
		/appears in/,
	);
});
