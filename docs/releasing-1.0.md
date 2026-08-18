# DeepSeek Harness UX First 1.0 release runbook

Release binaries are built only after the final feature branch is merged into a clean `main` branch.
Development artifacts may be generated earlier to validate packaging, but they are not release candidates.

## Build matrix

| Target | Development command | CI workflow | Release output |
| --- | --- | --- | --- |
| macOS Apple Silicon | `npm run package:mac:arm64` | `build-macos-arm64.yml` | Ad-hoc signed ZIP |
| macOS Intel | `npm run package:mac:x64` | `build-macos-x64.yml` | Ad-hoc signed ZIP |
| Windows x64 | `npm run package:win:x64` | `build-windows-x64.yml` | Unsigned portable ZIP |

The macOS x64 workflow defaults to the `macos-15-intel` runner. If GitHub retires that label, set the
repository variable `MACOS_X64_RUNNER` to a currently supported Intel macOS runner label before building.
Do not publish a macOS x64 package cross-built from an ARM64 `node_modules` tree (or the reverse): native
dependencies such as Koffi must be installed and smoke-tested on the target architecture's runner.

## Current community release signing

The public tag workflow requires no private certificate secrets. macOS artifacts are ad-hoc signed so their
bundle integrity can be verified, but they are not Apple-notarized. Windows artifacts are currently unsigned.
GitHub Actions builds each target from the exact release tag, runs architecture and packaged-startup checks,
and publishes SHA-256 checksums. The README documents the expected Gatekeeper and SmartScreen prompts.

## Optional production macOS signing and notarization

Normal packaging remains ad-hoc signed for development. A production build must set
`DSH_RELEASE_BUILD=1`; the packaging script then refuses to run unless all signing and notarization
credentials are available.

Required prerequisites:

1. Active Apple Developer Program membership.
2. A `Developer ID Application` certificate installed in the build keychain.
3. The frozen bundle identifier `com.jesselai.dsh-desktop`. It is intentionally retained across the
   visible product rename and must not change between releases.
4. Either a local notarization keychain profile or Apple ID notarization credentials.

Local keychain-profile build:

```bash
DSH_RELEASE_BUILD=1 \
MACOS_SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)" \
MACOS_NOTARY_KEYCHAIN_PROFILE="dsh-desktop-notary" \
npm run package:mac:arm64

DSH_RELEASE_BUILD=1 npm run verify:mac:arm64
```

The packaging script supports the signing identity and notarization credentials below. A future
certificate-backed GitHub workflow would additionally need the exported certificate and its password:

- `MACOS_SIGN_IDENTITY`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`
- `MACOS_CERTIFICATE_BASE64` (workflow import only)
- `MACOS_CERTIFICATE_PASSWORD` (workflow import only)

The release build enables Hardened Runtime, submits the app with Apple's notary service, staples the
ticket, and fails verification unless Gatekeeper accepts the result.

## Optional Windows signing

Development workflows create an unsigned portable test artifact. A production build sets
`DSH_RELEASE_BUILD=1`; packaging then requires `WINDOWS_CERTIFICATE_FILE` and
`WINDOWS_CERTIFICATE_PASSWORD`, signs all eligible application binaries through
`@electron/windows-sign`, and timestamps the signatures. `npm run verify:win:x64` rejects a release whose
main executable does not have a valid Authenticode signature.

An Authenticode-enabled workflow can reconstruct the PFX in a temporary runner directory from these secrets:

- `WINDOWS_CERTIFICATE_BASE64`
- `WINDOWS_CERTIFICATE_PASSWORD`

Certificate files and passwords must never be committed or uploaded as build artifacts.

## Automated tag release

`.github/workflows/release.yml` is the only workflow that publishes a GitHub Release. It runs for `v*`
tags and first requires the tag to equal `v` plus the version in `package.json`. It then builds, verifies,
and smoke-tests macOS ARM64, macOS x64, and Windows x64 independently. The release is created only after
all three jobs pass, and includes a combined `SHA256SUMS` file.

Tags containing a hyphen, such as `v1.0.0-rc.1`, are published as GitHub prereleases. Stable tags such as
`v1.0.0` are published as normal releases.

## Release order

1. Merge the final feature and update `main`.
2. Set the application version to `1.0.0-rc.1`; build all three targets and test the artifacts without
   publishing a public Stable release.
3. Test each artifact on a clean machine without Node or npm.
4. Fix release-only failures, then set version `1.0.0`.
5. Create and push tag `v1.0.0`.
6. Let the tag workflow build artifacts from that exact tag, generate SHA-256 checksums, and publish
   the GitHub Release.
