import { spawn } from "node:child_process";
import { productName } from "../src/product.js";

const executablePath = process.argv[2];
if (!executablePath) {
  throw new Error("Usage: node scripts/run-packaged-smoke.js <packaged executable>");
}

const successMarker = `${productName} single-Renderer smoke test passed:`;
const failureMarker = `${productName} smoke test failed:`;
let output = "";

const child = spawn(executablePath, ["--smoke-test"], {
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

for (const stream of [child.stdout, child.stderr]) {
  stream.on("data", (chunk) => {
    const text = chunk.toString();
    output += text;
    process.stdout.write(text);
  });
}

const timeout = setTimeout(() => child.kill("SIGKILL"), 90_000);
const { code, signal } = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (exitCode, exitSignal) =>
    resolve({ code: exitCode, signal: exitSignal }),
  );
});
clearTimeout(timeout);

if (
  code !== 0 ||
  signal !== null ||
  output.includes(failureMarker) ||
  !output.includes(successMarker)
) {
  throw new Error(
    `Packaged smoke test did not pass (code=${String(code)}, signal=${String(signal)})`,
  );
}
