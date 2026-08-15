import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  HarnessStartError,
  parseHarnessUrl,
  startHarness,
  stopHarnessProcess,
} from "../src/harness.js";

class FakeChild extends EventEmitter {
  constructor({ exitOnKill = true } = {}) {
    super();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.exitCode = null;
    this.signalCode = null;
    this.kills = [];
    this.exitOnKill = exitOnKill;
  }

  kill(signal) {
    this.kills.push(signal);
    if (this.exitOnKill) {
      queueMicrotask(() => this.finish(null, signal));
    } else if (signal === "SIGKILL") {
      queueMicrotask(() => this.finish(null, signal));
    }
    return true;
  }

  finish(code, signal = null) {
    if (this.exitCode !== null || this.signalCode !== null) return;
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("exit", code, signal);
  }
}

async function withTempDirectory(run) {
  const directory = await mkdtemp(join(tmpdir(), "dsh-desktop-test-"));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("parseHarnessUrl accepts only a valid loopback startup URL", () => {
  assert.equal(
    parseHarnessUrl("ready\ndsh web: http://127.0.0.1:43125\n"),
    "http://127.0.0.1:43125",
  );
  assert.equal(parseHarnessUrl("dsh web: http://0.0.0.0:43125"), undefined);
  assert.equal(parseHarnessUrl("dsh web: http://127.0.0.1:70000"), undefined);
});

test("startHarness launches the official CLI with isolated desktop paths", () =>
  withTempDirectory(async (directory) => {
    const child = new FakeChild();
    let invocation;
    const starting = startHarness({
      executablePath: "/Applications/Electron.app/Electron",
      cliPath: "/app/dsh/lib/bin.js",
      userDataPath: directory,
      checkHttpReady: async () => true,
      spawn(executable, args, options) {
        invocation = { executable, args, options };
        queueMicrotask(() => {
          child.stdout.write("dsh web: http://127.0.0.1:");
          child.stdout.write("43210\n");
        });
        return child;
      },
    });

    const controller = await starting;
    assert.equal(controller.url, "http://127.0.0.1:43210");
    assert.equal(invocation.executable, "/Applications/Electron.app/Electron");
    assert.deepEqual(invocation.args, [
      "--expose-internals",
      "/app/dsh/lib/bin.js",
      "web",
      "--host",
      "127.0.0.1",
      "--port",
      "0",
    ]);
    assert.equal(invocation.options.cwd, join(directory, "workspace"));
    assert.equal(invocation.options.env.DSH_HOME, join(directory, "harness"));
    assert.equal(invocation.options.env.ELECTRON_RUN_AS_NODE, "1");
    await controller.stop();
    assert.deepEqual(child.kills, ["SIGTERM"]);
  }));

test("startHarness reports stderr when the child exits before readiness", () =>
  withTempDirectory(async (directory) => {
    const child = new FakeChild();
    const starting = startHarness({
      executablePath: "electron",
      cliPath: "dsh.js",
      userDataPath: directory,
      spawn() {
        queueMicrotask(() => {
          child.stderr.write("configuration failed");
          child.finish(1);
        });
        return child;
      },
    });

    await assert.rejects(starting, (error) => {
      assert.ok(error instanceof HarnessStartError);
      assert.match(error.message, /configuration failed/);
      return true;
    });
  }));

test("startHarness reports an unexpected exit only after readiness", () =>
  withTempDirectory(async (directory) => {
    const child = new FakeChild();
    const exits = [];
    const controllerPromise = startHarness({
      executablePath: "electron",
      cliPath: "dsh.js",
      userDataPath: directory,
      onUnexpectedExit: (event) => exits.push(event),
      checkHttpReady: async () => true,
      spawn() {
        queueMicrotask(() => child.stdout.write("dsh web: http://127.0.0.1:12345\n"));
        return child;
      },
    });

    await controllerPromise;
    child.finish(7);
    assert.equal(exits.length, 1);
    assert.equal(exits[0].code, 7);
  }));

test("startHarness waits until the HTTP page is reachable", () =>
  withTempDirectory(async (directory) => {
    const child = new FakeChild();
    let checks = 0;
    const starting = startHarness({
      executablePath: "electron",
      cliPath: "dsh.js",
      userDataPath: directory,
      readinessRetryMs: 1,
      checkHttpReady: async () => {
        checks += 1;
        return checks === 3;
      },
      spawn() {
        queueMicrotask(() => child.stdout.write("dsh web: http://127.0.0.1:12345\n"));
        return child;
      },
    });

    const controller = await starting;
    assert.equal(controller.url, "http://127.0.0.1:12345");
    assert.equal(checks, 3);
    await controller.stop();
  }));

test("startHarness stops the child when startup is cancelled", () =>
  withTempDirectory(async (directory) => {
    const child = new FakeChild();
    const abortController = new AbortController();
    const starting = startHarness({
      executablePath: "electron",
      cliPath: "dsh.js",
      userDataPath: directory,
      signal: abortController.signal,
      spawn() {
        queueMicrotask(() => abortController.abort());
        return child;
      },
    });

    await assert.rejects(starting, /启动已取消/);
    assert.deepEqual(child.kills, ["SIGTERM"]);
  }));

test("startup cancellation wins over an in-flight successful readiness check", () =>
  withTempDirectory(async (directory) => {
    const child = new FakeChild({ exitOnKill: false });
    const abortController = new AbortController();
    let resolveProbe;
    let markProbeStarted;
    const probeStarted = new Promise((resolve) => {
      markProbeStarted = resolve;
    });
    const starting = startHarness({
      executablePath: "electron",
      cliPath: "dsh.js",
      userDataPath: directory,
      signal: abortController.signal,
      stopTimeoutMs: 1,
      checkHttpReady: () =>
        new Promise((resolve) => {
          resolveProbe = resolve;
          markProbeStarted();
        }),
      spawn() {
        queueMicrotask(() => child.stdout.write("dsh web: http://127.0.0.1:12345\n"));
        return child;
      },
    });

    await probeStarted;
    abortController.abort();
    resolveProbe(true);

    await assert.rejects(starting, /启动已取消/);
    assert.deepEqual(child.kills, ["SIGTERM", "SIGKILL"]);
  }));

test("stopHarnessProcess force kills a child that ignores SIGTERM", async () => {
  const child = new FakeChild({ exitOnKill: false });
  await stopHarnessProcess(child, 10);
  assert.deepEqual(child.kills, ["SIGTERM", "SIGKILL"]);
});
