# Native shortcuts in DSH

The macOS desktop app embeds **DSH Companion**, adapted directly from the current
JesseAgent `macos/JesseCompanion` sources. The ring, Liquid Glass materials, icons,
animation, hover hit testing, floating conversation, result editor, history,
selection capture, screenshot selector, and guarded writeback retain their native
implementation. `native/DSHCompanion/upstream.json` records source fingerprints;
visual-source tests allow only the imported product-name substitutions.

## Use

On **macOS 26 or later**, start DSH and press **Option-A**. If that shortcut is
occupied, the app uses **Option-Space** and displays the actual shortcut in its
menu-bar menu. If both are occupied, use **Show Shortcuts** in that menu or the
DSH application menu. Closing the main window leaves the shortcut service and
active DSH sessions running. **Quit DSH** quits both processes. Launch at Login is
controlled from the menu and starts the parent DSH app hidden.

With a selection the ring offers Do Anything, Polish, Translate, Summarize,
Screenshot, and Image. Without a selection it offers Do Anything, Summarize,
and Screenshot. Recent Results remains in the menu-bar menu, as in JesseAgent.
The existing result/task screens, retry, copy, edited results, approval buttons,
stop buttons, removable context and image attachments, and main-app handoff use
the original native views. Enter submits; Shift-Enter inserts a newline.

Accessibility permission belongs to **DSH** / **DSH Companion**. It enables
selection capture and writeback. Screen Recording is requested only for capture;
Chrome/Safari may separately request Automation permission for page metadata.
Writeback checks the original app, control, selection, and text, and never presses
Enter. Missing permissions and changed targets do not cause blind paste.

## Model and session integration

- Quick text actions use the current DSH default model through `ctx.llm`, with
  the original action prompts and no tools.
- Do Anything creates a real DSH session, with its own directory beneath
  `DSH Desktop/companion/tasks`. Subsequent prompts reuse it. Its history is
  visible in DSH Tasks; **Continue in DSH** opens that exact session.
- The bridge translates DSH events into the native protocol. It preserves
  prompt ordering, terminal errors, approval correlation and cancellation.
  Closing the panel does not cancel the run. Request IDs prevent duplicate
  sessions when a native HTTP request is retried.
- Screenshots and pasted images are durable DSH attachments. The selected model
  must support image input. Optional `DSH_COMPANION_VISUAL_PROVIDER` and
  `DSH_COMPANION_VISUAL_MODEL` select an already configured DSH vision route.
- The `generate_image` tool stores generated images in the same attachment
  service. Configure `DSH_COMPANION_IMAGE_URL` to a complete OpenAI-compatible
  `/images/generations` endpoint, plus `DSH_COMPANION_IMAGE_MODEL` and
  `DSH_COMPANION_IMAGE_API_KEY`. Azure deployment URLs are supported. The endpoint
  must return `data[0].b64_json` as PNG. Without an image provider, the tool reports
  the missing configuration; it never fabricates an image. Environment values
  must be present in the launching DSH process, as with JesseAgent's model setup.

The native service binds only to loopback with a random per-launch bearer secret,
rejects browser origins, and is not installed by the standalone Web UI patch.
Model credentials stay in the Harness process. Native host commands use the
parent-owned process pipe; arbitrary web pages cannot open sessions or change
login settings through the native service.

## Development and verification

Requires macOS 26 with a compatible Xcode/Swift SDK for native builds.

```sh
npm start                         # rebuilds the native helper when needed
npm run companion:build
npm run companion:test
npm test
npm run companion:integration      # isolated DSH + deterministic test model
npm run package:mac:arm64
npm run package:mac:x64
```

The macOS packager embeds and signs `DSH Companion.app`. Intel macOS builds compile
an x86_64 helper; Apple Silicon builds compile arm64. Older macOS releases and
Windows keep the existing Electron product and do not load the macOS-only helper.
They do not have the native shortcut feature in this implementation.

Native regression tests cover geometry, glass masks, focus, clipboard handling,
selection fallbacks, screenshots, results, and concurrent run state. JS adapter
tests cover ordering, retry identity, approvals, cancellation, model failures,
attachment output and persistence. Live screen inspection is separate from these
tests and requires the relevant macOS permissions.

### Verification record — 2026-09-26

- JavaScript: 100 tests passed. Native Swift: 69 tests passed.
- Isolated integration: authenticated bridge, actual DSH session creation,
  streamed completion and quick text actions passed with a deterministic model.
- The final Apple Silicon app was packaged, signature-verified and launched;
  both the parent and helper executable paths were verified inside that bundle.
- Live screenshots inspected: the three-action ring without selected text and
  the empty Recent Results panel. Source comparison confirms the original
  SwiftUI layout, materials and controller logic, with branding substitutions.
- Full visual/interaction acceptance is still pending. This run did not grant
  Accessibility or Screen Recording access, so selection-dependent actions,
  guarded writeback and screen capture have not been exercised end to end.
  The floating conversation and main-window handoff have adapter/native test
  coverage but have not completed live UI acceptance. Real image generation
  also requires a configured image provider and has not been validated here.
