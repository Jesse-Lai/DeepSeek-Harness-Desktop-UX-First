import { execFile } from "node:child_process";
import { access, chmod, copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { macOSBundleIdentifier, productName } from "../src/product.js";

const execFileAsync = promisify(execFile);

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const electronApp = join(
  projectRoot,
  "node_modules",
  "electron",
  "dist",
  "Electron.app",
);
const electronExecutable = join(electronApp, "Contents", "MacOS", "Electron");
const appIcon = join(projectRoot, "dist", "icon", "app-icon.icns");
const developmentProductName = `${productName} Dev`;
const outputApp = join(projectRoot, "dist", "dev", `${developmentProductName}.app`);
const contentsDirectory = join(outputApp, "Contents");
const executableDirectory = join(contentsDirectory, "MacOS");
const resourcesDirectory = join(contentsDirectory, "Resources");
const launcherPath = join(executableDirectory, developmentProductName);

function xmlEscape(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

try {
  await access(electronExecutable, constants.X_OK);
} catch {
  throw new Error(
    "Electron runtime is missing. Run npm install before creating the development app.",
  );
}

await execFileAsync(process.execPath, [
  join(projectRoot, "scripts", "build-macos-icon.js"),
]);

const launcher = `#!/bin/zsh
set -u

project_root=${shellQuote(projectRoot)}
electron_executable=${shellQuote(electronExecutable)}

if [[ ! -d "$project_root" || ! -x "$electron_executable" ]]; then
  /usr/bin/osascript -e 'display alert "${developmentProductName} 无法启动" message "项目目录或 Electron 依赖不存在，请回到项目目录运行 npm install。" as critical'
  exit 1
fi

export DSH_DESKTOP_DEV=1
exec "$electron_executable" "$project_root" "$@"
`;

const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>${developmentProductName}</string>
  <key>CFBundleExecutable</key>
  <string>${developmentProductName}</string>
  <key>CFBundleIconFile</key>
  <string>app-icon.icns</string>
  <key>CFBundleIdentifier</key>
  <string>${macOSBundleIdentifier}.dev</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>${developmentProductName}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.0.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSApplicationCategoryType</key>
  <string>public.app-category.developer-tools</string>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key>
    <true/>
  </dict>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSPrincipalClass</key>
  <string>AtomApplication</string>
  <key>NSQuitAlwaysKeepsWindows</key>
  <false/>
  <key>ProjectRoot</key>
  <string>${xmlEscape(projectRoot)}</string>
</dict>
</plist>
`;

await rm(outputApp, { recursive: true, force: true });
await Promise.all([
  mkdir(executableDirectory, { recursive: true }),
  mkdir(resourcesDirectory, { recursive: true }),
]);
await Promise.all([
  writeFile(launcherPath, launcher, "utf8"),
  writeFile(join(contentsDirectory, "Info.plist"), infoPlist, "utf8"),
  writeFile(join(contentsDirectory, "PkgInfo"), "APPL????", "ascii"),
  copyFile(appIcon, join(resourcesDirectory, "app-icon.icns")),
]);
await chmod(launcherPath, 0o755);
await execFileAsync("/usr/bin/codesign", [
  "--force",
  "--deep",
  "--sign",
  "-",
  outputApp,
]);

console.log(`Wrote development app to: ${outputApp}`);
console.log("This app reads the current project source every time it starts.");
