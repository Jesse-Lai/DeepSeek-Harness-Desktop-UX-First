import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { projectRoot } from "./package-shared.js";
import { macOSBundleIdentifier, productName } from "../src/product.js";

const execFileAsync = promisify(execFile);
const targetArch = process.argv[2];
if (!new Set(["arm64", "x64"]).has(targetArch)) {
  throw new Error("Usage: node scripts/verify-macos-app.js <arm64|x64>");
}

const packageMetadata = JSON.parse(
  await readFile(join(projectRoot, "package.json"), "utf8"),
);
const appPath = join(
  projectRoot,
  "dist",
  `${productName}-darwin-${targetArch}`,
  `${productName}.app`,
);
const plistPath = join(appPath, "Contents", "Info.plist");
const executablePath = join(appPath, "Contents", "MacOS", productName);

async function plistValue(key) {
  const { stdout } = await execFileAsync("/usr/bin/plutil", [
    "-extract",
    key,
    "raw",
    "-o",
    "-",
    plistPath,
  ]);
  return stdout.trim();
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

assertEqual(
  await plistValue("CFBundleShortVersionString"),
  packageMetadata.version,
  "Application version",
);
const bundleIconFile = await plistValue("CFBundleIconFile");
const [bundleIcon, expectedIcon] = await Promise.all([
  readFile(join(appPath, "Contents", "Resources", bundleIconFile)),
  readFile(join(projectRoot, "dist", "icon", "app-icon.icns")),
]);
if (!bundleIcon.equals(expectedIcon)) {
  throw new Error(`Application icon ${bundleIconFile} does not match the generated product icon`);
}
assertEqual(
  await plistValue("CFBundleIdentifier"),
  macOSBundleIdentifier,
  "Bundle identifier",
);

const { stdout: architectures } = await execFileAsync("/usr/bin/lipo", [
  "-archs",
  executablePath,
]);
assertEqual(
  architectures.trim(),
  targetArch === "x64" ? "x86_64" : targetArch,
  "Executable architecture",
);
await execFileAsync("/usr/bin/codesign", [
  "--verify",
  "--deep",
  "--strict",
  "--verbose=2",
  appPath,
]);

if (process.env.DSH_RELEASE_BUILD === "1") {
  const { stderr: signatureDetails } = await execFileAsync("/usr/bin/codesign", [
    "-dvvv",
    appPath,
  ]);
  if (!signatureDetails.includes("Authority=Developer ID Application:")) {
    throw new Error("Release app is not signed with a Developer ID Application certificate");
  }
  if (!/flags=.*\bruntime\b/.test(signatureDetails)) {
    throw new Error("Release app does not enable Hardened Runtime");
  }
  await execFileAsync("/usr/sbin/spctl", ["-a", "-t", "exec", "-vv", appPath]);
  await execFileAsync("/usr/bin/xcrun", ["stapler", "validate", appPath]);
}

console.log(
  `Verified ${process.env.DSH_RELEASE_BUILD === "1" ? "release" : "development"} macOS ${targetArch} app: ${appPath}`,
);
