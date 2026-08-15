import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, shell } from "electron";
import { startHarness } from "./harness.js";

const require = createRequire(import.meta.url);
const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const harnessPackagePath = require.resolve("@deepseek-ai/dsh/package.json");
const harnessCliPath = join(dirname(harnessPackagePath), "lib", "bin.js");
const smokeTest = process.argv.includes("--smoke-test");

let mainWindow;
let harness;
let harnessStartup;
let startupAbortController;
let quitting = false;
let shutdownPromise;

app.setName("DSH Desktop");

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
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = undefined;
  });
  return window;
}

async function launchDesktop() {
  mainWindow = createWindow();
  await loadStatus();

  try {
    startupAbortController = new AbortController();
    harnessStartup = startHarness({
      executablePath: process.execPath,
      cliPath: harnessCliPath,
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

  try {
    console.log("Starting DeepSeek Harness smoke test...");
    controller = await startHarness({
      executablePath: process.execPath,
      cliPath: harnessCliPath,
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
    console.log(`DSH Desktop smoke test passed: ${controller.url}`);
    return 0;
  } catch (error) {
    console.error(`DSH Desktop smoke test failed: ${conciseError(error)}`);
    return 1;
  } finally {
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

async function main() {
  await app.whenReady();

  if (smokeTest) {
    app.dock?.hide();
    const exitCode = await runSmokeTest();
    app.exit(exitCode);
    return;
  }

  await launchDesktop();
}

void main().catch((error) => {
  console.error(`DSH Desktop failed to start: ${conciseError(error)}`);
  app.exit(1);
});
