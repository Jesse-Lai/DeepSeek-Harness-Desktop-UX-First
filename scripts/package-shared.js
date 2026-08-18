import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const projectRoot = fileURLToPath(new URL("../", import.meta.url));

const [packageMetadata, lockfile] = await Promise.all([
  readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../package-lock.json", import.meta.url), "utf8").then(JSON.parse),
]);

export const applicationVersion = packageMetadata.version;

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

export function ignoreFromApplication(path) {
  const normalized = path.replaceAll("\\", "/");

  if (/^\/(?:\.git|\.github|build|dist|docs|scripts|test)(?:\/|$)/.test(normalized)) {
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
