import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildManifest, objectKey, publish } from "./publish-release.mjs";

async function fixture(layout) {
	const root = await mkdtemp(path.join(tmpdir(), "release-assets-"));
	for (const [file, contents] of Object.entries(layout)) {
		const target = path.join(root, file);
		await mkdir(path.dirname(target), { recursive: true });
		await writeFile(target, contents);
	}
	return root;
}

const common = {
	version: "0.6.2",
	baseUrl: "https://updates.example/cap/",
	prefix: "desktop",
};

test("object keys skip empty segments", () => {
	assert.equal(
		objectKey("/desktop/", "0.6.2", "darwin-aarch64", "App.app.tar.gz"),
		"desktop/0.6.2/darwin-aarch64/App.app.tar.gz",
	);
	assert.equal(objectKey("", "0.6.2", "p", "f"), "0.6.2/p/f");
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
		...common,
		assetsDirectory,
		notes: "Fixes",
	});
	assert.deepEqual(manifest, {
		version: "0.6.2",
		notes: "Fixes",
		platforms: {
			"darwin-aarch64": {
				url: "https://updates.example/cap/desktop/0.6.2/darwin-aarch64/App.app.tar.gz",
				signature: "sig-mac",
			},
			"windows-x86_64": {
				url: "https://updates.example/cap/desktop/0.6.2/windows-x86_64/App_0.6.2_x64-setup.exe",
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
		buildManifest({ ...common, assetsDirectory }),
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
		buildManifest({ ...common, assetsDirectory }),
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
			...common,
			assetsDirectory,
			baseUrl: "http://updates.example",
		}),
		/https/,
	);
	await assert.rejects(
		buildManifest({ ...common, assetsDirectory, version: "latest" }),
		/semver/,
	);
});

test("publishing uploads every asset before the manifest", async () => {
	const assetsDirectory = await fixture({
		"darwin-aarch64/App.app.tar.gz": "tar",
		"darwin-aarch64/App.app.tar.gz.sig": "s",
		"dmg/App.dmg": "dmg",
	});
	const sent = [];
	const client = { send: async (command) => sent.push(command.input) };
	await publish({
		...common,
		assetsDirectory,
		client,
		bucket: "updates",
	});
	const keys = sent.map((input) => input.Key);
	assert.equal(keys.at(-1), "desktop/manifest.json");
	assert.ok(keys.includes("desktop/0.6.2/dmg/App.dmg"));
	assert.ok(keys.includes("desktop/0.6.2/darwin-aarch64/App.app.tar.gz"));
	assert.ok(sent.every((input) => input.Bucket === "updates"));
});

test("nightly publishes a separate manifest", async () => {
	const assetsDirectory = await fixture({
		"linux-x86_64-deb/cap.deb": "deb",
		"linux-x86_64-deb/cap.deb.sig": "s",
	});
	const sent = [];
	await publish({
		...common,
		assetsDirectory,
		channel: "nightly",
		client: { send: async (command) => sent.push(command.input) },
		bucket: "updates",
	});
	assert.equal(sent.at(-1).Key, "desktop/manifest-nightly.json");
});
