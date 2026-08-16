import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain, Menu, shell } from "electron";
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

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    title: "DSH Desktop",
    show: false,
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: join(sourceDirectory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.once("ready-to-show", () => window.show());
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
  } catch (error) {
    if (!quitting) {
      await loadStatus("error", `${conciseError(error)}\n请退出应用后重试。`);
    }
  } finally {
    harnessStartup = undefined;
    startupAbortController = undefined;
  }
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

    smokeWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    await smokeWindow.loadURL(controller.url);

    const deadline = Date.now() + 15_000;
    let pluginLoaded = false;
    while (!pluginLoaded && Date.now() < deadline) {
      pluginLoaded = await smokeWindow.webContents.executeJavaScript(
        `document.documentElement.dataset.dshDesktopUi === "prompt-kit" &&
         Boolean(document.querySelector('style[data-plugin="@jesse-lai/dsh-desktop-ui"]'))`,
        true,
      );
      if (!pluginLoaded) await delay(100);
    }
    if (!pluginLoaded) throw new Error("DSH Desktop UI 插件未在页面中加载");

    console.log(`DSH Desktop smoke test passed: ${controller.url}`);
    return 0;
  } catch (error) {
    console.error(`DSH Desktop smoke test failed: ${conciseError(error)}`);
    return 1;
  } finally {
    smokeWindow?.destroy();
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
