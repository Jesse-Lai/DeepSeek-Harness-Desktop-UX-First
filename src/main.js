import { createRequire } from "node:module";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain, Menu, nativeTheme, screen, shell } from "electron";
import { companionConfiguration, launchCompanion, supportsNativeCompanion } from "./companion.js";
import { startHarness } from "./harness.js";
import { legacyUserDataDirectoryName, productName } from "./product.js";
import { handleCreateTaskScope } from "./task-scopes.js";

const require = createRequire(import.meta.url);
const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const harnessPackagePath = require.resolve("@deepseek-ai/dsh/package.json");
const harnessCliPath = join(dirname(harnessPackagePath), "lib", "bin.js");
const desktopPatchPath = join(sourceDirectory, "dsh-desktop.patch.yml");
const desktopUiPluginPath = join(
  sourceDirectory,
  "..",
  "plugins",
  "@jesse-lai",
  "dsh-desktop-ui",
);
const macOSTrafficLightPosition = { x: 14, y: 14 };

let nativeCompanion;
let nativeConfiguration;
let pendingCompanionSession;
let mainRendererReady = false;
let mainWindow;
let harness;
let harnessStartup;
let startupAbortController;
let quitting = false;
let shutdownPromise;
let taskUserDataPath;
let harnessUrl;
let nextAtomWindowId = 1;
const atomWindows = new Map();
const atomWindowZOrder = [];
const persistedAtomWindows = new Map();
const pendingAtomMerges = new Map();
let nextAtomMergeId = 1;
let persistAtomTimer;

app.setName(productName);
// Keep the pre-1.0 data location stable across the visible product rename.
// Conversations, projects, settings, and API credentials remain available.
app.setPath("userData", join(app.getPath("appData"), legacyUserDataDirectoryName));
taskUserDataPath = app.getPath("userData");
const atomStatePath = join(taskUserDataPath, "atom-workbench.json");

const smokeTest = process.argv.includes("--smoke-test");
const hasSingleInstanceLock = smokeTest || app.requestSingleInstanceLock();

function focusMainWindow() {
  if (mainWindow?.isDestroyed() !== false) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function conciseError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 2_000 ? `${message.slice(0, 2_000)}…` : message;
}

function syncMacOSTrafficLightPosition(targetWindow = mainWindow) {
  if (process.platform !== "darwin" || targetWindow?.isDestroyed() !== false) return;
  targetWindow.setWindowButtonPosition(macOSTrafficLightPosition);
}

function assertMacOSTrafficLightPosition(label, targetWindow = mainWindow) {
  if (process.platform !== "darwin" || targetWindow?.isDestroyed() !== false) return;
  const position = targetWindow.getWindowButtonPosition();
  if (
    position?.x !== macOSTrafficLightPosition.x ||
    position?.y !== macOSTrafficLightPosition.y
  ) {
    throw new Error(`${label} Traffic Lights 位置错误：${JSON.stringify(position)}`);
  }
}

function assertPrimaryBrowserWindow(label) {
  const windows = BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed());
  if (!windows.includes(mainWindow)) {
    throw new Error(`${label} 缺少主 BrowserWindow，实际为 ${windows.length}`);
  }
}

function markAtomWindowFront(windowId) {
  const previous = atomWindowZOrder.indexOf(windowId);
  if (previous >= 0) atomWindowZOrder.splice(previous, 1);
  atomWindowZOrder.push(windowId);
}

async function loadStatus(state = "loading", message) {
  if (mainWindow?.isDestroyed() !== false) return;
  await mainWindow.loadFile(join(sourceDirectory, "loading.html"), {
    query: {
      state,
      ...(message ? { message } : {}),
    },
  });
}

