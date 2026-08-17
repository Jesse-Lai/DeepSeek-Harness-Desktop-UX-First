import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain, Menu, screen, shell } from "electron";
import { startHarness } from "./harness.js";

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
const composerGlass = process.platform === "darwin"
  ? require(join(
      sourceDirectory,
      "..",
      "native",
      "build",
      "macos-composer-glass.node",
    ))
  : undefined;
const composerHoverSmokeTest = process.argv.includes("--composer-hover-smoke-test");
const modalSmokeTest = process.argv.includes("--modal-smoke-test");
const smokeTest =
  process.argv.includes("--smoke-test") || composerHoverSmokeTest || modalSmokeTest;
const hasSingleInstanceLock = smokeTest || app.requestSingleInstanceLock();
const macOSTrafficLightPosition = { x: 14, y: 14 };
let mainWindow;
let composerForegroundWindow;
let composerForegroundReady = false;
let composerFrame;
let composerHeroFrame;
let composerOverlayInteraction = { captureAll: false, regions: [], card: undefined };
let composerForegroundIgnoringMouse;
let composerSessionContext;
let composerSessionRevision = 0;
let composerHoverForwardTimer;
let composerHoverForwardInside = false;
let composerHoverForwardPoint;
let modalOverlayVisible = false;
let modalOverlayMaskAlpha = 0;
// Never paint the child Composer until the current main document has reported
// whether a modal owns the foreground.
let modalOverlayStateKnown = false;
let harness;
let harnessStartup;
let startupAbortController;
let quitting = false;
let shutdownPromise;

app.setName("DSH Desktop");

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
  composerGlass?.setTrafficLightPosition(
    targetWindow.getNativeWindowHandle(),
    macOSTrafficLightPosition,
  );
}

function getMacOSTrafficLightMetrics(targetWindow = mainWindow) {
  if (
    process.platform !== "darwin" ||
    composerGlass === undefined ||
    targetWindow?.isDestroyed() !== false
  ) {
    return undefined;
  }
  return composerGlass.getTrafficLightMetrics(targetWindow.getNativeWindowHandle());
}

function assertMacOSTrafficLightPosition(label, targetWindow) {
  if (process.platform !== "darwin") return;
  const metrics = getMacOSTrafficLightMetrics(targetWindow);
  if (
    metrics?.x !== macOSTrafficLightPosition.x ||
    metrics?.y !== macOSTrafficLightPosition.y ||
    metrics?.width !== 14 ||
    metrics?.height !== 14 ||
    metrics?.centerSpacing !== 23
  ) {
    throw new Error(`${label} Traffic Lights 原生 frame 错误：${JSON.stringify(metrics)}`);
  }
  console.log(`${label} Traffic Lights: ${JSON.stringify(metrics)}`);
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

function setMainComposerForeground(enabled) {
  if (mainWindow?.isDestroyed() !== false) return;
  void mainWindow.webContents.executeJavaScript(
    enabled
      ? 'document.documentElement.dataset.dshComposerForeground = ""'
      : "delete document.documentElement.dataset.dshComposerForeground",
    true,
  ).catch(() => undefined);
}

function setComposerForegroundIgnoresMouseEvents(ignore) {
  const overlay = composerForegroundWindow;
  if (
    overlay?.isDestroyed() !== false ||
    composerForegroundIgnoringMouse === ignore
  ) {
    return;
  }
  composerForegroundIgnoringMouse = ignore;
  if (ignore) overlay.setIgnoreMouseEvents(true, { forward: true });
  else overlay.setIgnoreMouseEvents(false);
}

function pointInsideComposerInteraction(point) {
  if (composerOverlayInteraction.captureAll) return true;
  return composerOverlayInteraction.regions.some((region) =>
    point.x >= region.x &&
    point.y >= region.y &&
    point.x < region.x + region.width &&
    point.y < region.y + region.height
  );
}

function composerFramesEqual(left, right) {
  if (left === undefined || right === undefined) return left === right;
  return left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height;
}

function updateComposerLayers() {
  if (
    mainWindow?.isDestroyed() !== false ||
    composerForegroundWindow?.isDestroyed() !== false
  ) {
    return;
  }

  const frame = composerFrame;
  if (
    !modalOverlayStateKnown ||
    modalOverlayVisible ||
    frame === undefined ||
    frame.width <= 0 ||
    frame.height <= 0 ||
    !composerForegroundReady
  ) {
    setComposerForegroundIgnoresMouseEvents(true);
    composerForegroundWindow.hide();
    setMainComposerForeground(false);
    removeComposerGlassPanel();
    return;
  }

  const contentBounds = mainWindow.getContentBounds();
  composerForegroundWindow.setBounds(contentBounds);
  const cardBottom = Math.max(0, contentBounds.height - frame.y - frame.height);
  const hero = composerHeroFrame;
  void composerForegroundWindow.webContents.executeJavaScript(
    `(() => {
      const root = document.documentElement;
      root.style.setProperty("--dsh-composer-overlay-card-left", "${frame.x}px");
      root.style.setProperty("--dsh-composer-overlay-card-bottom", "${cardBottom}px");
      root.style.setProperty("--dsh-composer-overlay-card-width", "${frame.width}px");
      root.style.setProperty("--dsh-composer-overlay-hero-left", "${hero?.x ?? 0}px");
      root.style.setProperty("--dsh-composer-overlay-hero-top", "${hero?.y ?? 0}px");
      root.style.setProperty("--dsh-composer-overlay-hero-width", "${hero?.width ?? 0}px");
      root.toggleAttribute("data-dsh-composer-overlay-has-layout", true);
      root.toggleAttribute("data-dsh-composer-overlay-has-hero", ${hero !== undefined});
    })()`,
    true,
  ).catch(() => undefined);

  composerGlass?.setComposerGlassPanelFrame(
    mainWindow.getNativeWindowHandle(),
    composerForegroundWindow.getNativeWindowHandle(),
    composerOverlayInteraction.card ?? frame,
  );
  setMainComposerForeground(true);
  if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
    composerForegroundWindow.showInactive();
  }
}

function setModalOverlayVisible(visible, maskAlpha = 0) {
  const normalizedMaskAlpha = Math.max(0, Math.min(1, maskAlpha));
  const stateWasKnown = modalOverlayStateKnown;
  if (
    stateWasKnown &&
    modalOverlayVisible === visible &&
    modalOverlayMaskAlpha === normalizedMaskAlpha
  ) {
    return;
  }
  const visibilityChanged = !stateWasKnown || modalOverlayVisible !== visible;
  modalOverlayStateKnown = true;
  modalOverlayVisible = visible;
  modalOverlayMaskAlpha = normalizedMaskAlpha;
  if (composerGlass !== undefined && mainWindow?.isDestroyed() === false) {
    composerGlass.setModalMask(mainWindow.getNativeWindowHandle(), {
      visible,
      alpha: normalizedMaskAlpha,
    });
  }
  if (!visibilityChanged) return;
  if (!visible) {
    updateComposerLayers();
    return;
  }

  composerForegroundWindow?.hide();
  setMainComposerForeground(false);
  removeComposerGlassPanel();
}

