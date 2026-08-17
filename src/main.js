import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain, Menu, nativeTheme, shell } from "electron";
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
const smokeTest = process.argv.includes("--smoke-test");
const hasSingleInstanceLock = smokeTest || app.requestSingleInstanceLock();
const macOSTrafficLightPosition = { x: 14, y: 14 };

let mainWindow;
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

function assertSingleBrowserWindow(label) {
  const windows = BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed());
  if (windows.length !== 1 || windows[0] !== mainWindow) {
    throw new Error(`${label} 必须只有一个主 BrowserWindow，实际为 ${windows.length}`);
  }
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

  const syncTrafficLights = () => syncMacOSTrafficLightPosition(window);
  window.webContents.on("did-finish-load", syncTrafficLights);
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
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = undefined;
  });
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
  assertSingleBrowserWindow("Loading");
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

    keepNavigationLocal(mainWindow, new URL(harness.url).origin);
    await mainWindow.loadURL(harness.url);
    assertSingleBrowserWindow("Harness");
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

    mainWindow = createWindow({ showOnReady: false });
    keepNavigationLocal(mainWindow, new URL(controller.url).origin);
    await mainWindow.loadURL(controller.url);
    assertSingleBrowserWindow("Smoke");
    assertMacOSTrafficLightPosition("Smoke", mainWindow);

    const deadline = Date.now() + 15_000;
    let state;
    while (Date.now() < deadline) {
      state = await inspectSingleRenderer(mainWindow.webContents);
      if (state.plugin === "jesse-composer" && state.composer && state.shell) break;
      await delay(100);
    }
    if (state?.plugin !== "jesse-composer" || !state.composer || !state.shell) {
      throw new Error(`DSH Desktop UI 插件未完整加载：${JSON.stringify(state)}`);
    }
    if (
      state.windowRole !== "main" ||
      state.overlayAttribute ||
      state.foregroundAttribute ||
      state.nativeGlassAttribute ||
      JSON.stringify(state.desktopBridge) !== JSON.stringify(["restart", "setThemeSource"])
    ) {
      throw new Error(`检测到多层渲染残留：${JSON.stringify(state)}`);
    }
    if (state.centerBackground === "rgba(0, 0, 0, 0)") {
      throw new Error(`主对话区必须保持不透明：${JSON.stringify(state)}`);
    }

    const composerBeforeMenu = await mainWindow.webContents.executeJavaScript(
      `(() => {
        const kinds = [...document.querySelectorAll('[data-dsh-composer-menu-trigger]')]
          .map((element) => element.dataset.dshComposerMenuTrigger);
        const trigger = document.querySelector(
          '[data-dsh-hero-workspace-row] button[data-dsh-composer-menu-trigger="preset"]',
        ) ?? document.querySelector(
          '[data-dsh-hero-workspace-row] button[data-dsh-composer-menu-trigger]',
        );
        const input = document.querySelector('[data-dsh-composer-input] textarea');
        if (!(trigger instanceof HTMLButtonElement) || !(input instanceof HTMLTextAreaElement)) {
          return { clicked: false, kinds };
        }
        trigger.focus();
        const triggerFocused = document.activeElement === trigger;
        trigger.click();
        return {
          clicked: true,
          triggerFocused,
          kind: trigger.dataset.dshComposerMenuTrigger,
          kinds,
        };
      })()`,
      true,
    );
    await delay(50);
    const composerMenu = await mainWindow.webContents.executeJavaScript(
      `(() => {
        const trigger = document.querySelector(
          '[data-dsh-hero-workspace-row] button[data-dsh-composer-menu-trigger="preset"]',
        ) ?? document.querySelector(
          '[data-dsh-hero-workspace-row] button[data-dsh-composer-menu-trigger]',
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
    const menuKinds = [...new Set(composerBeforeMenu.kinds)].sort();
    if (
      !composerBeforeMenu.clicked ||
      !composerBeforeMenu.triggerFocused ||
      !menuKinds.includes("workspace") ||
      !composerMenu.opened ||
      composerMenu.expanded !== "true" ||
      composerMenu.itemCount < 1
    ) {
      throw new Error(
        `Composer 焦点或菜单未留在主 Renderer：${JSON.stringify({
          composerBeforeMenu,
          composerMenu,
        })}`,
      );
    }
    assertSingleBrowserWindow("Composer menu");
    mainWindow.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    mainWindow.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });

    console.log(`DSH Desktop single-Renderer smoke test passed: ${controller.url}`);
    return 0;
  } catch (error) {
    console.error(`DSH Desktop smoke test failed: ${conciseError(error)}`);
    return 1;
  } finally {
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
  ipcMain.on("desktop:set-theme-source", (event, themeSource) => {
    if (event.sender !== mainWindow?.webContents) return;
    if (themeSource !== "light" && themeSource !== "dark" && themeSource !== "system") return;
    if (nativeTheme.themeSource === themeSource) return;
    nativeTheme.themeSource = themeSource;
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
