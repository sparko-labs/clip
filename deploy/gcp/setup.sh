#!/usr/bin/env bash
# Provisions Google Artifact Registry for the GitHub Actions image pushes and
# keeps one image version per package.
#
#   PROJECT_ID=my-project LOCATION=europe-west1 ./deploy/gcp/setup.sh setup
#   PROJECT_ID=my-project ./deploy/gcp/setup.sh existing-plan
#   PROJECT_ID=my-project ./deploy/gcp/setup.sh existing-dry-run
#   PROJECT_ID=my-project ./deploy/gcp/setup.sh existing-enforce
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
REPOSITORY="${REPOSITORY:-clip}"
GITHUB_REPOSITORY="${GITHUB_REPOSITORY:-SparkoSol/clip}"
POOL_ID="${POOL_ID:-github}"
PROVIDER_ID="${PROVIDER_ID:-clip-github}"
SERVICE_ACCOUNT_ID="${SERVICE_ACCOUNT_ID:-clip-github-push}"
SERVICE_ACCOUNT="${SERVICE_ACCOUNT_ID}@${PROJECT_ID}.iam.gserviceaccount.com"

: "${PROJECT_ID:?Set PROJECT_ID}"

keep_latest_policy() {
	local file
	file="$(mktemp)"
	cat > "$file" <<'JSON'
[
  {
    "name": "keep-latest-only",
    "action": { "type": "Keep" },
    "mostRecentVersions": { "keepCount": 1 }
  }
]
JSON
	echo "$file"
}

docker_repositories() {
	gcloud artifacts repositories list --project="$PROJECT_ID" \
		--filter="format=DOCKER" \
		--format="value(name.basename(),location)"
}

setup() {
	: "${LOCATION:?Set LOCATION, for example the region your VPS pulls from}"
	local project_number pool_name
	project_number="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"

	gcloud services enable --project="$PROJECT_ID" \
		artifactregistry.googleapis.com iam.googleapis.com \
		iamcredentials.googleapis.com sts.googleapis.com \
		cloudresourcemanager.googleapis.com

	if ! gcloud artifacts repositories describe "$REPOSITORY" \
		--project="$PROJECT_ID" --location="$LOCATION" > /dev/null 2>&1; then
		gcloud artifacts repositories create "$REPOSITORY" --project="$PROJECT_ID" \
			--location="$LOCATION" --repository-format=docker \
			--description="Container images built from ${GITHUB_REPOSITORY}"
	fi

	local policy
	policy="$(keep_latest_policy)"
	gcloud artifacts repositories set-cleanup-policies "$REPOSITORY" \
		--project="$PROJECT_ID" --location="$LOCATION" --policy="$policy" --no-dry-run

	if ! gcloud iam service-accounts describe "$SERVICE_ACCOUNT" \
		--project="$PROJECT_ID" > /dev/null 2>&1; then
		gcloud iam service-accounts create "$SERVICE_ACCOUNT_ID" --project="$PROJECT_ID" \
			--display-name="Image pushes from ${GITHUB_REPOSITORY}"
	fi

	gcloud artifacts repositories add-iam-policy-binding "$REPOSITORY" \
		--project="$PROJECT_ID" --location="$LOCATION" \
		--member="serviceAccount:${SERVICE_ACCOUNT}" \
		--role="roles/artifactregistry.writer" > /dev/null

	if ! gcloud iam workload-identity-pools describe "$POOL_ID" \
		--project="$PROJECT_ID" --location=global > /dev/null 2>&1; then
		gcloud iam workload-identity-pools create "$POOL_ID" --project="$PROJECT_ID" \
			--location=global --display-name="GitHub Actions"
	fi

	if ! gcloud iam workload-identity-pools providers describe "$PROVIDER_ID" \
		--project="$PROJECT_ID" --location=global --workload-identity-pool="$POOL_ID" \
		> /dev/null 2>&1; then
		gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \
			--project="$PROJECT_ID" --location=global --workload-identity-pool="$POOL_ID" \
			--issuer-uri="https://token.actions.githubusercontent.com" \
			--attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
			--attribute-condition="assertion.repository == '${GITHUB_REPOSITORY}'"
	fi

	pool_name="projects/${project_number}/locations/global/workloadIdentityPools/${POOL_ID}"
	gcloud iam service-accounts add-iam-policy-binding "$SERVICE_ACCOUNT" \
		--project="$PROJECT_ID" --role="roles/iam.workloadIdentityUser" \
		--member="principalSet://iam.googleapis.com/${pool_name}/attribute.repository/${GITHUB_REPOSITORY}" \
		> /dev/null

	cat <<OUT

Set these as GitHub Actions *variables* on ${GITHUB_REPOSITORY}:

  GCP_PROJECT_ID                  ${PROJECT_ID}
  GAR_LOCATION                    ${LOCATION}
  GAR_REPOSITORY                  ${REPOSITORY}
  GCP_SERVICE_ACCOUNT             ${SERVICE_ACCOUNT}
  GCP_WORKLOAD_IDENTITY_PROVIDER  ${pool_name}/providers/${PROVIDER_ID}

Images will be at ${LOCATION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/{web,media-server}.
OUT
}

existing_plan() {
	local found=0 name location
	while read -r name location; do
		[[ -n "$name" ]] || continue
		found=1
		echo "== ${location}/${name}"
		gcloud artifacts docker images list \
			"${location}-docker.pkg.dev/${PROJECT_ID}/${name}" \
			--include-tags --format="value(package)" 2>/dev/null \
			| sort | uniq -c | awk '{ printf "   %3d version(s) of %s -> %d would be deleted\n", $1, $2, ($1 > 1 ? $1 - 1 : 0) }'
	done < <(docker_repositories)
	[[ "$found" -eq 1 ]] || echo "No Docker repositories in ${PROJECT_ID}."
}

existing_apply() {
	local mode="$1" name location policy
	policy="$(keep_latest_policy)"
	while read -r name location; do
		[[ -n "$name" ]] || continue
		echo "== ${location}/${name} (${mode})"
		gcloud artifacts repositories set-cleanup-policies "$name" \
			--project="$PROJECT_ID" --location="$location" --policy="$policy" \
			"--${mode}"
	done < <(docker_repositories)
}

case "${1:-}" in
	setup) setup ;;
	existing-plan) existing_plan ;;
	existing-dry-run) existing_apply dry-run ;;
	existing-enforce) existing_apply no-dry-run ;;
	*)
		echo "Usage: $0 {setup|existing-plan|existing-dry-run|existing-enforce}" >&2
		exit 1
		;;
esac
