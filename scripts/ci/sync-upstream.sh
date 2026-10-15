#!/usr/bin/env bash
set -euo pipefail

UPSTREAM_URL="${UPSTREAM_URL:-https://github.com/CapSoftware/Cap.git}"
CUSTOM_BRANCH="${CUSTOM_BRANCH:-custom}"
BASE_FILE="docs/UPSTREAM_BASE"
TAG_PATTERN='^cap-v[0-9]+\.[0-9]+\.[0-9]+$'
DISABLE_SUBJECT="chore: disable upstream workflows"

: "${GH_TOKEN:?Set GH_TOKEN to a token that can push branches and workflow files, open pull requests and issues}"
: "${GITHUB_REPOSITORY:?}"

git config user.name "${SYNC_GIT_NAME:-upstream-sync}"
git config user.email "${SYNC_GIT_EMAIL:-upstream-sync@users.noreply.github.com}"
git config rerere.enabled true
git config commit.gpgsign false

git remote remove upstream 2>/dev/null || true
git remote add upstream "$UPSTREAM_URL"
git fetch --quiet upstream --tags --prune
git fetch --quiet origin "$CUSTOM_BRANCH"

git checkout --quiet -B "$CUSTOM_BRANCH" "origin/${CUSTOM_BRANCH}"
OLD_BASE="$(tr -d '[:space:]' < "$BASE_FILE")"
git cat-file -e "${OLD_BASE}^{commit}"

TAG="$(git tag --list 'cap-v*' | grep -E "$TAG_PATTERN" | sort -V | tail -n1)"
if [[ -z "$TAG" ]]; then
	echo "No upstream release tag found."
	exit 0
fi
if git merge-base --is-ancestor "$TAG" "$OLD_BASE"; then
	echo "Already based on or past ${TAG}; nothing to do."
	exit 0
fi

BRANCH="sync/${TAG}"
if git ls-remote --exit-code --heads origin "$BRANCH" > /dev/null 2>&1; then
	echo "${BRANCH} already exists; waiting for it to be merged."
	exit 0
fi

git push origin "refs/remotes/upstream/main:refs/heads/main"

git checkout --quiet -B "$BRANCH" "$CUSTOM_BRANCH"
if [[ "$(git log -1 --format=%s)" == "$DISABLE_SUBJECT" ]]; then
	git reset --quiet --hard HEAD~1
fi
if ! git rebase --onto "$TAG" "$OLD_BASE" "$BRANCH"; then
	CONFLICTS="$(git diff --name-only --diff-filter=U | sed 's/^/- `/; s/$/`/')"
	git rebase --abort || true
	gh issue create --repo "$GITHUB_REPOSITORY" \
		--title "Upstream sync ${TAG} has conflicts" \
		--body "Rebasing \`${CUSTOM_BRANCH}\` onto upstream \`${TAG}\` conflicts in:

${CONFLICTS}

Upstream changes: https://github.com/CapSoftware/Cap/compare/${OLD_BASE}...${TAG}

Resolve locally: \`git checkout -b ${BRANCH} ${CUSTOM_BRANCH} && git rebase --onto ${TAG} ${OLD_BASE}\`, update docs/UPSTREAM_BASE, push, and open a pull request."
	echo "Conflicts recorded as an issue."
	exit 0
fi

git rev-parse "${TAG}^{commit}" > "$BASE_FILE"
git add "$BASE_FILE"
git commit --quiet -m "chore: record upstream base ${TAG}"
bash scripts/ci/disable-upstream-workflows.sh
git push origin "$BRANCH"

gh pr create --repo "$GITHUB_REPOSITORY" \
	--base "$CUSTOM_BRANCH" --head "$BRANCH" \
	--title "Sync upstream ${TAG}" \
	--body "Rebases \`${CUSTOM_BRANCH}\` onto upstream \`${TAG}\`. Follow docs/UPGRADING.md before merging."
echo "Opened pull request for ${TAG}."
