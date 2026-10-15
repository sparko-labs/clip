# Windows runner

Tag `windows`, shell executor with `shell = "bash"` (Git for Windows), project
level, protected. Do not use Docker for desktop builds.

1. Windows 10/11 or Server. NVMe drive for the builds directory; exclude it from
   Defender real-time scanning.
2. Visual Studio 2022 Build Tools 17.12+ with "Desktop development with C++":
   MSVC v143, Windows 11 SDK, C++ Clang tools (`libclang.dll`), CMake.
3. Rust `1.88.0` and `1.95.0`, target `x86_64-pc-windows-msvc`.
4. Node 20+, Bun 1.4.0, Git, 7-Zip (`7z` on `PATH`, used to verify the installer
   payload), PowerShell 7 (`pwsh`), WebView2 runtime.
5. Pagefile 16 to 24 GB: linking runs out of commit memory at 16 GB RAM.
6. Install GitLab Runner as a service under a dedicated local user, register
   with the authentication token, `concurrent = 1`.
7. Signing: set `WINDOWS_CERTIFICATE` (base64 PFX) and
   `WINDOWS_CERTIFICATE_PASSWORD`, or `WINDOWS_SIGN_COMMAND` for a cloud signer
   (for example `AzureSignTool sign ... "{file}"`). The Windows SDK `signtool.exe`
   is found automatically.
