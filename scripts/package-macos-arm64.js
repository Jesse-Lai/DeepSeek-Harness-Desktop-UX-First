import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { packager } from "@electron/packager";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const targetArch = process.argv[2] ?? "arm64";
if (!new Set(["arm64", "x64"]).has(targetArch)) {
  throw new Error(`Unsupported macOS architecture: ${targetArch}`);
}
const lockfile = JSON.parse(
  await readFile(join(projectRoot, "package-lock.json"), "utf8"),
);

const developmentOnlyModules = new Set(
  Object.entries(lockfile.packages)
    .filter(([path, metadata]) => path.startsWith("node_modules/") && metadata.dev === true)
    .map(([path]) => path),
);

function installedModuleRoot(path) {
  const segments = path.replaceAll("\\", "/").replace(/^\/+/, "").split("/");
  if (segments[0] !== "node_modules" || segments[1] === undefined) return undefined;
  if (!segments[1].startsWith("@")) return `node_modules/${segments[1]}`;
  if (segments[2] === undefined) return undefined;
  return `node_modules/${segments[1]}/${segments[2]}`;
}

function ignoreFromApplication(path) {
  const normalized = path.replaceAll("\\", "/");

  if (/^\/(?:\.git|\.github|dist|docs|scripts|test)(?:\/|$)/.test(normalized)) {
    return true;
  }
  if (/^\/(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(normalized)) {
    return true;
  }
  if (/^\/node_modules\/\.bin(?:\/|$)/.test(normalized)) return true;
  if (/\/node_gyp_bins(?:\/|$)/.test(normalized)) return true;
  if (/\.o(?:bj)?$/.test(normalized)) return true;

  const moduleRoot = installedModuleRoot(normalized);
  return moduleRoot !== undefined && developmentOnlyModules.has(moduleRoot);
}

const outputPaths = await packager({
  dir: projectRoot,
  name: "DSH Desktop",
  platform: "darwin",
  arch: targetArch,
  electronVersion: "43.4.0",
  out: join(projectRoot, "dist"),
  overwrite: true,
  asar: false,
  prune: false,
  appBundleId: "ai.deepseek.dsh-desktop",
  ignore: ignoreFromApplication,
  osxSign: {
    identity: "-",
    identityValidation: false,
    continueOnError: false,
    optionsForFile: () => ({ hardenedRuntime: false }),
  },
});

console.log(`Wrote ${targetArch} app to: ${outputPaths[0]}`);
