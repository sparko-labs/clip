#!/usr/bin/env bash
set -euo pipefail

UPSTREAM_URL="${UPSTREAM_URL:-https://github.com/CapSoftware/Cap.git}"
CUSTOM_BRANCH="${CUSTOM_BRANCH:-custom}"
BASE_FILE="docs/UPSTREAM_BASE"
TAG_PATTERN='^cap-v[0-9]+\.[0-9]+\.[0-9]+$'

: "${SYNC_TOKEN:?Set SYNC_TOKEN to a project access token with api and write_repository}"
: "${CI_SERVER_HOST:?}" "${CI_PROJECT_PATH:?}" "${CI_API_V4_URL:?}" "${CI_PROJECT_ID:?}"

api() {
	local method="$1" path="$2"
	shift 2
	curl -fsS --request "$method" --header "PRIVATE-TOKEN: ${SYNC_TOKEN}" \
		"${CI_API_V4_URL}/projects/${CI_PROJECT_ID}${path}" "$@"
}

git config user.name "${SYNC_GIT_NAME:-upstream-sync}"
git config user.email "${SYNC_GIT_EMAIL:-upstream-sync@${CI_SERVER_HOST}}"
git config rerere.enabled true
git config commit.gpgsign false

git remote remove sync-origin 2>/dev/null || true
git remote add sync-origin "https://oauth2:${SYNC_TOKEN}@${CI_SERVER_HOST}/${CI_PROJECT_PATH}.git"
git remote remove upstream 2>/dev/null || true
git remote add upstream "$UPSTREAM_URL"

git fetch --quiet upstream --tags --prune
git fetch --quiet sync-origin "$CUSTOM_BRANCH" --tags

git checkout --quiet -B "$CUSTOM_BRANCH" "sync-origin/${CUSTOM_BRANCH}"
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
if git ls-remote --exit-code --heads sync-origin "$BRANCH" > /dev/null 2>&1; then
	echo "${BRANCH} already exists; waiting for it to be merged."
	exit 0
fi

git push sync-origin "refs/remotes/upstream/main:refs/heads/main"

git checkout --quiet -B "$BRANCH" "$CUSTOM_BRANCH"
if ! git rebase --onto "$TAG" "$OLD_BASE" "$BRANCH"; then
	CONFLICTS="$(git diff --name-only --diff-filter=U | sed 's/^/- `/; s/$/`/')"
	git rebase --abort || true
	DESCRIPTION="Rebasing ${CUSTOM_BRANCH} onto upstream ${TAG} conflicts in:

${CONFLICTS}

Upstream changes: https://github.com/CapSoftware/Cap/compare/${OLD_BASE}...${TAG}

Resolve locally: \`git checkout -b ${BRANCH} ${CUSTOM_BRANCH} && git rebase --onto ${TAG} ${OLD_BASE}\`, update docs/UPSTREAM_BASE, push, and open a merge request."
	api POST "/issues" \
		--data-urlencode "title=Upstream sync ${TAG} has conflicts" \
		--data-urlencode "description=${DESCRIPTION}" \
		--data-urlencode "labels=upstream-sync" > /dev/null
	echo "Conflicts recorded as an issue."
	exit 0
fi

git rev-parse "${TAG}^{commit}" > "$BASE_FILE"
git add "$BASE_FILE"
git commit --quiet -m "chore: record upstream base ${TAG}"
git push sync-origin "$BRANCH"

api POST "/merge_requests" \
	--data-urlencode "source_branch=${BRANCH}" \
	--data-urlencode "target_branch=${CUSTOM_BRANCH}" \
	--data-urlencode "title=Sync upstream ${TAG}" \
	--data-urlencode "description=Rebases ${CUSTOM_BRANCH} onto upstream ${TAG}. Follow docs/UPGRADING.md before merging." \
	--data-urlencode "labels=upstream-sync" \
	--data-urlencode "remove_source_branch=true" > /dev/null
echo "Opened merge request for ${TAG}."
