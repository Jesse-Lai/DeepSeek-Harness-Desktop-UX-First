# Changelog

All notable changes to DeepSeek Harness UX First are documented here. Versions follow
[Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-08-18

### Added

- Ready-to-run macOS Apple Silicon, macOS Intel, and Windows x64 downloads with Node, Harness, and runtime dependencies included.
- Tag-driven GitHub Releases with architecture validation, packaged startup smoke tests, and SHA-256 checksums.

### Changed

- macOS community downloads are ad-hoc signed and Windows downloads are currently unsigned, allowing the public release pipeline to run without private commercial signing credentials.
- Added first-launch guidance for macOS Gatekeeper and Windows SmartScreen.

## [1.0.0-rc.1] - 2026-08-17

### Added

- A ready-to-run Electron desktop shell for the official DeepSeek Harness.
- Native macOS ARM64, macOS x64, and Windows x64 packaging pipelines.
- A single-renderer desktop experience with custom sidebar, Composer, progress, feedback, and icon treatments.
- Release checks for application identity, architecture, code signing, bundled licenses, and packaged startup.
- Compatibility with the existing `DSH Desktop` data directory so upgrades preserve conversations, projects,
  settings, and API credentials.

### Release candidate notes

- Version 1.0 uses manual updates from GitHub Releases. Built-in signed updates are planned after the release
  pipeline has accumulated real-world validation.
