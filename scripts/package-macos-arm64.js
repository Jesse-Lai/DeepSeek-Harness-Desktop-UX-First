import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  applicationVersion,
  ignoreFromApplication,
  projectRoot,
} from "./package-shared.js";
import { installSerialPackagerCopy } from "./install-serial-packager-copy.js";
import { macOSBundleIdentifier, productName } from "../src/product.js";

const execFileAsync = promisify(execFile);
const targetArch = process.argv[2] ?? "arm64";
const releaseBuild = process.env.DSH_RELEASE_BUILD === "1";
const appBundleId = macOSBundleIdentifier;
const defaultBuildVersion = applicationVersion.match(/\d+/g)?.slice(0, 4).join(".");
if (!new Set(["arm64", "x64"]).has(targetArch)) {
  throw new Error(`Unsupported macOS architecture: ${targetArch}`);
}

const targetNativePackages = [
  `@koromix/koffi-darwin-${targetArch}`,
  `node-addon-require-builtin-darwin-${targetArch}`,
];
const missingTargetNativePackages = [];
for (const packageName of targetNativePackages) {
  try {
    await access(
      join(projectRoot, "node_modules", ...packageName.split("/"), "package.json"),
    );
  } catch {
    missingTargetNativePackages.push(packageName);
  }
}
if (missingTargetNativePackages.length > 0) {
  throw new Error(
    [
      `Cannot package macOS ${targetArch}: target-native dependencies are missing.`,
      `Missing: ${missingTargetNativePackages.join(", ")}.`,
      `The installed dependency tree is for ${process.platform}/${process.arch}; run npm ci with a ${targetArch} Node.js runtime before packaging this target.`,
    ].join(" "),
  );
}
await execFileAsync(process.execPath, [join(projectRoot, "scripts", "build-companion.js"), targetArch], { maxBuffer: 8 * 1024 * 1024 });
await execFileAsync(process.execPath, [
  join(projectRoot, "scripts", "build-macos-icon.js"),
]);

function requireReleaseValue(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Release packaging requires ${name}`);
  return value;
}

function releaseSigningOptions() {
  if (!releaseBuild) {
    return {};
  }

  const identity = requireReleaseValue("MACOS_SIGN_IDENTITY");
  const keychainProfile = process.env.MACOS_NOTARY_KEYCHAIN_PROFILE?.trim();
  const osxNotarize = keychainProfile
    ? { keychainProfile }
    : {
        appleId: requireReleaseValue("APPLE_ID"),
        appleIdPassword: requireReleaseValue("APPLE_APP_SPECIFIC_PASSWORD"),
        teamId: requireReleaseValue("APPLE_TEAM_ID"),
      };

  return {
    osxSign: {
      identity,
      continueOnError: false,
      optionsForFile: () => ({ hardenedRuntime: true }),
    },
    osxNotarize,
  };
}

const restorePackagerCopy = installSerialPackagerCopy(projectRoot);
let outputPaths;
try {
  const { packager } = await import("@electron/packager");
  outputPaths = await packager({
    dir: projectRoot,
    name: productName,
    platform: "darwin",
    arch: targetArch,
    electronVersion: "43.4.0",
    appVersion: applicationVersion,
    buildVersion: process.env.MACOS_BUILD_VERSION ?? defaultBuildVersion,
    out: join(projectRoot, "dist"),
    overwrite: true,
    asar: false,
    prune: false,
    appBundleId,
    appCategoryType: "public.app-category.developer-tools",
    appCopyright: "Copyright © 2026 Jesse Lai",
    extendInfo: {
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: false,
        NSAllowsLocalNetworking: true,
      },
    },
    icon: join(projectRoot, "dist", "icon", "app-icon.icns"),
    ignore: ignoreFromApplication,
    extraResource: [join(projectRoot, "dist", "native", "DSH Companion.app")],
    ...releaseSigningOptions(),
  });
} finally {
  restorePackagerCopy();
}

if (!releaseBuild) {
  const appPath = join(outputPaths[0], `${productName}.app`);
  await execFileAsync("/usr/bin/codesign", [
    "--force",
    "--deep",
    "--sign",
    "-",
    appPath,
  ]);
}

console.log(
  `Wrote ${releaseBuild ? "signed and notarized " : "development "}${targetArch} app to: ${outputPaths[0]}`,
);
