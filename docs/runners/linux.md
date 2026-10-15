# Linux runner

Headless Ubuntu Server LTS. Two registrations on the same machine, both
project-level, `concurrent = 1` each.

## Docker executor (no tag)

Web image, media-server image, checks, release publish, upstream sync. These
jobs carry no runner tag, so a shared runner that accepts untagged jobs runs
them.

- The image jobs use Docker-in-Docker (`docker:27-dind`), which needs a
  `privileged = true` runner.
- On a runner that mounts the host socket instead
  (`volumes = ["/var/run/docker.sock:/var/run/docker.sock", "/cache"]`,
  `privileged = false`), delete the `services` block and the `DOCKER_HOST` and
  `DOCKER_TLS_CERTDIR` variables from `.docker-image` in `.gitlab-ci.yml`.
  Anyone who can push to `custom` can then run code on that host, so keep the
  project private.
- Registry: GitLab Container Registry works with the built-in
  `$CI_REGISTRY_*` variables. For Google Artifact Registry set
  `WEB_IMAGE_REGISTRY`, `REGISTRY_HOST` (for example `europe-docker.pkg.dev`),
  `REGISTRY_USER=_json_key` and `REGISTRY_PASSWORD` to the service account key.

## Shell executor (tag `linux-desktop`, only if a Linux desktop build is wanted)

- Packages from `.github/actions/install-desktop-deps/action.yml`
  (`build-essential`, `clang`, `libclang-dev`, `libasound2-dev`,
  `libpipewire-0.3-dev`, `libwayland-dev`, `libxkbcommon-dev`, `libva-dev`,
  `patchelf`, `rpm`, ...). Do not install system FFmpeg.
- Rust `1.88.0` and `1.95.0`, Node 20+, Bun 1.4.0, a 16 GB swapfile.

## Deploying the web app

On the VPS, log in to the registry with a read-only deploy token
(`read_registry`), then use upstream's `docker-compose.yml` with `image:` set to
`<registry>/web:<tag>` and `<registry>/media-server:<tag>`. Set `WEB_URL`,
`NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `AUTH_MODE=oidc`, the `OIDC_*` variables,
`OIDC_ALLOWED_EMAIL_DOMAINS`, `SCIM_BEARER_TOKEN`, `DESKTOP_UPDATES_BASE_URL`,
`CAP_VIDEOS_DEFAULT_PUBLIC=false`, and replace every default secret.
