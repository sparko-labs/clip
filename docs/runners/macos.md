# macOS runner (Mac mini)

Tag `macos`, shell executor, project-level, protected.

1. Use a dedicated standard user that stays logged in (signing needs a GUI
   session). System Settings, Energy: never sleep, start up after power failure.
2. `xcode-select --install`, install Xcode, then `sudo xcodebuild -license accept`.
3. Rust: `rustup` with toolchains `1.88.0` and `1.95.0` and targets
   `aarch64-apple-darwin`.
4. Node 20+, Bun 1.4.0, Git, CMake.
5. Install GitLab Runner, register with the authentication token created in
   the GitLab UI: `gitlab-runner register --url <gitlab> --token <glrt-...>`
   (executor `shell`).
6. `config.toml`: `concurrent = 1`. Run as a launchd agent for the build user:
   `gitlab-runner install --user <build-user>` then `gitlab-runner start`.
7. Persistent state lives in the runner's builds directory (Rust `target/`,
   `../zed-cap`, `~/.cargo`). Clean `apps/desktop-gpui/target` when the Rust
   toolchain pin changes.

The signing certificate is imported into a temporary keychain per job and
deleted afterwards. Do not install it in the login keychain.
