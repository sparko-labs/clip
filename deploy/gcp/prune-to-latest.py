#!/usr/bin/env python3
"""Keeps only the image tagged `latest` (plus the manifests it references) in
every package of the Docker repositories in a project.

    python3 deploy/gcp/prune-to-latest.py PROJECT_ID            # plan only
    python3 deploy/gcp/prune-to-latest.py PROJECT_ID --apply    # delete

A plain "keep the most recent version" cleanup policy is not safe for images
built with BuildKit attestations: the tagged image index is newer than the
image and attestation manifests it points to, so those children would be
deleted and the tag would stop pulling.
"""
import json
import subprocess
import sys
import urllib.request

ACCEPT = ", ".join(
    [
        "application/vnd.oci.image.index.v1+json",
        "application/vnd.docker.distribution.manifest.list.v2+json",
        "application/vnd.oci.image.manifest.v1+json",
        "application/vnd.docker.distribution.manifest.v2+json",
    ]
)


def gcloud(*args):
    result = subprocess.run(
        ["gcloud", *args], check=True, capture_output=True, text=True
    )
    return result.stdout


def gcloud_json(*args):
    output = gcloud(*args, "--format=json").strip()
    return json.loads(output) if output else []


def manifest(token, location, project, repository, package, reference):
    url = f"https://{location}-docker.pkg.dev/v2/{project}/{repository}/{package}/manifests/{reference}"
    request = urllib.request.Request(
        url, headers={"Authorization": f"Bearer {token}", "Accept": ACCEPT}
    )
    with urllib.request.urlopen(request) as response:
        return json.load(response)


def closure(token, location, project, repository, package, digest, seen):
    if digest in seen:
        return
    seen.add(digest)
    document = manifest(token, location, project, repository, package, digest)
    for child in document.get("manifests", []):
        closure(token, location, project, repository, package, child["digest"], seen)


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    project = sys.argv[1]
    apply = "--apply" in sys.argv[2:]
    token = gcloud("auth", "print-access-token").strip()
    deletions = []

    for repo in gcloud_json("artifacts", "repositories", "list", f"--project={project}"):
        if repo.get("format") != "DOCKER":
            continue
        parts = repo["name"].split("/")
        repository, location = parts[-1], parts[parts.index("locations") + 1]
        try:
            packages = gcloud_json(
                "artifacts", "packages", "list",
                f"--repository={repository}", f"--location={location}", f"--project={project}",
            )
        except subprocess.CalledProcessError:
            print(f"EMPTY  {location}/{repository}: no packages")
            continue
        for package_resource in packages:
            package = package_resource["name"].split("/packages/")[-1]
            base = [
                f"--package={package}", f"--repository={repository}",
                f"--location={location}", f"--project={project}",
            ]
            tags = gcloud_json("artifacts", "tags", "list", *base)
            latest = next(
                (t for t in tags if t["name"].split("/")[-1] == "latest"), None
            )
            label = f"{location}/{repository}/{package}"
            if latest is None:
                print(f"SKIP   {label}: no `latest` tag, nothing is deleted")
                continue
            keep_digest = latest["version"].split("/")[-1]
            keep = set()
            closure(token, location, project, repository, package, keep_digest, keep)
            versions = gcloud_json("artifacts", "versions", "list", *base)
            doomed = [v for v in versions if v["name"].split("/")[-1] not in keep]
            print(f"PLAN   {label}: keep {len(keep)} (latest + references), delete {len(doomed)}")
            def is_index(version):
                digest = version["name"].split("/")[-1]
                try:
                    document = manifest(token, location, project, repository, package, digest)
                except Exception:
                    return False
                return "manifests" in document

            ordered = sorted(
                doomed, key=lambda v: (not is_index(v), v["createTime"])
            )
            for version in ordered:
                digest = version["name"].split("/")[-1]
                tag_names = [t["name"].split("/")[-1] for t in version.get("relatedTags", [])]
                print(f"         - {digest[:19]} {version['createTime'][:19]} tags={tag_names}")
                deletions.append((digest, base))

    if not apply:
        print("\nPlan only. Re-run with --apply to delete.")
        return
    failed = 0
    for digest, base in deletions:
        result = subprocess.run(
            [
                "gcloud", "artifacts", "versions", "delete", digest, *base,
                "--delete-tags", "--quiet",
            ],
            capture_output=True, text=True,
        )
        if result.returncode == 0:
            print(f"DELETED {digest[:19]}")
        else:
            failed += 1
            print(f"FAILED  {digest[:19]}: {result.stderr.strip().splitlines()[-1]}")
    if failed:
        sys.exit(f"{failed} deletion(s) failed")


if __name__ == "__main__":
    main()
