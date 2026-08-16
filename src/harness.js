import { spawn as spawnProcess } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const READY_PATTERN = /dsh web:\s+(http:\/\/127\.0\.0\.1:\d+)(?=\s|$)/;
const MAX_DIAGNOSTIC_LENGTH = 32_000;
const HTTP_PROBE_TIMEOUT_MS = 1_000;

export class HarnessStartError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "HarnessStartError";
  }
}

export function parseHarnessUrl(output) {
  const match = READY_PATTERN.exec(output);
  if (match === null) return undefined;

  try {
    const url = new URL(match[1]);
    const port = Number(url.port);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) return undefined;
    return url.href.replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

function appendDiagnostic(current, chunk) {
  const next = `${current}${chunk}`;
  return next.length <= MAX_DIAGNOSTIC_LENGTH
    ? next
    : next.slice(next.length - MAX_DIAGNOSTIC_LENGTH);
}

async function checkHarnessHttp(url) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(HTTP_PROBE_TIMEOUT_MS),
    });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    child.once("exit", onExit);
  });
}

export async function stopHarnessProcess(child, timeoutMs = 5_000) {
  if (child.exitCode !== null || child.signalCode !== null) return;

  child.kill("SIGTERM");
  const exited = await waitForExit(child, timeoutMs);

  if (!exited && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await waitForExit(child, 1_000);
  }
}

export async function startHarness({
  executablePath,
  cliPath,
  patchPath,
  pluginSourcePath,
  userDataPath,
  workspacePath = join(userDataPath, "workspace"),
  startupTimeoutMs = 30_000,
  stopTimeoutMs = 5_000,
  readinessRetryMs = 100,
  checkHttpReady = checkHarnessHttp,
  spawn = spawnProcess,
  signal,
  onOutput,
  onUnexpectedExit,
}) {
  if (!executablePath || !cliPath || !userDataPath) {
    throw new TypeError("executablePath, cliPath and userDataPath are required");
  }

  const harnessHome = join(userDataPath, "harness");
  await Promise.all([
    mkdir(harnessHome, { recursive: true }),
    mkdir(workspacePath, { recursive: true }),
  ]);

  if (pluginSourcePath !== undefined) {
    const pluginInstallPath = join(
      harnessHome,
      "node_modules",
      "@jesse-lai",
      "dsh-desktop-ui",
    );
    await rm(pluginInstallPath, { recursive: true, force: true });
    await mkdir(join(pluginInstallPath, ".."), { recursive: true });
    await cp(pluginSourcePath, pluginInstallPath, { recursive: true });
  }
  if (signal?.aborted) throw new HarnessStartError("Harness 启动已取消");

  const args = ["--expose-internals", cliPath, "web"];
  if (patchPath !== undefined) args.push("--patch", patchPath);
  args.push("--host", "127.0.0.1", "--port", "0");

  let child;
  try {
    child = spawn(
      executablePath,
      args,
      {
        cwd: workspacePath,
        env: {
          ...process.env,
          DSH_HOME: harnessHome,
          ELECTRON_RUN_AS_NODE: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
  } catch (cause) {
    throw new HarnessStartError(`无法启动 Harness：${cause.message}`, { cause });
  }

  let diagnostic = "";
  let stdout = "";
  let ready = false;
  let stopping = false;
  let unexpectedExitReported = false;
  let stopPromise;

  const stop = () => {
    stopping = true;
    stopPromise ??= stopHarnessProcess(child, stopTimeoutMs);
    return stopPromise;
  };

  const url = await new Promise((resolve, reject) => {
    let settled = false;
    let startupTimer;
    let readinessTimer;
    let candidateUrl;
    let checkingReadiness = false;

    const finish = () => {
      clearTimeout(startupTimer);
      clearTimeout(readinessTimer);
      signal?.removeEventListener("abort", abortStartup);
    };

    const fail = (error) => {
      if (settled) return;
      settled = true;
      finish();
      reject(error);
    };

    const abortStartup = () => {
      if (settled) return;
      stopping = true;
      void stop().finally(() => fail(new HarnessStartError("Harness 启动已取消")));
    };

    const checkReadiness = async () => {
      if (settled || stopping || checkingReadiness || candidateUrl === undefined) return;
      checkingReadiness = true;

      let reachable = false;
      try {
        reachable = await checkHttpReady(candidateUrl);
      } catch {
        reachable = false;
      } finally {
        checkingReadiness = false;
      }

      if (settled || stopping) return;
      if (reachable) {
        settled = true;
        ready = true;
        finish();
        resolve(candidateUrl);
        return;
      }

      readinessTimer = setTimeout(checkReadiness, readinessRetryMs);
    };

    const handleOutput = (stream) => (chunk) => {
      const text = chunk.toString();
      diagnostic = appendDiagnostic(diagnostic, text);
      if (stream === "stdout") stdout = appendDiagnostic(stdout, text);
      onOutput?.({ stream, text });

      const parsedUrl = parseHarnessUrl(stdout);
      if (settled || stopping || parsedUrl === undefined || candidateUrl !== undefined) return;
      candidateUrl = parsedUrl;
      void checkReadiness();
    };

    child.stdout.on("data", handleOutput("stdout"));
    child.stderr.on("data", handleOutput("stderr"));

    child.once("error", (cause) => {
      if (!ready) {
        if (stopping) return;
        fail(new HarnessStartError(`无法启动 Harness：${cause.message}`, { cause }));
        return;
      }
      if (!stopping && !unexpectedExitReported) {
        unexpectedExitReported = true;
        onUnexpectedExit?.({ cause, diagnostic });
      }
    });

    child.once("exit", (code, signal) => {
      if (!ready) {
        if (stopping) return;
        const detail = diagnostic.trim();
        fail(
          new HarnessStartError(
            `Harness 在准备完成前退出（code=${String(code)}, signal=${String(signal)}）${
              detail ? `\n${detail}` : ""
            }`,
          ),
        );
        return;
      }
      if (!stopping && !unexpectedExitReported) {
        unexpectedExitReported = true;
        onUnexpectedExit?.({ code, signal, diagnostic });
      }
    });

    startupTimer = setTimeout(() => {
      stopping = true;
      const detail = diagnostic.trim();
      void stop().finally(() =>
        fail(
          new HarnessStartError(
            `Harness 启动超时（${startupTimeoutMs}ms）${detail ? `\n${detail}` : ""}`,
          ),
        ),
      );
    }, startupTimeoutMs);
    startupTimer.unref?.();
    signal?.addEventListener("abort", abortStartup, { once: true });
    if (signal?.aborted) abortStartup();
  });

  return { child, harnessHome, stop, url, workspacePath };
}
