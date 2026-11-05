# DeepSeek Harness UX First UI

The shared UI and interaction plugin used by DeepSeek Harness UX First.

## Install in DeepSeek Harness

This release targets `@deepseek-ai/dsh@0.1.0-rc.6`. With `dsh` and `pnpm`
available on your PATH, install the plugin into the Web profile:

```bash
dsh plugin --profile web add @jesse-lai/dsh-desktop-ui
dsh web
```

Update or remove it with:

```bash
dsh plugin --profile web update @jesse-lai/dsh-desktop-ui
dsh plugin --profile web remove @jesse-lai/dsh-desktop-ui
```

For local development from the repository root:

```bash
dsh plugin --profile web add ./plugins/@jesse-lai/dsh-desktop-ui
```

## Desktop and plugin appearance

The plugin contains the same layout, interaction, and presentation code as the
desktop application. In a standard Harness Web host it always uses the stable
opaque background, including on macOS. The packaged macOS Electron application
adds native system vibrancy through its desktop window; that native effect is
not part of the Web plugin.

This is a community project and is not affiliated with DeepSeek.