function removeComposerGlassPanel() {
  if (
    composerGlass === undefined ||
    mainWindow?.isDestroyed() !== false
  ) {
    return;
  }
  composerGlass.removeComposerGlassPanel(mainWindow.getNativeWindowHandle());
}

function resetComposerHoverForwardState({ sendLeave = false } = {}) {
  const overlay = composerForegroundWindow;
  if (
    sendLeave &&
    composerHoverForwardInside &&
    overlay?.isDestroyed() === false
  ) {
    overlay.webContents.send("desktop:composer-hover-point", null);
  }
  composerHoverForwardInside = false;
  composerHoverForwardPoint = undefined;
}

function forwardInactiveComposerMouseMove() {
  const overlay = composerForegroundWindow;
  if (
    !composerForegroundReady ||
    overlay?.isDestroyed() !== false ||
    !overlay.isVisible()
  ) {
    setComposerForegroundIgnoresMouseEvents(true);
    resetComposerHoverForwardState({
      sendLeave: overlay?.isDestroyed() === false && !overlay.isFocused(),
    });
    return;
  }

  const bounds = overlay.getContentBounds();
  const cursor = screen.getCursorScreenPoint();
  const point = {
    x: Math.round(cursor.x - bounds.x),
    y: Math.round(cursor.y - bounds.y),
  };
  const inside =
    point.x >= 0 &&
    point.y >= 0 &&
    point.x < bounds.width &&
    point.y < bounds.height;
  const capturesPoint = inside && pointInsideComposerInteraction(point);
  setComposerForegroundIgnoresMouseEvents(!capturesPoint);
  if (!capturesPoint || overlay.isFocused() || !app.isActive()) {
    resetComposerHoverForwardState({ sendLeave: true });
    return;
  }
  if (
    composerHoverForwardInside &&
    composerHoverForwardPoint?.x === point.x &&
    composerHoverForwardPoint?.y === point.y
  ) {
    return;
  }

  // sendInputEvent only updates Chromium's hover state when its BrowserWindow
  // is focused. This child intentionally stays inactive, so let the preload
  // hit-test the point and mark the hovered action in the shared DOM instead.
  overlay.webContents.send("desktop:composer-hover-point", point);
  composerHoverForwardInside = true;
  composerHoverForwardPoint = point;
}

function startComposerHoverForwarding() {
  if (composerHoverForwardTimer !== undefined) return;
  composerHoverForwardTimer = setInterval(forwardInactiveComposerMouseMove, 16);
  composerHoverForwardTimer.unref?.();
}

function stopComposerHoverForwarding() {
  if (composerHoverForwardTimer !== undefined) {
    clearInterval(composerHoverForwardTimer);
    composerHoverForwardTimer = undefined;
  }
  resetComposerHoverForwardState();
}

function destroyComposerForeground({ preserveFrame = false } = {}) {
  stopComposerHoverForwarding();
  composerForegroundReady = false;
  composerOverlayInteraction = { captureAll: false, regions: [], card: undefined };
  composerForegroundIgnoringMouse = undefined;
  if (!preserveFrame) {
    composerFrame = undefined;
    composerHeroFrame = undefined;
  }
  setMainComposerForeground(false);
  removeComposerGlassPanel();
  if (composerForegroundWindow?.isDestroyed() === false) {
    composerForegroundWindow.destroy();
  }
  composerForegroundWindow = undefined;
}

function syncComposerNavigation(source, target) {
  if (source?.isDestroyed() !== false || target?.isDestroyed() !== false) return;
  const targetUrl = source.webContents.getURL();
  if (!targetUrl || target.webContents.getURL() === targetUrl) return;
  void target.loadURL(targetUrl).catch(() => undefined);
}

function normalizeComposerSessionContext(value) {
  if (value === null || typeof value !== "object") return undefined;
  const sessionId = value.sessionId === null ? null : value.sessionId;
  const workspaceId = value.workspaceId === null ? null : value.workspaceId;
  if (
    (sessionId !== null && (typeof sessionId !== "string" || sessionId.length > 500)) ||
    (workspaceId !== null && (typeof workspaceId !== "string" || workspaceId.length > 500))
  ) {
    return undefined;
  }
  return { sessionId, workspaceId };
}

function normalizeComposerOverlayInteraction(value) {
  if (value === null || typeof value !== "object") return undefined;
  const captureAll = value.captureAll === true;
  if (!Array.isArray(value.regions) || value.regions.length > 8) return undefined;
  const regions = [];
  for (const region of value.regions) {
    if (region === null || typeof region !== "object") return undefined;
    const values = [region.x, region.y, region.width, region.height];
    if (!values.every((entry) => typeof entry === "number" && Number.isFinite(entry))) {
      return undefined;
    }
    if (region.width <= 0 || region.height <= 0) continue;
    regions.push({
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
    });
  }
  const card = value.card === null || value.card === undefined
    ? undefined
    : normalizeComposerFrame(value.card);
  if (value.card !== null && value.card !== undefined && card === undefined) {
    return undefined;
  }
  return { captureAll, regions, card };
}

function normalizeComposerFrame(value) {
  if (value === null || typeof value !== "object") return undefined;
  const values = [value.x, value.y, value.width, value.height];
  if (!values.every((entry) => typeof entry === "number" && Number.isFinite(entry))) {
    return undefined;
  }
  return {
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height,
  };
}

function sendComposerSessionContext() {
  if (
    composerSessionContext === undefined ||
    composerForegroundWindow?.isDestroyed() !== false
  ) {
    return;
  }
  composerForegroundWindow.webContents.send(
    "desktop:composer-session-context",
    composerSessionContext,
  );
}