function keepNavigationLocal(window, localOrigin) {
  const isLocal = (target) => {
    try {
      return new URL(target).origin === localOrigin;
    } catch {
      return false;
    }
  };

  window.webContents.on("will-navigate", (event, target) => {
    if (!isLocal(target)) event.preventDefault();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!isLocal(url) && /^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
}

function createWindow({ showOnReady = true, partition, role = "main", windowId, bounds } = {}) {
  const isMacOS = process.platform === "darwin";
  const window = new BrowserWindow({
    width: bounds?.width ?? 1280,
    height: bounds?.height ?? 820,
    ...(bounds?.x === undefined ? {} : { x: bounds.x }),
    ...(bounds?.y === undefined ? {} : { y: bounds.y }),
    minWidth: role === "atom" ? 420 : 900,
    minHeight: role === "atom" ? 420 : 620,
    title: productName,
    show: false,
    backgroundColor: isMacOS ? "#00000000" : "#eef2f6",
    ...(isMacOS
      ? {
          titleBarStyle: "hiddenInset",
          trafficLightPosition: macOSTrafficLightPosition,
          transparent: true,
          roundedCorners: true,
          vibrancy: "under-window",
          visualEffectState: "active",
        }
      : {}),
    webPreferences: {
      preload: join(sourceDirectory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      ...(partition === undefined ? {} : { partition }),
    },
  });
  const atomWindowId = windowId ?? (role === "main" ? "main" : `atom:${nextAtomWindowId++}`);
  atomWindows.set(atomWindowId, { id: atomWindowId, role, window });
  markAtomWindowFront(atomWindowId);

  const syncTrafficLights = () => syncMacOSTrafficLightPosition(window);
  window.on("focus", () => markAtomWindowFront(atomWindowId));
  window.webContents.on("did-finish-load", syncTrafficLights);
  if (role === "main") window.webContents.on("did-start-loading", () => { mainRendererReady = false; });
  window.on("restore", syncTrafficLights);
  window.on("leave-full-screen", syncTrafficLights);
  window.once("ready-to-show", () => {
    syncTrafficLights();
    if (showOnReady) window.show();
  });
  window.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || quitting || !validatedURL.startsWith("http://127.0.0.1:")) return;
      void loadStatus(
        "error",
        `Harness 页面加载失败（${errorCode}）：${errorDescription}\n请重新启动后再试。`,
      );
    },
  );
  window.webContents.on("render-process-gone", (_event, details) => {
    if (quitting) return;
    void loadStatus(
      "error",
      `界面进程意外退出：${details.reason}\n请重新启动后再试。`,
    );
  });
  window.on("close", (event) => {
    if (role === "main" && nativeCompanion?.running && !quitting) {
      event.preventDefault();
      window.hide();
    }
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = undefined;
    atomWindows.delete(atomWindowId);
    const zOrderIndex = atomWindowZOrder.indexOf(atomWindowId);
    if (zOrderIndex >= 0) atomWindowZOrder.splice(zOrderIndex, 1);
    for (const [requestId, pending] of pendingAtomMerges) {
      if (pending.sourceWindowId === atomWindowId || pending.targetWindowId === atomWindowId) {
        settleAtomMerge(requestId, false);
      }
    }
    if (!quitting && role === "atom") {
      persistedAtomWindows.delete(atomWindowId);
      scheduleAtomWindowStateWrite();
    }
    broadcastAtomEvent("window-closed", { windowId: atomWindowId });
  });
  return window;
}

function atomEntryFor(contents) {
  return [...atomWindows.values()].find((entry) => entry.window.webContents === contents);
}

function atomWindowAtPoint(point, excludedWindowId) {
  const matches = [...atomWindows.values()].filter((entry) => {
    if (entry.window.isDestroyed() || !entry.window.isVisible()) return false;
    const bounds = entry.window.getBounds();
    return point.x >= bounds.x
      && point.x < bounds.x + bounds.width
      && point.y >= bounds.y
      && point.y < bounds.y + bounds.height;
  });
  const eligible = matches.filter((entry) => entry.id !== excludedWindowId);
  return eligible.sort((left, right) => (
    atomWindowZOrder.indexOf(left.id) - atomWindowZOrder.indexOf(right.id)
  )).at(-1);
}

function broadcastAtomEvent(type, detail, exceptContents) {
  for (const entry of atomWindows.values()) {
    if (entry.window.isDestroyed() || entry.window.webContents === exceptContents) continue;
    entry.window.webContents.send("desktop:atom-event", { type, detail });
  }
}

function settleAtomMerge(requestId, accepted) {
  const pending = pendingAtomMerges.get(requestId);
  if (!pending) return;
  pendingAtomMerges.delete(requestId);
  clearTimeout(pending.timeout);
  pending.resolve(accepted === true);
}

