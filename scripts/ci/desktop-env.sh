#!/usr/bin/env bash
# Sourced by the platform build scripts. Maps GitLab CI/CD variables onto the
# build-time variables apps/desktop-gpui and scripts/bundle-gpui.mjs read.
set -euo pipefail

: "${WEB_URL:?Set the WEB_URL CI/CD variable to the production web URL}"

export CAP_SERVER_URL="${WEB_URL%/}"
export NEXT_PUBLIC_WEB_URL="${WEB_URL%/}"
export CAP_BRAND_NAME="${BRAND_NAME:-Cap}"
export CAP_BRAND_IDENTIFIER="${BRAND_IDENTIFIER:-so.cap.desktop}"
export CAP_BRAND_URL_SCHEME="${URL_SCHEME:-cap-desktop}"
export CAP_BRAND_EXECUTABLE="${CAP_BRAND_NAME}.exe"
export CAP_DOWNLOAD_URL="${DOWNLOAD_URL:-${CAP_SERVER_URL}/download}"
export CAP_VERSIONS_URL="${VERSIONS_URL:-${CAP_SERVER_URL}/download/versions}"
export CAP_SUPPORT_URL="${SUPPORT_URL:-${CAP_SERVER_URL}}"
export CAP_DOCS_STORAGE_URL="${DOCS_STORAGE_URL:-${CAP_SERVER_URL}}"
export CAP_PRICING_URL="${PRICING_URL:-${CAP_SERVER_URL}}"
export CAP_LICENSE_API_BASE="${LICENSE_API_BASE:-${CAP_SERVER_URL}/api}"
export CAP_UPDATE_ENDPOINT="${UPDATE_ENDPOINT:-${CAP_SERVER_URL}/api/desktop-updates}"
if [[ -n "${UPDATER_PUBLIC_KEY:-}" ]]; then
	export CAP_UPDATER_PUBLIC_KEY="$UPDATER_PUBLIC_KEY"
fi
if [[ -n "${BRAND_ICON_ICO:-}" ]]; then
	export CAP_BRAND_ICON="$BRAND_ICON_ICO"
fi

write_dotenv() {
	local version="$1" target="$2"
	{
		echo "appVersion=${version}"
		echo "VITE_ENVIRONMENT=production"
		echo "NEXT_PUBLIC_WEB_URL=${NEXT_PUBLIC_WEB_URL}"
		echo "NEXTAUTH_URL=${NEXT_PUBLIC_WEB_URL}"
		echo "VITE_SERVER_URL=${CAP_SERVER_URL}"
		echo "RUST_TARGET_TRIPLE=${target}"
	} > .env
}
