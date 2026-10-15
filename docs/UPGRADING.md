# Upgrading to a new upstream release

The `sync:upstream` job (scheduled pipeline) does steps 1 to 4. Do 5 onwards by
hand on the merge request it opens.

1. Fetch upstream tags and pick the newest `cap-vX.Y.Z` (nightlies are ignored).
2. Fast-forward `main` to `upstream/main`.
3. Branch `sync/<tag>` from `custom` and `git rebase --onto <tag> $(cat docs/UPSTREAM_BASE)`
   with `rerere` enabled.
4. On success push the branch and open a merge request; on conflict abort and
   open an issue listing the files.
5. Read the upstream release notes for breaking changes.
6. Database: upstream migrations apply automatically on start. Run them against
   staging first. `fork_user_access` is migrated from its own journal.
7. Re-run `check:web` and confirm `oidc-auth`, `scim` and `trusted-origins-oidc`
   tests pass. Upstream may have refactored `auth-options.ts`, `Auth.ts`,
   `AgentAuth.ts`, `utils.ts` or the nextauth route.
8. Re-run the branding search for new strings:
   `git grep -nE 'cap\.so|cap\.link|cap-desktop|so\.cap\.desktop|capso' -- apps packages`
   and compare with the previous list.
9. Check `isBlockedAccountEmail` call sites: `git grep -n isBlockedAccountEmail`.
   Any new bearer-token path needs `isUserAccessDisabled` too.
10. Compare `.github/workflows/desktop-release.yml` and
    `scripts/windows-release-signing.ps1` with the previous base; our
    `scripts/ci/build-desktop-*.sh` mirror them.
11. Check `rust-toolchain.toml`, `apps/desktop-gpui/rust-toolchain.toml`,
    `CAP_GPUI_RUST_TOOLCHAIN`, Bun and Node versions and update the runners.
12. Build all three platforms from a `desktop-vX.Y.Z` tag, install on a clean
    machine, sign in, and update from the previous build.

## Release tags and versions

Tag `desktop-vX.Y.Z` on `custom`. The version is stamped into
`apps/desktop/src-tauri/Cargo.toml` at build time. The updater only offers
strictly greater semver versions, so a rebuild with fork-only fixes needs a
higher number than the last published one (for example `0.6.3` even while
upstream is at `0.6.2`).