function requestAtomMerge(source, target, payload, point) {
  const requestId = `atom-merge:${nextAtomMergeId++}`;
  const bounds = target.window.getContentBounds();
  return new Promise((resolve) => {
    const timeout = setTimeout(() => settleAtomMerge(requestId, false), 3_000);
    pendingAtomMerges.set(requestId, {
      sourceWindowId: source.id,
      targetWindowId: target.id,
      resolve,
      timeout,
    });
    target.window.webContents.send("desktop:atom-event", {
      type: "merge-pane",
      detail: {
        requestId,
        sourceWindowId: source.id,
        targetWindowId: target.id,
        workspaceId: payload.workspaceId,
        data: {
          ...payload.layout.root,
          paneId: payload.layout.root.id,
          sourceWindowId: source.id,
          transferId: payload.transferId,
          workspaceId: payload.workspaceId,
        },
        point: {
          x: point.x - bounds.x,
          y: point.y - bounds.y,
        },
      },
    });
  });
}

async function loadAtomWindowState() {
  try {
    const parsed = JSON.parse(await readFile(atomStatePath, "utf8"));
    if (parsed?.version !== 1 || !Array.isArray(parsed.windows)) return;
    for (const state of parsed.windows) {
      if (state?.role === "atom" && typeof state.id === "string" && state.layout?.root) {
        persistedAtomWindows.set(state.id, state);
        const numericId = Number.parseInt(state.id.split(":")[1], 10);
        if (Number.isFinite(numericId)) nextAtomWindowId = Math.max(nextAtomWindowId, numericId + 1);
      }
    }
  } catch {}
}

function scheduleAtomWindowStateWrite() {
  clearTimeout(persistAtomTimer);
  persistAtomTimer = setTimeout(() => {
    const windows = [...persistedAtomWindows.values()];
    void writeFile(atomStatePath, `${JSON.stringify({ version: 1, windows }, null, 2)}\n`).catch(() => undefined);
  }, 120);
}

function updateAtomWindowBounds(entry) {
  if (!entry || entry.role !== "atom" || entry.window.isDestroyed()) return;
  const previous = persistedAtomWindows.get(entry.id) ?? { id: entry.id, role: entry.role };
  persistedAtomWindows.set(entry.id, { ...previous, bounds: entry.window.getBounds() });
  scheduleAtomWindowStateWrite();
}

