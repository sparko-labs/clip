#!/usr/bin/env bash
set -euo pipefail

SUBJECT="chore: disable upstream workflows"
cd "$(git rev-parse --show-toplevel)"

removed=0
for file in .github/workflows/*.yml .github/workflows/*.yaml; do
	[[ -e "$file" ]] || continue
	case "$(basename "$file")" in
		clip-*) ;;
		*)
			git rm -q -f "$file"
			removed=$((removed + 1))
			;;
	esac
done

if [[ "$removed" -gt 0 ]]; then
	git commit -q -m "$SUBJECT"
	echo "Removed ${removed} upstream workflow files."
else
	echo "No upstream workflows to remove."
fi
