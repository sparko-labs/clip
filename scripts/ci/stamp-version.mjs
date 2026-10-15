import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
	console.error("Usage: node scripts/ci/stamp-version.mjs <semver>");
	process.exit(1);
}

const manifest = "apps/desktop/src-tauri/Cargo.toml";
const pattern = /^version = ".*"$/m;
const toml = readFileSync(manifest, "utf8");
if (!pattern.test(toml)) {
	console.error(`package.version line not found in ${manifest}`);
	process.exit(1);
}
writeFileSync(manifest, toml.replace(pattern, `version = "${version}"`));
console.log(`Stamped ${manifest} with ${version}`);

const sync = spawnSync("node", ["scripts/sync-desktop-versions.mjs"], {
	stdio: "inherit",
});
process.exit(sync.status ?? 1);
