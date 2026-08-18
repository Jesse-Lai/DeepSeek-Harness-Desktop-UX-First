# Updates and local data

## Updating 1.0

Version 1.0 uses explicit downloads from the repository's
[GitHub Releases](https://github.com/Jesse-Lai/DeepSeek-Harness-Desktop-UX-First/releases) page. Download the
archive for the computer's operating system and architecture; do not download the repository source archive.

- On macOS, quit the application, unzip the new release, and replace the existing application in
  `/Applications`.
- On Windows, quit the application, unzip the complete new release, and replace the previous application
  directory. Do not copy only the `.exe`; the adjacent runtime files are required.

Application binaries and user data are stored separately. Replacing the application does not clear local
conversations, projects, settings, or API credentials. The visible product was renamed for 1.0, but the app
intentionally continues to use the legacy data directory:

- macOS: `~/Library/Application Support/DSH Desktop`
- Windows: `%APPDATA%\DSH Desktop`

Back up this directory before a major-version upgrade or when moving data to another computer. Uninstalling or
deleting the application binary does not remove it automatically.

## Release channels

- **Stable** uses tags such as `v1.0.0` and is recommended for most users.
- **Preview** uses prerelease tags such as `v1.0.1-preview.20260818.1` and may be published daily. Preview builds
  appear as prereleases and may contain regressions.

The first 1.0 release deliberately does not update itself in the background. This keeps every binary replacement
visible to the user and verifiable by its published SHA-256 checksum while signing and update infrastructure gain
operational history. A later release can add opt-in signed update feeds for Stable and Preview without changing
the user-data location.