async function createComposerForeground(url, localOrigin) {
  if (
    process.platform !== "darwin" ||
    composerGlass === undefined ||
    mainWindow?.isDestroyed() !== false
  ) {
    return;
  }

  destroyComposerForeground({ preserveFrame: true });
  const overlay = new BrowserWindow({
    parent: mainWindow,
    width: 1,
    height: 1,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    roundedCorners: false,
    closable: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    acceptFirstMouse: true,
    webPreferences: {
      preload: join(sourceDirectory, "preload.cjs"),
      additionalArguments: ["--dsh-composer-overlay"],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  composerForegroundWindow = overlay;
  composerForegroundIgnoringMouse = undefined;
  setComposerForegroundIgnoresMouseEvents(true);
  keepNavigationLocal(overlay, localOrigin);

  const syncToOverlay = () => syncComposerNavigation(mainWindow, overlay);
  const syncToMain = () => syncComposerNavigation(overlay, mainWindow);
  mainWindow.webContents.on("did-navigate", syncToOverlay);
  mainWindow.webContents.on("did-navigate-in-page", syncToOverlay);
  overlay.webContents.on("did-navigate", syncToMain);
  overlay.webContents.on("did-navigate-in-page", syncToMain);
  overlay.webContents.on("render-process-gone", () => destroyComposerForeground());
  overlay.on("blur", () => {
    if (overlay.isDestroyed()) return;
    overlay.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    overlay.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
  });
  overlay.on("closed", () => {
    mainWindow?.webContents.off("did-navigate", syncToOverlay);
    mainWindow?.webContents.off("did-navigate-in-page", syncToOverlay);
    if (composerForegroundWindow === overlay) {
      composerForegroundWindow = undefined;
      composerForegroundReady = false;
      setMainComposerForeground(false);
      removeComposerGlassPanel();
    }
  });

  try {
    await overlay.loadURL(url);
    const deadline = Date.now() + 15_000;
    let ready = false;
    while (!ready && Date.now() < deadline && !overlay.isDestroyed()) {
      ready = await overlay.webContents.executeJavaScript(
        `document.documentElement.hasAttribute("data-dsh-composer-overlay") &&
         document.querySelector("[data-composer-card]") instanceof HTMLElement`,
        true,
      );
      if (!ready) await delay(50);
    }
    if (!ready || overlay.isDestroyed()) throw new Error("Composer 前景层未就绪");
    composerForegroundReady = true;
    sendComposerSessionContext();
    updateComposerLayers();
    startComposerHoverForwarding();
    syncMacOSTrafficLightPosition();
  } catch (error) {
    console.error(`Composer foreground failed: ${conciseError(error)}`);
    destroyComposerForeground();
  }
}

function createWindow({ showOnReady = true } = {}) {
  const isMacOS = process.platform === "darwin";
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    title: "DSH Desktop",
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
    },
  });

  const syncTrafficLightPosition = () => syncMacOSTrafficLightPosition(window);
  window.webContents.on(
    "did-start-navigation",
    (_event, _url, _isSameDocument, isMainFrame) => {
      if (!isMainFrame || mainWindow !== window) return;
      modalOverlayStateKnown = false;
      updateComposerLayers();
    },
  );
  window.webContents.on("did-finish-load", syncTrafficLightPosition);
  window.once("ready-to-show", () => {
    syncTrafficLightPosition();
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
  window.once("close", () => {
    destroyComposerForeground();
    if (composerGlass !== undefined) {
      composerGlass.removeSidebarButtonGlass(window.getNativeWindowHandle());
      composerGlass.removeScrollButtonGlass(window.getNativeWindowHandle());
    }
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = undefined;
  });
  window.on("move", updateComposerLayers);
  window.on("resize", updateComposerLayers);
  window.on("show", updateComposerLayers);
  window.on("restore", updateComposerLayers);
  window.on("hide", () => composerForegroundWindow?.hide());
  window.on("minimize", () => composerForegroundWindow?.hide());
  return window;
}

function restartApplication() {
  if (quitting) return;
  app.relaunch();
  void shutdown().finally(() => app.quit());
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
  mainWindow = createWindow();
  await loadStatus();

  try {
    startupAbortController = new AbortController();
    harnessStartup = startHarness({
      executablePath: process.execPath,
      cliPath: harnessCliPath,
      patchPath: desktopPatchPath,
      pluginSourcePath: desktopUiPluginPath,
      userDataPath: app.getPath("userData"),
      signal: startupAbortController.signal,
      onUnexpectedExit: ({ code, signal, cause }) => {
        harness = undefined;
        if (quitting) return;
        const reason = cause?.message ?? `code=${String(code)}, signal=${String(signal)}`;
        void loadStatus("error", `Harness 意外退出：${reason}\n请退出应用后重试。`);
      },
    });
    harness = await harnessStartup;

    const localOrigin = new URL(harness.url).origin;
    keepNavigationLocal(mainWindow, localOrigin);
    await mainWindow.loadURL(harness.url);
    await createComposerForeground(harness.url, localOrigin);
  } catch (error) {
    if (!quitting) {
      await loadStatus("error", `${conciseError(error)}\n请退出应用后重试。`);
    }
  } finally {
    harnessStartup = undefined;
    startupAbortController = undefined;
  }
}

async function verifyComposerActionHover(composerContents) {
  const usesInactiveHoverBridge =
    composerForegroundWindow?.webContents === composerContents;
  const targets = await composerContents.executeJavaScript(
    `(() => {
      const selectors = [
        ':is([data-dsh-composer-command] button, button[data-dsh-composer-command])',
        '[data-dsh-composer-modes] button',
        '[data-dsh-composer-trailing] button[data-dsh-composer-menu-trigger="model"]',
        '[data-dsh-hero-workspace-row] button[data-dsh-composer-menu-trigger="workspace"]',
        '[data-dsh-hero-workspace-row] button[data-dsh-composer-menu-trigger="preset"]',
      ];
      return selectors.map((selector) => {
        const target = document.querySelector(selector);
        if (!(target instanceof HTMLElement)) return { selector, missing: true };
        const rect = target.getBoundingClientRect();
        return {
          selector,
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
          disabled: target.matches(':disabled'),
          baseBackground: getComputedStyle(target).backgroundColor,
        };
      });
    })()`,
    true,
  );
  const states = [];
  for (const target of targets) {
    if (target.missing) {
      states.push(target);
      continue;
    }
    if (usesInactiveHoverBridge) {
      composerContents.send("desktop:composer-hover-point", {
        x: target.x,
        y: target.y,
      });
    } else {
      composerContents.sendInputEvent({
        type: "mouseMove",
        x: target.x,
        y: target.y,
      });
    }
    await delay(20);
    const state = await composerContents.executeJavaScript(
      `(() => {
        const target = document.querySelector(${JSON.stringify(target.selector)});
        const hit = document.elementFromPoint(${JSON.stringify(target.x)}, ${JSON.stringify(target.y)});
        return target instanceof HTMLElement
          ? {
              hovered: target.matches(':hover'),
              forwarded: target.hasAttribute('data-dsh-forwarded-hover'),
              hoverBackground: getComputedStyle(target).backgroundColor,
              hit: hit instanceof HTMLElement
                ? hit.outerHTML.slice(0, 500)
                : String(hit),
            }
          : null;
      })()`,
      true,
    );
    states.push({ ...target, ...state });
  }
  if (usesInactiveHoverBridge) {
    composerContents.send("desktop:composer-hover-point", null);
  } else {
    composerContents.sendInputEvent({ type: "mouseLeave", x: 0, y: 0 });
  }
  const actionableStates = states.filter(
    (state) => state.missing !== true && state.disabled !== true,
  );
  if (
    actionableStates.length < 2 ||
    actionableStates.some(
      (state) =>
        (state.hovered !== true && state.forwarded !== true) ||
        state.hoverBackground === state.baseBackground,
    )
  ) {
    const diagnostic = await composerContents.executeJavaScript(
      `(() => {
        const card = document.querySelector('[data-composer-card]');
        return {
          url: location.href,
          overlay: document.documentElement.hasAttribute('data-dsh-composer-overlay'),
          sessionPending: document.documentElement.hasAttribute('data-dsh-composer-session-pending'),
          card: card instanceof HTMLElement ? card.outerHTML.slice(0, 5000) : null,
        };
      })()`,
      true,
    );
    throw new Error(
      `Composer action 的未聚焦 hover 转发失败：${JSON.stringify({ states, diagnostic })}`,
    );
  }
  return states;
}

async function runSmokeTest() {
  const smokeDirectory = await mkdtemp(join(tmpdir(), "dsh-desktop-smoke-"));
  let controller;
  let smokeWindow;

  try {
    console.log("Starting DeepSeek Harness smoke test...");
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

    smokeWindow = createWindow({ showOnReady: false });
    mainWindow = smokeWindow;
    smokeWindow.webContents.setBackgroundThrottling(false);
    await loadStatus();
    assertMacOSTrafficLightPosition("Loading", smokeWindow);
    const localOrigin = new URL(controller.url).origin;
    keepNavigationLocal(smokeWindow, localOrigin);
    await smokeWindow.loadURL(controller.url);
    await createComposerForeground(controller.url, localOrigin);
    assertMacOSTrafficLightPosition("Harness", smokeWindow);

    const deadline = Date.now() + 15_000;
    let pluginLoaded = false;
    while (!pluginLoaded && Date.now() < deadline) {
      pluginLoaded = await smokeWindow.webContents.executeJavaScript(
        `document.documentElement.dataset.dshDesktopUi === "jesse-composer" &&
         Boolean(document.querySelector('style[data-plugin="@jesse-lai/dsh-desktop-ui"]'))`,
        true,
      );
      if (!pluginLoaded) await delay(100);
    }
    if (!pluginLoaded) throw new Error("DSH Desktop UI 插件未在页面中加载");

    const inspectModal = (contents) => contents.executeJavaScript(
      `(() => {
        const dialogs = [...document.querySelectorAll(
          '[role="dialog"][aria-modal="true"]',
        )];
        const dialog = dialogs[0];
        const presentation = dialog?.closest('[role="presentation"]');
        return {
          count: dialogs.length,
          painted: dialog instanceof HTMLElement &&
            getComputedStyle(dialog).visibility !== 'hidden' &&
            (!(presentation instanceof HTMLElement) ||
              getComputedStyle(presentation).display !== 'none'),
          presentationDisplay: presentation instanceof HTMLElement
            ? getComputedStyle(presentation).display
            : null,
          presentationPosition: presentation instanceof HTMLElement
            ? getComputedStyle(presentation).position
            : null,
          presentationZIndex: presentation instanceof HTMLElement
            ? getComputedStyle(presentation).zIndex
            : null,
          composerForeground: document.documentElement.hasAttribute(
            'data-dsh-composer-foreground',
          ),
        };
      })()`,
      true,
    );
    const dismissModal = (contents) => contents.executeJavaScript(
      `(() => {
        const dialog = document.querySelector(
          '[role="dialog"][aria-modal="true"]',
        );
        if (!(dialog instanceof HTMLElement)) return false;
        const buttons = [...dialog.querySelectorAll('button')];
        const action = buttons.find(
          (button) => button.textContent?.trim() === 'Continue',
        ) ?? buttons[buttons.length - 1];
        if (!(action instanceof HTMLElement)) return false;
        action.click();
        return true;
      })()`,
      true,
    );
    const mainStartupModal = await inspectModal(smokeWindow.webContents);
    const foregroundStartupModal = composerForegroundWindow?.isDestroyed() === false
      ? await inspectModal(composerForegroundWindow.webContents)
      : { count: 0, painted: false };
    if (
      mainStartupModal.count > 1 ||
      foregroundStartupModal.painted ||
      (mainStartupModal.count === 1 &&
        (!mainStartupModal.painted ||
          mainStartupModal.presentationPosition !== "fixed" ||
          mainStartupModal.presentationZIndex !== "2147483000" ||
          mainStartupModal.composerForeground))
    ) {
      throw new Error(
        `启动弹窗层级回归失败：${JSON.stringify({
          mainStartupModal,
          foregroundStartupModal,
        })}`,
      );
    }
    if (mainStartupModal.count > 0 || foregroundStartupModal.count > 0) {
      await dismissModal(smokeWindow.webContents);
      if (composerForegroundWindow?.isDestroyed() === false) {
        await dismissModal(composerForegroundWindow.webContents);
      }
      const modalCloseDeadline = Date.now() + 2_000;
      let startupModalsClosed = false;
      while (!startupModalsClosed && Date.now() < modalCloseDeadline) {
        const mainState = await inspectModal(smokeWindow.webContents);
        const foregroundState = composerForegroundWindow?.isDestroyed() === false
          ? await inspectModal(composerForegroundWindow.webContents)
          : { count: 0 };
        startupModalsClosed = mainState.count === 0 && foregroundState.count === 0;
        if (!startupModalsClosed) await delay(20);
      }
      if (!startupModalsClosed) throw new Error("启动弹窗未能在测试中关闭");
      console.log("Smoke stage: startup modal layering verified");
    }
    if (modalSmokeTest) {
      console.log(`DSH Desktop modal smoke test passed: ${controller.url}`);
      return 0;
    }

    if (composerForegroundWindow?.isDestroyed() === false) {
      const sessionSyncDeadline = Date.now() + 5_000;
      let composerSessionSynced = false;
      while (!composerSessionSynced && Date.now() < sessionSyncDeadline) {
        composerSessionSynced = await composerForegroundWindow.webContents.executeJavaScript(
          `document.documentElement.dataset.dshComposerSessionPending === undefined &&
           Number(document.documentElement.dataset.dshComposerSessionRevision) >= 1`,
          true,
        );
        if (!composerSessionSynced) await delay(50);
      }
      if (!composerSessionSynced) {
        throw new Error("Composer 前景层未完成主窗口 Session 同步");
      }
    }
    const earlyComposerContents =
      composerForegroundWindow?.webContents ?? smokeWindow.webContents;
    const earlyHoverStates = await verifyComposerActionHover(earlyComposerContents);
    console.log(`Composer inactive hover verified: ${JSON.stringify(earlyHoverStates)}`);
    if (composerHoverSmokeTest) {
      console.log(`DSH Desktop Composer hover smoke test passed: ${controller.url}`);
      return 0;
    }

    const progressOrchestration = await smokeWindow.webContents.executeJavaScript(
      `(async () => {
        const row = (kind, key) => {
          const element = document.createElement('div');
          element.dataset.chatFlowKind = kind;
          element.dataset.chatAnchorKey = key;
          return element;
        };
        const fixture = document.createElement('div');
        fixture.hidden = true;

        const pendingFlow = document.createElement('div');
        pendingFlow.dataset.chatFlow = '';
        pendingFlow.append(row('user', 'smoke-user-pending'));
        const pendingStatus = document.createElement('div');
        pendingStatus.setAttribute('role', 'status');
        pendingStatus.append('Deep diving...');
        pendingFlow.append(pendingStatus);

        const activeFlow = document.createElement('div');
        activeFlow.dataset.chatFlow = '';
        activeFlow.append(row('user', 'smoke-user-active'));

        const progress = row('assistant-step', 'smoke-progress');
        const progressRoot = document.createElement('div');
        const progressBody = document.createElement('div');
        const progressCopy = document.createElement('div');
        progressCopy.textContent = 'Located the rendering entry; checking event mapping next.';
        progressBody.append(progressCopy);
        progressRoot.append(progressBody);
        progress.append(progressRoot);
        activeFlow.append(progress);

        for (const [key, name] of [['smoke-tool-1', 'read_file'], ['smoke-tool-2', 'web_search']]) {
          const toolRow = row('tool-call', key);
          const tool = document.createElement('div');
          tool.dataset.tool = name;
          tool.dataset.state = 'ok';
          toolRow.append(tool);
          activeFlow.append(toolRow);
        }

        const todo = row('tool-call', 'smoke-todo');
        const todoTool = document.createElement('div');
        todoTool.dataset.tool = 'todo_write';
        todoTool.dataset.state = 'ok';
        todo.append(todoTool);
        activeFlow.append(todo);

        const retry = row('model-retry', 'smoke-retry');
        const retryDetails = document.createElement('details');
        retryDetails.dataset.active = '';
        retry.append(retryDetails);
        activeFlow.append(retry);

        const blocker = row('turn-error', 'smoke-blocker');
        activeFlow.append(blocker);
        fixture.append(pendingFlow, activeFlow);
        document.body.append(fixture);
        await Promise.race([
          new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          new Promise((resolve) => setTimeout(resolve, 100)),
        ]);

        const toolHead = activeFlow.querySelector('[data-dsh-activity-head]');
        const activityIcon = toolHead?.querySelector('[data-dsh-activity-disclosure]');
        const result = {
          pendingThink: pendingStatus.textContent,
          progressKind: progress.dataset.dshProgressKind,
          progressLabel: progress.dataset.dshProgressLabel,
          activitySummary: toolHead?.dataset.dshActivitySummary,
          activityCollapsed: toolHead?.getAttribute('aria-expanded'),
          activityIcon: activityIcon?.dataset.lucideAnimatedIcon,
          activityIconSize: activityIcon instanceof Element
            ? [getComputedStyle(activityIcon).width, getComputedStyle(activityIcon).height]
            : null,
          todoHidden: todo.dataset.dshTodoHistory !== undefined,
          retryVisible: retry.dataset.dshRetryActive !== undefined,
          blockerVisible: blocker.dataset.dshBlocker !== undefined,
        };
        fixture.remove();
        return result;
      })()`,
      true,
    );
    if (
      !progressOrchestration.pendingThink.startsWith("Think · ") ||
      progressOrchestration.progressKind !== "progress_update" ||
      !progressOrchestration.progressLabel ||
      !progressOrchestration.activitySummary ||
      progressOrchestration.activityCollapsed !== "false" ||
      progressOrchestration.activityIcon !== "chevron-right" ||
      progressOrchestration.activityIconSize?.join("x") !== "16pxx16px" ||
      !progressOrchestration.todoHidden ||
      !progressOrchestration.retryVisible ||
      !progressOrchestration.blockerVisible
    ) {
      throw new Error(
        `生成中消息编排回归失败：${JSON.stringify(progressOrchestration)}`,
      );
    }
    const modalWasAlreadyOpen = await smokeWindow.webContents.executeJavaScript(
      `document.querySelector('[role="dialog"][aria-modal="true"]') !== null`,
      true,
    );
    const modalMaskBackdrop = await smokeWindow.webContents.executeJavaScript(
      `(async () => {
        const fixture = document.createElement('div');
        fixture.id = 'dsh-modal-smoke-fixture';
        fixture.setAttribute('role', 'presentation');
        const mask = document.createElement('div');
        mask.setAttribute('aria-hidden', 'true');
        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        fixture.append(mask, dialog);
        document.body.append(fixture);
        await Promise.race([
          new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          new Promise((resolve) => setTimeout(resolve, 100)),
        ]);
        return getComputedStyle(mask).backdropFilter;
      })()`,
      true,
    );
    const modalOpenDeadline = Date.now() + 2_000;
    let modalForegroundSuppressed = false;
    while (!modalForegroundSuppressed && Date.now() < modalOpenDeadline) {
      modalForegroundSuppressed = await smokeWindow.webContents.executeJavaScript(
        `document.documentElement.hasAttribute('data-dsh-modal-overlay') &&
         !document.documentElement.hasAttribute('data-dsh-composer-foreground')`,
        true,
      );
      if (!modalForegroundSuppressed) await delay(20);
    }
    if (modalMaskBackdrop !== "none" || !modalForegroundSuppressed) {
      throw new Error(
        `Modal 前景层或去模糊回归失败：${JSON.stringify({ modalMaskBackdrop, modalForegroundSuppressed })}`,
      );
    }
    await smokeWindow.webContents.executeJavaScript(
      `document.querySelector('#dsh-modal-smoke-fixture')?.remove()`,
      true,
    );
    const modalCloseDeadline = Date.now() + 2_000;
    let modalCloseState = false;
    while (!modalCloseState && Date.now() < modalCloseDeadline) {
      modalCloseState = await smokeWindow.webContents.executeJavaScript(
        modalWasAlreadyOpen
          ? `document.documentElement.hasAttribute('data-dsh-modal-overlay') &&
             !document.documentElement.hasAttribute('data-dsh-composer-foreground')`
          : `!document.documentElement.hasAttribute('data-dsh-modal-overlay') &&
             document.documentElement.hasAttribute('data-dsh-composer-foreground')`,
        true,
      );
      if (!modalCloseState) await delay(20);
    }
    if (!modalCloseState) {
      const rendererState = await smokeWindow.webContents.executeJavaScript(
        `({
          modal: document.documentElement.hasAttribute('data-dsh-modal-overlay'),
          foreground: document.documentElement.hasAttribute('data-dsh-composer-foreground'),
          card: document.querySelector('[data-composer-card]')?.getBoundingClientRect().toJSON(),
        })`,
        true,
      );
      throw new Error(
        `Modal 移除后的前景层状态错误：${JSON.stringify({
          rendererState,
          modalWasAlreadyOpen,
          modalOverlayVisible,
          composerForegroundReady,
          composerFrame,
          composerOverlayInteraction,
          composerForegroundAlive: composerForegroundWindow?.isDestroyed() === false,
        })}`,
      );
    }
    const composerContents = composerForegroundWindow?.webContents ?? smokeWindow.webContents;
    const webComposerMenus = await composerContents.executeJavaScript(
      `({
        kinds: [...document.querySelectorAll('[data-dsh-composer-menu-trigger]')]
          .map((element) => element.dataset.dshComposerMenuTrigger)
          .sort(),
      })`,
      true,
    );
    const webComposerMenuKinds = [...new Set(webComposerMenus.kinds)];
    if (
      !["preset", "workspace"].every(
        (kind) => webComposerMenuKinds.includes(kind),
      )
    ) {
      throw new Error(
        `空白会话的 Composer 网页菜单入口缺失：${JSON.stringify(webComposerMenus)}`,
      );
    }

    const foregroundBoundsBeforeMenu = composerForegroundWindow?.getBounds();
    const foregroundVisibleBeforeMenu = composerForegroundWindow?.isVisible();
    const mainForegroundBeforeMenu = await smokeWindow.webContents.executeJavaScript(
      `document.documentElement.hasAttribute('data-dsh-composer-foreground')`,
      true,
    );
    const presetMenuBefore = await composerContents.executeJavaScript(
      `(() => {
        const trigger = document.querySelector(
          '[data-dsh-hero-workspace-row] button[data-dsh-composer-menu-trigger="preset"]',
        );
        const card = document.querySelector('[data-composer-card]');
        if (!(trigger instanceof HTMLButtonElement) || !(card instanceof HTMLElement)) {
          return { opened: false, reason: 'missing trigger or card' };
        }
        const before = getComputedStyle(card);
        const beforePaint = {
          background: before.backgroundColor,
          shadow: before.boxShadow,
        };
        trigger.click();
        return { clicked: true, beforePaint };
      })()`,
      true,
    );
    await delay(50);
    const presetMenuOpen = await composerContents.executeJavaScript(
      `(() => {
        const trigger = document.querySelector(
          '[data-dsh-hero-workspace-row] button[data-dsh-composer-menu-trigger="preset"]',
        );
        const card = document.querySelector('[data-composer-card]');
        if (!(trigger instanceof HTMLButtonElement) || !(card instanceof HTMLElement)) {
          return { opened: false, reason: 'missing trigger or card after click' };
        }
        const menu = [...document.querySelectorAll('[role="menu"]')].find((element) => {
          if (!(element instanceof HTMLElement)) return false;
          const style = getComputedStyle(element);
          return style.display !== 'none' && style.visibility !== 'hidden' &&
            element.getClientRects().length > 0;
        });
        const after = getComputedStyle(card);
        return {
          opened: menu instanceof HTMLElement,
          expanded: trigger.getAttribute('aria-expanded'),
          itemCount: menu?.querySelectorAll('[role="menuitem"]').length ?? 0,
          afterPaint: {
            background: after.backgroundColor,
            shadow: after.boxShadow,
          },
        };
      })()`,
      true,
    );
    const presetMenuDeadline = Date.now() + 2_000;
    while (!composerOverlayInteraction.captureAll && Date.now() < presetMenuDeadline) {
      await delay(20);
    }
    const mainForegroundWhileMenuOpen = await smokeWindow.webContents.executeJavaScript(
      `document.documentElement.hasAttribute('data-dsh-composer-foreground')`,
      true,
    );
    const foregroundBoundsWithMenu = composerForegroundWindow?.getBounds();
    if (
      presetMenuOpen.opened !== true ||
      presetMenuBefore.clicked !== true ||
      presetMenuOpen.expanded !== "true" ||
      presetMenuOpen.itemCount < 1 ||
      JSON.stringify(presetMenuBefore.beforePaint) !== JSON.stringify(presetMenuOpen.afterPaint) ||
      composerOverlayInteraction.captureAll !== true ||
      composerForegroundWindow?.isVisible() !== foregroundVisibleBeforeMenu ||
      mainForegroundWhileMenuOpen !== mainForegroundBeforeMenu ||
      JSON.stringify(foregroundBoundsBeforeMenu) !== JSON.stringify(foregroundBoundsWithMenu)
    ) {
      throw new Error(
        `Composer 菜单未在稳定前景层中打开：${JSON.stringify({
          presetMenuOpen,
          presetMenuBefore,
          captureAll: composerOverlayInteraction.captureAll,
          foregroundVisible: composerForegroundWindow?.isVisible(),
          foregroundVisibleBeforeMenu,
          mainForegroundBeforeMenu,
          mainForegroundWhileMenuOpen,
          foregroundBoundsBeforeMenu,
          foregroundBoundsWithMenu,
        })}`,
      );
    }
    composerContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    composerContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
    console.log("Smoke stage: foreground Composer menu stability verified");

    const composerSendIcon = await composerContents.executeJavaScript(
      `document.querySelector(
        '[data-dsh-composer-primary] svg[data-lucide-animated-icon]',
      )?.dataset.lucideAnimatedIcon ?? null`,
      true,
    );
    if (composerSendIcon !== "arrow-up") {
      throw new Error(`Composer 发送按钮未使用 arrow-up 图标：${composerSendIcon}`);
    }

    const composerCommandAlignment = await composerContents.executeJavaScript(
      `(() => {
        const input = document.querySelector('[data-dsh-composer-input] textarea');
        const icon = document.querySelector(
          '[data-dsh-composer-command] svg[data-lucide-animated-icon]',
        );
        const artwork = icon?.querySelector('[data-lucide-library-paint] path');
        const command = icon?.closest('button');
        if (!(input instanceof HTMLElement) || !(icon instanceof SVGElement) ||
            !(artwork instanceof SVGGraphicsElement)) return null;
        const matrix = artwork.getScreenCTM();
        if (matrix === null) return null;
        const artworkBox = artwork.getBBox();
        return {
          icon: icon.dataset.lucideAnimatedIcon ?? null,
          disabled: command instanceof HTMLButtonElement && command.disabled,
          artworkLeft: new DOMPoint(artworkBox.x, artworkBox.y)
            .matrixTransform(matrix).x,
          inputLeft: input.getBoundingClientRect().left,
        };
      })()`,
      true,
    );
    if (
      composerCommandAlignment === null ||
      composerCommandAlignment.icon !== "plus" ||
      (composerCommandAlignment.disabled !== true &&
        Math.abs(
          composerCommandAlignment.artworkLeft - composerCommandAlignment.inputLeft,
        ) > 1.25)
    ) {
      throw new Error(
        `Composer 加号未使用 plus 或未与输入文案左对齐：${JSON.stringify(composerCommandAlignment)}`,
      );
    }

    const composerDropdownState = await smokeWindow.webContents.executeJavaScript(
      `(async () => {
        const displayOf = (element) => getComputedStyle(element).display;
        const actual = [...document.querySelectorAll(
          '[data-composer-card] [class*="_chevron"]',
        )].map(displayOf);

        const fixture = document.createElement('div');
        fixture.dataset.composerCard = '';
        fixture.style.cssText = 'position:fixed;left:-10000px;top:0';
        const permissionChevron = document.createElement('span');
        permissionChevron.className = 'smoke_chevron';
        const modelChevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        modelChevron.setAttribute('class', 'smoke_chevron');
        fixture.append(permissionChevron, modelChevron);
        document.body.append(fixture);
        await Promise.race([
          new Promise((resolve) => requestAnimationFrame(resolve)),
          new Promise((resolve) => setTimeout(resolve, 100)),
        ]);
        const probe = [permissionChevron, modelChevron].map(displayOf);
        fixture.remove();
        return { actual, probe };
      })()`,
      true,
    );
    if (
      composerDropdownState.probe.length !== 2 ||
      composerDropdownState.probe.some((display) => display !== "none") ||
      composerDropdownState.actual.some((display) => display !== "none")
    ) {
      throw new Error(
        `Composer 下拉箭头仍然可见：${JSON.stringify(composerDropdownState)}`,
      );
    }

    assertMacOSTrafficLightPosition("Composer", smokeWindow);

    const heroComposerAlignment = await smokeWindow.webContents.executeJavaScript(
      `(() => {
        const row = document.querySelector("[data-dsh-hero-workspace-row]");
        const card = document.querySelector("[data-composer-card]");
        if (!(row instanceof HTMLElement) || !(card instanceof HTMLElement)) return null;
        return {
          rowLeft: row.getBoundingClientRect().left,
          cardLeft: card.getBoundingClientRect().left,
        };
      })()`,
      true,
    );
    if (heroComposerAlignment === null) {
      throw new Error("Hero workspace 行或 Composer 未渲染");
    }
    if (Math.abs(heroComposerAlignment.rowLeft - heroComposerAlignment.cardLeft) > 1) {
      throw new Error(
        `Hero workspace 行未与 Composer 左对齐：${heroComposerAlignment.rowLeft} / ${heroComposerAlignment.cardLeft}`,
      );
    }

    const fixedComposerGeometry = await smokeWindow.webContents.executeJavaScript(
      `(async () => {
        const nextFrame = () => Promise.race([
          new Promise(
            (resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
          new Promise((resolve) => setTimeout(resolve, 100)),
        ]);
        const scrollport = document.querySelector('[data-conversation-scroll]');
        const seat = scrollport?.querySelector(':scope > [data-composer-seat]');
        const root = scrollport?.parentElement;
        if (
          !(scrollport instanceof HTMLElement) ||
          !(seat instanceof HTMLElement) ||
          !(root instanceof HTMLElement)
        ) {
          return null;
        }
        const originalPhase = root.dataset.phase;
        const growth = document.createElement('div');
        growth.style.cssText = 'flex: 0 0 640px; height: 640px; pointer-events: none';
        let result;
        try {
          root.dataset.phase = 'active';
          await nextFrame();
          const scrollRect = scrollport.getBoundingClientRect();
          const seatRect = seat.getBoundingClientRect();
          scrollport.insertBefore(growth, seat);
          await nextFrame();
          const growingScrollRect = scrollport.getBoundingClientRect();
          const growingSeatRect = seat.getBoundingClientRect();
          result = {
            position: getComputedStyle(seat).position,
            fixed: seat.hasAttribute('data-dsh-composer-fixed'),
            fixedHost: scrollport.hasAttribute('data-dsh-composer-fixed-host'),
            bottomDelta: Math.abs(scrollRect.bottom - seatRect.bottom),
            growingBottomDelta: Math.abs(
              growingScrollRect.bottom - growingSeatRect.bottom,
            ),
            widthDelta: Math.abs(scrollport.clientWidth - seatRect.width),
            reserveDelta: Math.abs(
              Number.parseFloat(
                scrollport.style.getPropertyValue('--dsh-desktop-composer-reserve'),
              ) - seatRect.height,
            ),
          };
        } finally {
          growth.remove();
          if (originalPhase === undefined) delete root.dataset.phase;
          else root.dataset.phase = originalPhase;
          await nextFrame();
        }
        return result;
      })()`,
      true,
    );
    if (
      fixedComposerGeometry === null ||
      fixedComposerGeometry.position !== "fixed" ||
      !fixedComposerGeometry.fixed ||
      !fixedComposerGeometry.fixedHost ||
      fixedComposerGeometry.bottomDelta > 1 ||
      fixedComposerGeometry.growingBottomDelta > 1 ||
      fixedComposerGeometry.widthDelta > 1 ||
      fixedComposerGeometry.reserveDelta > 1
    ) {
      throw new Error(
        `Composer 底部固定回归失败：${JSON.stringify(fixedComposerGeometry)}`,
      );
    }

    const scrollButtonBinding = await smokeWindow.webContents.executeJavaScript(
      `(async () => {
        const nextFrame = () => Promise.race([
          new Promise(
            (resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
          new Promise((resolve) => setTimeout(resolve, 100)),
        ]);
        const scrollport = document.querySelector('[data-conversation-scroll]');
        const card = document.querySelector('[data-composer-card]');
        if (!(scrollport instanceof HTMLElement) || !(card instanceof HTMLElement)) return null;

        const downIcon = () => {
          const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          icon.dataset.lucideAnimatedIcon = 'chevron-down';
          return icon;
        };
        const distractor = document.createElement('button');
        distractor.type = 'button';
        distractor.append(downIcon());
        const distractorSlot = document.createElement('div');
        distractorSlot.append(distractor);

        const list = document.createElement('div');
        const flow = document.createElement('div');
        flow.dataset.chatFlow = '';
        const semanticSlot = document.createElement('div');
        const semanticButton = document.createElement('button');
        semanticButton.type = 'button';
        semanticButton.setAttribute('aria-label', 'Back to bottom');
        semanticButton.append(downIcon());
        semanticSlot.append(semanticButton);
        list.append(flow, semanticSlot);
        scrollport.append(distractorSlot, list);

        let result;
        try {
          await nextFrame();
          const cardRect = card.getBoundingClientRect();
          const buttonRect = semanticButton.getBoundingClientRect();
          const style = getComputedStyle(semanticButton);
          result = {
            markedCount: document.querySelectorAll('[data-dsh-scroll-button]').length,
            semanticMarked: semanticButton.hasAttribute('data-dsh-scroll-button'),
            distractorMarked: distractor.hasAttribute('data-dsh-scroll-button'),
            position: style.position,
            boxShadow: style.boxShadow,
            leftDelta: Math.abs(
              buttonRect.left - (cardRect.left + cardRect.width / 2 - 18),
            ),
            topDelta: Math.abs(buttonRect.top - (cardRect.top - 48)),
            width: buttonRect.width,
            height: buttonRect.height,
          };
        } finally {
          distractorSlot.remove();
          list.remove();
          await nextFrame();
        }
        return result;
      })()`,
      true,
    );
    if (
      scrollButtonBinding === null ||
      scrollButtonBinding.markedCount !== 1 ||
      !scrollButtonBinding.semanticMarked ||
      scrollButtonBinding.distractorMarked ||
      scrollButtonBinding.position !== "fixed" ||
      scrollButtonBinding.boxShadow !== "none" ||
      scrollButtonBinding.leftDelta > 1 ||
      scrollButtonBinding.topDelta > 1 ||
      Math.abs(scrollButtonBinding.width - 36) > 1 ||
      Math.abs(scrollButtonBinding.height - 36) > 1
    ) {
      throw new Error(
        `回到底部按钮绑定回归失败：${JSON.stringify(scrollButtonBinding)}`,
      );
    }

    const animatedIconCount = await smokeWindow.webContents.executeJavaScript(
      `document.querySelectorAll("svg[data-lucide-animated-icon]").length`,
      true,
    );
    if (animatedIconCount === 0) {
      throw new Error("lucide-animated 图标渲染未生效");
    }
    const paintedAnimatedIconCount = await smokeWindow.webContents.executeJavaScript(
      `[...document.querySelectorAll("svg[data-lucide-animated-icon]")].filter((icon) => {
        const paint = icon.querySelector(":scope > svg[data-lucide-library-paint]");
        return paint instanceof SVGElement && getComputedStyle(paint).opacity !== "0";
      }).length`,
      true,
    );
    if (paintedAnimatedIconCount !== animatedIconCount) {
      throw new Error(
        `lucide-animated 图标绘制不完整：${paintedAnimatedIconCount}/${animatedIconCount}`,
      );
    }

    const sidebarCycle = await smokeWindow.webContents.executeJavaScript(
      `(async () => {
        const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
        const waitFor = async (predicate, timeout = 2_000) => {
          const deadline = Date.now() + timeout;
          while (!predicate() && Date.now() < deadline) await wait(20);
          return predicate();
        };
        const shell = document.querySelector("[data-dsh-desktop-shell]");
        const toggle = () => {
          const buttons = document.querySelectorAll(
            "[data-dsh-desktop-sidebar-logo] button",
          );
          return buttons[buttons.length - 1];
        };
        const firstToggle = toggle();
        if (!(shell instanceof HTMLElement) || !(firstToggle instanceof HTMLElement)) {
          return { collapsed: false, expanded: false, intact: false };
        }
        firstToggle.click();
        const collapsed = await waitFor(() => shell.hasAttribute("data-sidebar-collapsed"));
        await wait(220);
        const secondToggle = toggle();
        const collapsedIntact =
          document.querySelector("[data-dsh-desktop-sidebar]") instanceof HTMLElement &&
          secondToggle instanceof HTMLElement;
        secondToggle?.click();
        const expanded = await waitFor(() => !shell.hasAttribute("data-sidebar-collapsed"));
        await wait(220);
        const restoredSidebar = document.querySelector("[data-dsh-desktop-sidebar]");
        const intact =
          collapsedIntact &&
          restoredSidebar instanceof HTMLElement &&
          restoredSidebar.children.length === 4 &&
          toggle() instanceof HTMLElement;
        return { collapsed, expanded, intact };
      })()`,
      true,
    );
    if (!sidebarCycle.collapsed || !sidebarCycle.expanded || !sidebarCycle.intact) {
      throw new Error(
        `侧边栏折叠/展开回归失败：${JSON.stringify(sidebarCycle)}`,
      );
    }
    await delay(500);
    assertMacOSTrafficLightPosition("Settled", smokeWindow);

    const supportsContinuousCorners = await smokeWindow.webContents.executeJavaScript(
      `CSS.supports("corner-shape", "squircle")`,
      true,
    );
    if (!supportsContinuousCorners) {
      throw new Error("当前 Electron 运行时不支持原生平滑圆角");
    }

    console.log(`DSH Desktop smoke test passed: ${controller.url}`);
    return 0;
  } catch (error) {
    console.error(`DSH Desktop smoke test failed: ${conciseError(error)}`);
    return 1;
  } finally {
    destroyComposerForeground();
    smokeWindow?.destroy();
    if (mainWindow === smokeWindow) mainWindow = undefined;
    await controller?.stop();
    await rm(smokeDirectory, { recursive: true, force: true });
  }
}

async function shutdown() {
  if (shutdownPromise !== undefined) return shutdownPromise;
  quitting = true;
  shutdownPromise = (async () => {
    startupAbortController?.abort();
    await harnessStartup?.catch(() => undefined);
    await harness?.stop();
    harness = undefined;
  })();
  return shutdownPromise;
}

app.on("before-quit", (event) => {
  if ((harness === undefined && harnessStartup === undefined) || quitting) return;
  event.preventDefault();
  void shutdown().finally(() => app.quit());
});

app.on("window-all-closed", () => app.quit());

if (hasSingleInstanceLock) {
  app.on("second-instance", focusMainWindow);
  ipcMain.on("desktop:restart", (event) => {
    if (!event.senderFrame.url.startsWith("file://")) return;
    restartApplication();
  });
  ipcMain.on("desktop:sync-traffic-lights", (event) => {
    if (
      mainWindow?.isDestroyed() !== false ||
      event.sender !== mainWindow.webContents
    ) {
      return;
    }
    syncMacOSTrafficLightPosition();
  });
  ipcMain.on("desktop:modal-overlay-visible", (event, visible, maskAlpha) => {
    if (
      mainWindow?.isDestroyed() !== false ||
      event.sender !== mainWindow.webContents ||
      typeof visible !== "boolean" ||
      typeof maskAlpha !== "number" ||
      !Number.isFinite(maskAlpha)
    ) {
      return;
    }
    setModalOverlayVisible(visible, maskAlpha);
  });
  ipcMain.on("desktop:composer-overlay-interaction", (event, value) => {
    if (
      composerForegroundWindow?.isDestroyed() !== false ||
      event.sender !== composerForegroundWindow.webContents
    ) {
      return;
    }
    const normalized = normalizeComposerOverlayInteraction(value);
    if (normalized === undefined) return;
    const cardChanged = !composerFramesEqual(
      composerOverlayInteraction.card,
      normalized.card,
    );
    composerOverlayInteraction = normalized;
    if (cardChanged) updateComposerLayers();
    forwardInactiveComposerMouseMove();
  });
  ipcMain.on("desktop:composer-session-publish", (event, value) => {
    if (
      mainWindow?.isDestroyed() !== false ||
      event.sender !== mainWindow.webContents
    ) {
      return;
    }
    const normalized = normalizeComposerSessionContext(value);
    if (normalized === undefined) return;
    composerSessionRevision += 1;
    composerSessionContext = {
      ...normalized,
      revision: composerSessionRevision,
    };
    sendComposerSessionContext();
  });
  ipcMain.on("desktop:composer-session-request", (event) => {
    if (
      composerForegroundWindow?.isDestroyed() !== false ||
      event.sender !== composerForegroundWindow.webContents
    ) {
      return;
    }
    sendComposerSessionContext();
  });
  ipcMain.on("desktop:composer-glass-frame", (event, frame) => {
    if (
      composerGlass === undefined ||
      mainWindow?.isDestroyed() !== false ||
      event.sender !== mainWindow.webContents ||
      frame === null ||
      typeof frame !== "object"
    ) {
      return;
    }
    const normalized = normalizeComposerFrame(frame);
    if (normalized === undefined) return;
    const hero = frame.hero === null || frame.hero === undefined
      ? undefined
      : normalizeComposerFrame(frame.hero);
    if (frame.hero !== null && frame.hero !== undefined && hero === undefined) return;
    composerFrame = normalized;
    composerHeroFrame = hero;
    updateComposerLayers();
  });
  ipcMain.on("desktop:sidebar-button-glass-frame", (event, frame) => {
    if (
      composerGlass === undefined ||
      mainWindow?.isDestroyed() !== false ||
      event.sender !== mainWindow.webContents ||
      frame === null ||
      typeof frame !== "object"
    ) {
      return;
    }
    const values = [frame.x, frame.y, frame.width, frame.height];
    if (!values.every((value) => typeof value === "number" && Number.isFinite(value))) {
      return;
    }
    composerGlass.setSidebarButtonGlassFrame(
      mainWindow.getNativeWindowHandle(),
      {
        ...frame,
        title: typeof frame.title === "string" ? frame.title.slice(0, 80) : "New Session",
        hovered: frame.hovered === true,
        pressed: frame.pressed === true,
      },
    );
  });
  ipcMain.on("desktop:scroll-button-glass-frame", (event, frame) => {
    if (
      composerGlass === undefined ||
      mainWindow?.isDestroyed() !== false ||
      event.sender !== mainWindow.webContents ||
      frame === null ||
      typeof frame !== "object"
    ) {
      return;
    }
    const values = [frame.x, frame.y, frame.width, frame.height];
    if (!values.every((value) => typeof value === "number" && Number.isFinite(value))) {
      return;
    }
    composerGlass.setScrollButtonGlassFrame(
      mainWindow.getNativeWindowHandle(),
      {
        ...frame,
        hovered: frame.hovered === true,
        pressed: frame.pressed === true,
      },
    );
  });
}

async function main() {
  if (!hasSingleInstanceLock) {
    app.quit();
    return;
  }

  await app.whenReady();

  if (smokeTest) {
    app.dock?.hide();
    const exitCode = await runSmokeTest();
    app.exit(exitCode);
    return;
  }

  installApplicationMenu();
  await launchDesktop();
}

void main().catch((error) => {
  console.error(`DSH Desktop failed to start: ${conciseError(error)}`);
  app.exit(1);
});
