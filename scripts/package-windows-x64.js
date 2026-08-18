import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { packager } from "@electron/packager";
import {
  applicationVersion,
  ignoreFromApplication,
  projectRoot,
} from "./package-shared.js";
import { productName } from "../src/product.js";

const execFileAsync = promisify(execFile);
const releaseBuild = process.env.DSH_RELEASE_BUILD === "1";

function requireReleaseValue(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Release packaging requires ${name}`);
  return value;
}

await execFileAsync(process.execPath, [
  join(projectRoot, "scripts", "build-windows-icon.js"),
]);

const outputPaths = await packager({
  dir: projectRoot,
  name: productName,
  platform: "win32",
  arch: "x64",
  electronVersion: "43.4.0",
  appVersion: applicationVersion,
  appVersion: applicationVersion,
  out: join(projectRoot, "dist"),
  overwrite: true,
  asar: false,
  prune: false,
  icon: join(projectRoot, "dist", "icon", "app-icon.ico"),
  ignore: ignoreFromApplication,
  win32metadata: {
    CompanyName: "Jesse Lai",
    FileDescription: productName,
    InternalName: productName,
    OriginalFilename: `${productName}.exe`,
    ProductName: productName,
  },
  windowsSign: releaseBuild
    ? {
        certificateFile: requireReleaseValue("WINDOWS_CERTIFICATE_FILE"),
        certificatePassword: requireReleaseValue("WINDOWS_CERTIFICATE_PASSWORD"),
        timestampServer:
          process.env.WINDOWS_TIMESTAMP_SERVER?.trim() || "http://timestamp.digicert.com",
        description: productName,
        website: "https://github.com/Jesse-Lai/DeepSeek-Harness-Desktop-UX-First",
        hashes: ["sha256"],
        continueOnError: false,
      }
    : undefined,
});

console.log(
  `Wrote ${releaseBuild ? "signed release" : "development"} Windows x64 portable app to: ${outputPaths[0]}`,
);
