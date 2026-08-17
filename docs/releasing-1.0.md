# DeepSeek Harness UX First 1.0 release runbook

Release binaries are built only after the final feature branch is merged into a clean `main` branch.
Development artifacts may be generated earlier to validate packaging, but they are not release candidates.

## Build matrix

| Target | Development command | CI workflow | Release output |
| --- | --- | --- | --- |
| macOS Apple Silicon | `npm run package:mac:arm64` | `build-macos-arm64.yml` | Signed and notarized ZIP or DMG |
| macOS Intel | `npm run package:mac:x64` | `build-macos-x64.yml` | Signed and notarized ZIP or DMG |
| Windows x64 | `npm run package:win:x64` | `build-windows-x64.yml` | Signed portable ZIP initially; installer may follow |

The macOS x64 workflow defaults to the `macos-13` Intel runner. If GitHub retires that label, set the
repository variable `MACOS_X64_RUNNER` to the current Intel macOS runner label before building.

## macOS release signing and notarization

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

The tag release workflow uses these GitHub Actions secrets without committing them:

- `MACOS_CERTIFICATE_BASE64`
- `MACOS_CERTIFICATE_PASSWORD`
- `MACOS_SIGN_IDENTITY`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

The release build enables Hardened Runtime, submits the app with Apple's notary service, staples the
ticket, and fails verification unless Gatekeeper accepts the result.

## Windows signing

Development workflows create an unsigned portable test artifact. A production build sets
`DSH_RELEASE_BUILD=1`; packaging then requires `WINDOWS_CERTIFICATE_FILE` and
`WINDOWS_CERTIFICATE_PASSWORD`, signs all eligible application binaries through
`@electron/windows-sign`, and timestamps the signatures. `npm run verify:win:x64` rejects a release whose
main executable does not have a valid Authenticode signature.

The tag release workflow reconstructs the PFX only in the temporary runner directory from these secrets:

- `WINDOWS_CERTIFICATE_BASE64`
- `WINDOWS_CERTIFICATE_PASSWORD`

Certificate files and passwords must never be committed or uploaded as build artifacts.

## Automated tag release

`.github/workflows/release.yml` is the only workflow that publishes a GitHub Release. It runs for `v*`
tags and first requires the tag to equal `v` plus the version in `package.json`. It then builds, signs,
verifies, and smoke-tests macOS ARM64, macOS x64, and Windows x64 independently. The release is created
only after all three jobs pass, and includes a combined `SHA256SUMS` file.

Tags containing a hyphen, such as `v1.0.0-rc.1`, are published as GitHub prereleases. Stable tags such as
`v1.0.0` are published as normal releases.

## Release order

1. Merge the final feature and update `main`.
2. Set the application version to `1.0.0-rc.1`; build all three targets and test the artifacts without
   publishing a public Stable release.
3. Test each artifact on a clean machine without Node or npm.
4. Fix release-only failures, then set version `1.0.0`.
5. Confirm all signing secrets are configured, then create and push tag `v1.0.0`.
6. Let the tag workflow build signed artifacts from that exact tag, generate SHA-256 checksums, and publish
   the GitHub Release.
