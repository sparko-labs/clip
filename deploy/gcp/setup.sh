#!/usr/bin/env bash
# Provisions Google Artifact Registry for the GitHub Actions image pushes and
# keeps one image version per package.
#
#   PROJECT_ID=my-project LOCATION=us-central1 ./deploy/gcp/setup.sh setup
#
# Optional: VPS_READER=<service account email> grants that account read access
# to the new repository so an existing image puller keeps working.
#
# To keep only the latest image in repositories that already exist, use
# deploy/gcp/prune-to-latest.py. It keeps the manifests a tag references, which
# a plain "most recent version" cleanup policy does not.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
REPOSITORY="${REPOSITORY:-clip}"
GITHUB_REPOSITORY="${GITHUB_REPOSITORY:-sparko-labs/clip}"
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

	if [[ -n "${VPS_READER:-}" ]]; then
		gcloud artifacts repositories add-iam-policy-binding "$REPOSITORY" \
			--project="$PROJECT_ID" --location="$LOCATION" \
			--member="serviceAccount:${VPS_READER}" \
			--role="roles/artifactregistry.reader" > /dev/null
	fi

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

case "${1:-}" in
	setup) setup ;;
	*)
		echo "Usage: $0 setup" >&2
		exit 1
		;;
esac
