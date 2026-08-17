import { execFile } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { arch } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const projectRoot = fileURLToPath(new URL("../", import.meta.url));

if (process.platform !== "darwin") process.exit(0);

const targetArch = process.argv[2] ?? arch();
if (!new Set(["arm64", "x64"]).has(targetArch)) {
  throw new Error(`Unsupported macOS architecture: ${targetArch}`);
}
const source = join(projectRoot, "native", "macos-composer-glass.mm");
const output = join(projectRoot, "native", "build", "macos-composer-glass.node");
const nodePrefix = process.config.variables.node_prefix;
const nodeHeaders = join(nodePrefix, "include", "node");

try {
  await access(join(nodeHeaders, "node_api.h"), constants.R_OK);
} catch {
  throw new Error(`Node headers are missing: ${nodeHeaders}`);
}

await mkdir(dirname(output), { recursive: true });
await execFileAsync("xcrun", [
  "clang++",
  "-std=c++17",
  "-fobjc-arc",
  "-bundle",
  "-undefined",
  "dynamic_lookup",
  "-mmacosx-version-min=26.0",
  "-arch",
  targetArch,
  "-framework",
  "AppKit",
  "-I",
  nodeHeaders,
  source,
  "-o",
  output,
]);

console.log(`Built native macOS composer glass: ${output}`);
