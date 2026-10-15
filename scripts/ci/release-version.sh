#!/usr/bin/env bash
set -euo pipefail

tag="${CI_COMMIT_TAG:-}"
if [[ "$tag" =~ ^desktop-v([0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?)$ ]]; then
	echo "${BASH_REMATCH[1]}"
	exit 0
fi

base="$(node -e '
	const toml = require("fs").readFileSync("apps/desktop/src-tauri/Cargo.toml", "utf8");
	process.stdout.write(/^version = "(.*)"$/m.exec(toml)[1]);
')"
echo "${base}-ci.${CI_PIPELINE_IID:-0}"
