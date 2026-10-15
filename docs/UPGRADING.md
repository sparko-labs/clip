# Upgrading to a new upstream release

The `Clip upstream sync` workflow (weekly, needs the `SYNC_TOKEN` secret) does
steps 1 to 4. Do 5 onwards by hand on the pull request it opens. GitHub disables
scheduled workflows after 60 days without repository activity; re-enable it in
the Actions tab or run it manually.

1. Fetch upstream tags and pick the newest `cap-vX.Y.Z` (nightlies are ignored).
2. Fast-forward `main` to `upstream/main`.
3. Branch `sync/<tag>` from `custom`, drop the final
   `chore: disable upstream workflows` commit, `git rebase --onto <tag> $(cat docs/UPSTREAM_BASE)`
   with `rerere` enabled, then re-run `scripts/ci/disable-upstream-workflows.sh`
   so upstream's workflow files stay removed without conflicting.
4. On success push the branch and open a pull request; on conflict abort and
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
10. Compare upstream's `.github/workflows/desktop-release.yml` (removed here,
    read it at the upstream tag) and `scripts/windows-release-signing.ps1` with
    the previous base; our `scripts/ci/build-desktop-*.sh` mirror them.
11. Check `rust-toolchain.toml`, `apps/desktop-gpui/rust-toolchain.toml`,
    `CAP_GPUI_RUST_TOOLCHAIN`, Bun and Node versions and the setup actions in
    `.github/actions`.
12. Build all three platforms from a `desktop-vX.Y.Z` tag, install on a clean
    machine, sign in, and update from the previous build.

## Release tags and versions

Push a tag `desktop-vX.Y.Z` on `custom`; the `Clip desktop` workflow builds, then
creates a GitHub Release. The version is stamped into
`apps/desktop/src-tauri/Cargo.toml` at build time. The updater only offers
strictly greater semver versions, so a rebuild with fork-only fixes needs a
higher number than the last published one (for example `0.6.3` even while
upstream is at `0.6.2`).