function visibleBoundsNear(point) {
  const display = screen.getDisplayNearestPoint({ x: Math.round(point?.x ?? 0), y: Math.round(point?.y ?? 0) });
  const area = display.workArea;
  const width = Math.min(514, area.width);
  const height = Math.min(532, area.height);
  return {
    x: Math.max(area.x, Math.min(Math.round(point?.x ?? area.x + 48) - 80, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(Math.round(point?.y ?? area.y + 48) - 24, area.y + area.height - height)),
    width,
    height,
  };
}

function clampAtomBounds(bounds) {
  if (!bounds) return undefined;
  const display = screen.getDisplayMatching(bounds);
  const area = display.workArea;
  const width = Math.min(Math.max(420, bounds.width ?? 514), area.width);
  const height = Math.min(Math.max(420, bounds.height ?? 532), area.height);
  return {
    x: Math.max(area.x, Math.min(bounds.x ?? area.x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(bounds.y ?? area.y, area.y + area.height - height)),
    width,
    height,
  };
}

async function createAtomWindow({ sessionId, workspaceId, point, layout, windowId: restoredId, bounds: restoredBounds } = {}) {
  if (!harnessUrl) throw new Error("Harness is not ready");
  const windowId = restoredId ?? `atom:${nextAtomWindowId++}`;
  const partition = `dsh-atom-${windowId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const window = createWindow({
    showOnReady: true,
    role: "atom",
    windowId,
    partition,
    bounds: clampAtomBounds(restoredBounds) ?? visibleBoundsNear(point),
  });
  const entry = atomWindows.get(windowId);
  window.on("move", () => updateAtomWindowBounds(entry));
  window.on("resize", () => updateAtomWindowBounds(entry));
  persistedAtomWindows.set(windowId, { id: windowId, role: "atom", workspaceId, layout, bounds: window.getBounds() });
  scheduleAtomWindowStateWrite();
  keepNavigationLocal(window, new URL(harnessUrl).origin);
  const url = new URL(harnessUrl);
  url.searchParams.set("dshAtomWindow", windowId);
  if (sessionId) url.searchParams.set("dshAtomSession", sessionId);
  if (workspaceId) url.searchParams.set("dshAtomWorkspace", workspaceId);
  await window.loadURL(url.href);
  if (!window.isDestroyed()) {
    syncMacOSTrafficLightPosition(window);
    if (!window.isVisible()) window.show();
  }
  return { windowId };
}

async function restoreAtomWindows() {
  for (const state of persistedAtomWindows.values()) {
    await createAtomWindow({
      windowId: state.id,
      workspaceId: state.workspaceId,
      sessionId: firstAtomSession(state.layout?.root),
      layout: state.layout,
      bounds: state.bounds,
    });
  }
}

function firstAtomSession(node) {
  if (!node) return undefined;
  return node.type === "pane" ? node.sessionId : firstAtomSession(node.first) ?? firstAtomSession(node.second);
}

function restartApplication() {
  if (quitting) return;
  app.relaunch();
  void shutdown().finally(() => app.quit());
}

async function handleCompanionCommand(command, send) {
  switch (command.type) {
    case "open-main":
      focusMainWindow();
      if (typeof command.sessionId === "string" && command.sessionId.length < 200) {
        pendingCompanionSession = command.sessionId;
        deliverCompanionSession();
      }
      break;
    case "open-browser": if (harnessUrl) await shell.openExternal(harnessUrl); break;
    case "login":
      if (typeof command.enabled === "boolean") app.setLoginItemSettings({ openAtLogin: command.enabled, openAsHidden: true, args: ["--hidden"] });
      send({ type: "login-state", enabled: app.getLoginItemSettings().openAtLogin });
      break;
    case "quit": app.quit(); break;
  }
}
function deliverCompanionSession() {
  if (!mainRendererReady || !pendingCompanionSession || mainWindow?.isDestroyed() !== false) return;
  mainWindow.webContents.send("desktop:companion-open", pendingCompanionSession);
}

function installApplicationMenu() {
  const template = [
    ...(process.platform === "darwin"
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { label: "显示快捷方式", click: () => nativeCompanion?.send({ type: "show" }) },
              { label: "最近结果", click: () => nativeCompanion?.send({ type: "results" }) },
              { label: "重新启动 DeepSeek Harness", click: restartApplication },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function launchDesktop() {
  mainWindow = createWindow({ showOnReady: !process.argv.includes("--hidden") });
  assertPrimaryBrowserWindow("Loading");
  await loadStatus();

  try {
    startupAbortController = new AbortController();
    harnessStartup = startHarness({
      executablePath: process.execPath,
      cliPath: harnessCliPath,
      patchPath: desktopPatchPath,
      pluginSourcePath: desktopUiPluginPath,
      userDataPath: app.getPath("userData"),
      companion: nativeConfiguration,
      signal: startupAbortController.signal,
      onUnexpectedExit: ({ code, signal, cause }) => {
        harness = undefined;
        if (quitting) return;
        const reason = cause?.message ?? `code=${String(code)}, signal=${String(signal)}`;
        void loadStatus("error", `Harness 意外退出：${reason}\n请退出应用后重试。`);
      },
    });
    harness = await harnessStartup;

    harnessUrl = harness.url;
    keepNavigationLocal(mainWindow, new URL(harnessUrl).origin);
    await mainWindow.loadURL(harnessUrl);
    assertPrimaryBrowserWindow("Harness");
    await restoreAtomWindows();
    if (nativeConfiguration) {
      try {
        nativeCompanion = await launchCompanion({ app, harness, configuration: nativeConfiguration,
          sourceRoot: join(sourceDirectory, ".."), onCommand: handleCompanionCommand,
          onExit: () => { nativeCompanion = undefined; },
        });
      } catch (error) { console.error("Native shortcuts unavailable:", conciseError(error)); }
    }
  } catch (error) {
    if (!quitting) {
      await loadStatus("error", `${conciseError(error)}\n请退出应用后重试。`);
    }
  } finally {
    harnessStartup = undefined;
    startupAbortController = undefined;
  }
}

async function inspectSingleRenderer(contents) {
  return contents.executeJavaScript(
    `(() => {
      const root = document.documentElement;
      const shell = document.querySelector('[data-dsh-desktop-shell]');
      const center = document.querySelector('[data-dsh-desktop-center]');
      const sidebar = document.querySelector('[data-dsh-desktop-sidebar-column]');
      return {
        plugin: root.dataset.dshDesktopUi,
        windowRole: root.dataset.dshWindowRole,
        composer: document.querySelector('[data-composer-card]') instanceof HTMLElement,
        shell: shell instanceof HTMLElement,
        centerBackground: center instanceof HTMLElement
          ? getComputedStyle(center).backgroundColor
          : null,
        sidebarBackground: sidebar instanceof HTMLElement
          ? getComputedStyle(sidebar).backgroundColor
          : null,
        overlayAttribute: root.hasAttribute('data-dsh-composer-overlay'),
        foregroundAttribute: root.hasAttribute('data-dsh-composer-foreground'),
        nativeGlassAttribute: root.hasAttribute('data-dsh-native-glass'),
        desktopBridge: Object.keys(window.desktop ?? {}).sort(),
      };
    })()`,
    true,
  );
}

async function runSmokeTest() {
  const smokeDirectory = await mkdtemp(join(tmpdir(), "dsh-desktop-smoke-"));
  const previousTaskUserDataPath = taskUserDataPath;
  taskUserDataPath = smokeDirectory;
  let controller;

  try {
    console.log("Starting DeepSeek Harness single-Renderer smoke test...");
    controller = await startHarness({
      executablePath: process.execPath,
      cliPath: harnessCliPath,
      patchPath: desktopPatchPath,
      pluginSourcePath: desktopUiPluginPath,
      userDataPath: smokeDirectory,
    });
    const response = await fetch(controller.url, {
      signal: AbortSignal.timeout(15_000),
    });
    const html = await response.text();
    if (!response.ok) throw new Error(`Harness 返回 HTTP ${response.status}`);
    if (!/<title>\s*DeepSeek Harness\s*<\/title>/i.test(html)) {
      throw new Error("Harness 页面标题不符合预期");
    }

    mainWindow = createWindow({ showOnReady: false, partition: "dsh-smoke" });
    keepNavigationLocal(mainWindow, new URL(controller.url).origin);
    await mainWindow.loadURL(controller.url);
    assertPrimaryBrowserWindow("Smoke");
    assertMacOSTrafficLightPosition("Smoke", mainWindow);

    const deadline = Date.now() + 15_000;
    let state;
    while (Date.now() < deadline) {
      state = await inspectSingleRenderer(mainWindow.webContents);
      if (state.plugin === "jesse-composer" && state.composer && state.shell) break;
      await delay(100);
    }
    if (state?.plugin !== "jesse-composer" || !state.composer || !state.shell) {
      throw new Error(`${productName} UI 插件未完整加载：${JSON.stringify(state)}`);
    }
    if (
      state.windowRole !== "main" ||
      state.overlayAttribute ||
      state.foregroundAttribute ||
      state.nativeGlassAttribute ||
      JSON.stringify(state.desktopBridge) !==
        JSON.stringify([
          "atomContext",
          "closeAtomWindow",
          "createAtomWindow",
          "createTaskScope",
          "detachAtomSession",
          "focusAtomWindow",
          "onAtomEvent",
          "publishAtomEvent",
          "restart",
          "setThemeSource",
        ])
    ) {
      throw new Error(`检测到多层渲染残留：${JSON.stringify(state)}`);
    }
    if (state.centerBackground === "rgba(0, 0, 0, 0)") {
      throw new Error(`主对话区必须保持不透明：${JSON.stringify(state)}`);
    }

    const onboardingDeadline = Date.now() + 15_000;
    let onboardingState;
    while (Date.now() < onboardingDeadline) {
      onboardingState = await mainWindow.webContents.executeJavaScript(
        `(() => {
          const dialog = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')]
            .find((node) => node.textContent?.includes('API key'));
          const later = dialog === undefined ? undefined : [...dialog.querySelectorAll('button')]
            .find((button) => button.textContent?.trim() === 'Later');
          const continueButton = [...document.querySelectorAll('[role="dialog"] button')]
            .find((button) => button.textContent?.trim() === 'Continue');
          if (continueButton instanceof HTMLButtonElement) {
            continueButton.click();
            return { found: false, continuedNotice: true };
          }
          if (!(later instanceof HTMLButtonElement)) return {
            found: false,
            dialogs: [...document.querySelectorAll('[role="dialog"]')]
              .map((node) => node.textContent?.trim()),
          };
          later.click();
          return { found: true };
        })()`,
        true,
      );
      if (onboardingState.found) break;
      await delay(100);
    }
    if (!onboardingState.found) {
      throw new Error(`首次 DeepSeek API onboarding 未出现：${JSON.stringify(onboardingState)}`);
    }

    const firstComposerDeadline = Date.now() + 15_000;
    let firstComposerOpenedModels = false;
    while (Date.now() < firstComposerDeadline) {
      firstComposerOpenedModels = await mainWindow.webContents.executeJavaScript(
        `(() => {
          const input = document.querySelector('[data-dsh-composer-input] textarea');
          if (!(input instanceof HTMLTextAreaElement) || input.disabled || !input.readOnly ||
            input.getAttribute('aria-haspopup') !== 'dialog') return false;
          input.click();
          return true;
        })()`,
        true,
      );
      if (firstComposerOpenedModels) break;
      await delay(100);
    }
    if (!firstComposerOpenedModels) throw new Error("首次无模型 composer 输入区不可点击");
    await delay(100);
    const firstComposerModelsActive = await mainWindow.webContents.executeJavaScript(
      `(() => [...document.querySelectorAll('[role="dialog"] button[aria-current="true"]')]
        .some((button) => button.textContent?.trim() === 'Models'))()`,
      true,
    );
    if (!firstComposerModelsActive) {
      throw new Error("首次无模型 composer 输入区未打开 Settings → Models");
    }
    const firstModelsClosed = await mainWindow.webContents.executeJavaScript(
      `(() => {
        const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
        const close = dialog === null ? undefined : [...dialog.querySelectorAll('button')]
          .find((button) => button.textContent?.trim() === 'Close');
        if (!(close instanceof HTMLButtonElement)) return false;
        close.click();
        return true;
      })()`,
      true,
    );
    if (!firstModelsClosed) throw new Error("首次 Models Settings 无法关闭");
    const firstModelsCloseDeadline = Date.now() + 2_000;
    let firstModelsDialogClosed = false;
    while (Date.now() < firstModelsCloseDeadline) {
      firstModelsDialogClosed = await mainWindow.webContents.executeJavaScript(
        `document.querySelector('[role="dialog"][aria-modal="true"]') === null`,
        true,
      );
      if (firstModelsDialogClosed) break;
      await delay(50);
    }
    if (!firstModelsDialogClosed) throw new Error("首次 Models Settings 关闭未完成");

    const modelDeadline = Date.now() + 15_000;
    let unconfiguredModel;
    while (Date.now() < modelDeadline) {
      unconfiguredModel = await mainWindow.webContents.executeJavaScript(
        `(() => {
          const model = [...document.querySelectorAll('button')]
            .find((button) => button.getAttribute('aria-label') === 'Add a model');
          const input = document.querySelector('[data-dsh-composer-input] textarea');
          return {
            model: model instanceof HTMLButtonElement,
            input: input instanceof HTMLTextAreaElement,
            inputDisabled: input instanceof HTMLTextAreaElement ? input.disabled : undefined,
            inputReadOnly: input instanceof HTMLTextAreaElement ? input.readOnly : undefined,
			permissionControlVisible: [...document.querySelectorAll('button')].some((button) => {
			  const label = button.getAttribute('aria-label') ?? '';
			  return label.startsWith('Access mode, current:') || label.startsWith('访问模式，当前：');
			}),
          };
        })()`,
        true,
      );
      if (unconfiguredModel.model && unconfiguredModel.input) break;
      await delay(100);
    }
    if (
      !unconfiguredModel?.model ||
      !unconfiguredModel.input ||
      unconfiguredModel.inputDisabled ||
		!unconfiguredModel.inputReadOnly ||
		unconfiguredModel.permissionControlVisible
	) {
      throw new Error(`无模型 Task composer 状态错误：${JSON.stringify(unconfiguredModel)}`);
    }

    const taskDirectories = await readdir(join(smokeDirectory, "tasks"), {
      withFileTypes: true,
    });
    if (!taskDirectories.some((entry) => entry.isDirectory() && entry.name.startsWith("session-"))) {
      throw new Error("Task scope 未创建在 smoke userData/tasks 下");
    }

    const menuReadinessDeadline = Date.now() + 15_000;
    let composerBeforeMenu;
    while (Date.now() < menuReadinessDeadline) {
      composerBeforeMenu = await mainWindow.webContents.executeJavaScript(
        `(() => {
        const kinds = [...document.querySelectorAll('[data-dsh-composer-menu-trigger]')]
          .map((element) => element.dataset.dshComposerMenuTrigger);
        const trigger = document.querySelector(
          '[data-dsh-hero-workspace-row] button[data-dsh-composer-menu-trigger="preset"]',
        );
        const input = document.querySelector('[data-dsh-composer-input] textarea');
        if (
          !(trigger instanceof HTMLButtonElement) ||
          trigger.disabled ||
          !(input instanceof HTMLTextAreaElement)
        ) {
          return { clicked: false, ready: false, kinds };
        }
        trigger.focus();
        const triggerFocused = document.activeElement === trigger;
        trigger.click();
        return {
          clicked: true,
          ready: true,
          triggerFocused,
          kind: trigger.dataset.dshComposerMenuTrigger,
          kinds,
        };
      })()`,
        true,
      );
      if (composerBeforeMenu.ready) break;
      await delay(100);
    }

    const menuOpenDeadline = Date.now() + 2_000;
    let composerMenu;
    while (Date.now() < menuOpenDeadline) {
      composerMenu = await mainWindow.webContents.executeJavaScript(
        `(() => {
        const trigger = document.querySelector(
          '[data-dsh-hero-workspace-row] button[data-dsh-composer-menu-trigger="preset"]',
        );
        const menu = [...document.querySelectorAll('[role="menu"]')].find((element) => {
          if (!(element instanceof HTMLElement)) return false;
          const style = getComputedStyle(element);
          return style.display !== 'none' && style.visibility !== 'hidden' &&
            element.getClientRects().length > 0;
        });
        return {
          opened: menu instanceof HTMLElement,
          expanded: trigger?.getAttribute('aria-expanded') ?? null,
          itemCount: menu?.querySelectorAll('[role="menuitem"]').length ?? 0,
        };
      })()`,
        true,
      );
      if (composerMenu.opened && composerMenu.expanded === "true") break;
      await delay(50);
    }
    const menuKinds = [...new Set(composerBeforeMenu?.kinds ?? [])].sort();
    if (
      !composerBeforeMenu.clicked ||
      !menuKinds.includes("workspace") ||
      !composerMenu.opened ||
      composerMenu.expanded !== "true" ||
      composerMenu.itemCount < 1
    ) {
      throw new Error(
        `Composer 菜单未留在主 Renderer：${JSON.stringify({
          composerBeforeMenu,
          composerMenu,
        })}`,
      );
    }
    assertPrimaryBrowserWindow("Composer menu");
    mainWindow.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    mainWindow.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });

    console.log(`${productName} single-Renderer smoke test passed: ${controller.url}`);
    return 0;
  } catch (error) {
    console.error(`${productName} smoke test failed: ${conciseError(error)}`);
    return 1;
  } finally {
    taskUserDataPath = previousTaskUserDataPath;
    mainWindow?.destroy();
    mainWindow = undefined;
    await controller?.stop();
    await rm(smokeDirectory, { recursive: true, force: true });
  }
}

async function shutdown() {
  if (shutdownPromise !== undefined) return shutdownPromise;
  quitting = true;
  shutdownPromise = (async () => {
    await nativeCompanion?.stop();
    nativeCompanion = undefined;
    startupAbortController?.abort();
    await harnessStartup?.catch(() => undefined);
    await harness?.stop();
    harness = undefined;
  })();
  return shutdownPromise;
}

function isAtomDetachPayload(payload) {
  return typeof payload?.sessionId === "string"
    && typeof payload?.paneId === "string"
    && typeof payload?.transferId === "string"
    && payload.layout?.root?.type === "pane";
}

async function detachAtomSessionAtPoint(source, payload, point) {
  const target = atomWindowAtPoint(point);
  if (target && target.id !== source.id) {
    const merged = await requestAtomMerge(source, target, payload, point);
    return { detached: false, merged, moved: false, windowId: target.id };
  }
  const sourceBounds = source.window.getBounds();
  if (
    point.x >= sourceBounds.x
    && point.x < sourceBounds.x + sourceBounds.width
    && point.y >= sourceBounds.y
    && point.y < sourceBounds.y + sourceBounds.height
  ) {
    return { detached: false, merged: false, moved: false, windowId: source.id };
  }
  if (payload.canCreateWindow === false) {
    return { detached: false, merged: false, moved: false, windowId: source.id };
  }
  const created = await createAtomWindow({
    sessionId: payload.sessionId,
    workspaceId: payload.workspaceId,
    layout: payload.layout,
    point,
  });
  return { ...created, detached: true, merged: false, moved: false };
}

app.on("before-quit", (event) => {
  if ((harness === undefined && harnessStartup === undefined) || quitting) return;
  event.preventDefault();
  void shutdown().finally(() => app.quit());
});

app.on("window-all-closed", () => { if (!nativeCompanion?.running) app.quit(); });
app.on("activate", focusMainWindow);

if (hasSingleInstanceLock) {
  app.on("second-instance", focusMainWindow);
  ipcMain.on("desktop:companion-ready", (event) => {
    if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame) return;
    mainRendererReady = true;
    deliverCompanionSession();
  });
  ipcMain.on("desktop:companion-opened", (event, sessionId) => {
    if (event.sender === mainWindow?.webContents && sessionId === pendingCompanionSession) pendingCompanionSession = undefined;
  });
  ipcMain.on("desktop:restart", (event) => {
    if (!event.senderFrame.url.startsWith("file://")) return;
    restartApplication();
  });
  ipcMain.on("desktop:set-theme-source", (event, themeSource) => {
    if (!atomEntryFor(event.sender)) return;
    if (themeSource !== "light" && themeSource !== "dark" && themeSource !== "system") return;
    if (nativeTheme.themeSource === themeSource) return;
    nativeTheme.themeSource = themeSource;
  });
  ipcMain.handle("desktop:create-task-scope", (event) =>
    handleCreateTaskScope(event, mainWindow?.webContents, taskUserDataPath),
  );
  ipcMain.handle("desktop:atom-context", (event) => {
    const entry = atomEntryFor(event.sender);
    if (!entry) return undefined;
    const persisted = persistedAtomWindows.get(entry.id);
    return {
      windowId: entry.id,
      role: entry.role,
      workspaceId: persisted?.workspaceId,
      layout: persisted?.layout,
    };
  });
  ipcMain.handle("desktop:atom-create-window", (event, payload) => {
    if (!atomEntryFor(event.sender)) throw new Error("Unknown desktop window");
    return createAtomWindow(payload);
  });
  ipcMain.handle("desktop:atom-detach-session", async (event, payload) => {
    const source = atomEntryFor(event.sender);
    if (!source) throw new Error("Unknown desktop window");
    if (!isAtomDetachPayload(payload)) throw new TypeError("Invalid Session detach payload");
    return detachAtomSessionAtPoint(source, payload, screen.getCursorScreenPoint());
  });
  ipcMain.on("desktop:atom-close-window", (event) => {
    const source = atomEntryFor(event.sender);
    if (source?.role === "atom") source.window.close();
  });
  ipcMain.on("desktop:atom-publish", (event, message) => {
    const source = atomEntryFor(event.sender);
    if (!source || !message || typeof message.type !== "string") return;
    if (message.type === "merge-result") {
      const pending = pendingAtomMerges.get(message.detail?.requestId);
      if (pending?.targetWindowId === source.id) {
        settleAtomMerge(message.detail.requestId, message.detail.accepted);
      }
      return;
    }
    if (message.type === "pane-transfer-committed") {
      cancelActiveAtomDrag(message.detail?.transferId);
    }
    if (message.type === "layout-state" && source.role === "atom" && message.detail?.layout?.root) {
      const previous = persistedAtomWindows.get(source.id) ?? { id: source.id, role: source.role };
      persistedAtomWindows.set(source.id, {
        ...previous,
        workspaceId: message.detail.workspaceId,
        layout: message.detail.layout,
        bounds: source.window.getBounds(),
      });
      scheduleAtomWindowStateWrite();
      return;
    }
    broadcastAtomEvent(message.type, { ...message.detail, sourceWindowId: source.id }, event.sender);
  });
  ipcMain.on("desktop:atom-focus-window", (event, windowId) => {
    if (!atomEntryFor(event.sender)) return;
    const target = atomWindows.get(windowId)?.window;
    if (!target || target.isDestroyed()) return;
    if (target.isMinimized()) target.restore();
    target.show();
    target.focus();
  });
}

async function main() {
  if (!hasSingleInstanceLock) {
    app.quit();
    return;
  }

  await app.whenReady();
  await loadAtomWindowState();

  if (smokeTest) {
    app.dock?.hide();
    const exitCode = await runSmokeTest();
    app.exit(exitCode);
    return;
  }

  if (supportsNativeCompanion()) nativeConfiguration = companionConfiguration(app.getPath("userData"));
  installApplicationMenu();
  await launchDesktop();
}

void main().catch((error) => {
  console.error(`${productName} failed to start: ${conciseError(error)}`);
  app.exit(1);
});
