import { describe, expect, it } from "vitest";
import {
	compareVersions,
	isSupportedPlatform,
	selectUpdate,
	type UpdateManifest,
	updateManifestSchema,
} from "@/lib/desktop-updates";

const manifest: UpdateManifest = {
	version: "0.6.2",
	notes: "Fixes",
	platforms: {
		"darwin-aarch64": {
			url: "https://updates.example/Cap_0.6.2_aarch64.app.tar.gz",
			signature: "c2ln",
		},
		"windows-x86_64": {
			url: "https://updates.example/Cap_0.6.2_x64-setup.exe",
			signature: "c2ln",
		},
	},
};

describe("compareVersions", () => {
	it.each([
		["0.6.2", "0.6.1", 1],
		["0.6.1", "0.6.2", -1],
		["0.6.1", "0.6.1", 0],
		["1.0.0", "0.99.99", 1],
		["0.6.2-nightly.202610100314", "0.6.2", -1],
		["0.6.2", "0.6.2-nightly.202610100314", 1],
		["0.6.2-nightly.202610101017", "0.6.2-nightly.202610100314", 1],
		["0.6.10", "0.6.9", 1],
		["v0.6.2", "0.6.2", 0],
	])("compares %s with %s", (a, b, expected) => {
		expect(compareVersions(a, b)).toBe(expected);
	});

	it("rejects versions it cannot parse", () => {
		expect(compareVersions("latest", "0.6.1")).toBeNull();
		expect(compareVersions("0.6", "0.6.1")).toBeNull();
	});
});

describe("selectUpdate", () => {
	it("offers a newer version for a published platform", () => {
		expect(selectUpdate(manifest, "darwin-aarch64", "0.6.1")).toEqual({
			version: "0.6.2",
			url: "https://updates.example/Cap_0.6.2_aarch64.app.tar.gz",
			signature: "c2ln",
			notes: "Fixes",
		});
	});

	it("offers nothing when already current or ahead", () => {
		expect(selectUpdate(manifest, "darwin-aarch64", "0.6.2")).toBeNull();
		expect(selectUpdate(manifest, "darwin-aarch64", "0.7.0")).toBeNull();
	});

	it("offers nothing for unpublished or unknown platforms", () => {
		expect(selectUpdate(manifest, "darwin-x86_64", "0.6.1")).toBeNull();
		expect(selectUpdate(manifest, "plan9-mips", "0.6.1")).toBeNull();
		expect(selectUpdate(manifest, "../etc/passwd", "0.6.1")).toBeNull();
	});

	it("offers nothing when the client version is unparseable", () => {
		expect(selectUpdate(manifest, "darwin-aarch64", "dev")).toBeNull();
	});

	it("omits notes when the manifest has none", () => {
		const { notes: _notes, ...withoutNotes } = manifest;
		expect(
			selectUpdate(withoutNotes, "windows-x86_64", "0.6.1"),
		).not.toHaveProperty("notes");
	});
});

describe("updateManifestSchema", () => {
	it("rejects non-https artifact URLs", () => {
		const result = updateManifestSchema.safeParse({
			version: "0.6.2",
			platforms: {
				"darwin-aarch64": { url: "http://updates.example/a", signature: "x" },
			},
		});
		expect(result.success).toBe(false);
	});

	it("recognizes the platforms the desktop reports", () => {
		for (const platform of [
			"darwin-aarch64",
			"darwin-x86_64",
			"windows-x86_64",
			"windows-aarch64",
			"linux-x86_64-deb",
			"linux-x86_64-appimage",
		]) {
			expect(isSupportedPlatform(platform)).toBe(true);
		}
		expect(isSupportedPlatform("linux-x86_64")).toBe(false);
	});
});
