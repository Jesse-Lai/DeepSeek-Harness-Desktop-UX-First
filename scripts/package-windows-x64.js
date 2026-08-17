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
});

console.log(`Wrote Windows x64 portable app to: ${outputPaths[0]}`);
