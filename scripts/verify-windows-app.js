import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { projectRoot } from "./package-shared.js";
import { productName } from "../src/product.js";

const execFileAsync = promisify(execFile);
const appDirectory = join(projectRoot, "dist", `${productName}-win32-x64`);
const executablePath = join(appDirectory, `${productName}.exe`);

await access(executablePath);
const header = await readFile(executablePath).then((contents) => contents.subarray(0, 2));
if (header.toString("ascii") !== "MZ") {
  throw new Error(`Packaged executable does not have a Windows PE header: ${executablePath}`);
}

if (process.env.DSH_RELEASE_BUILD === "1") {
  const windowsDirectory = process.env.WINDIR ?? "C:\\Windows";
  const powershellPath = join(
    windowsDirectory,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const escapedPath = executablePath.replaceAll("'", "''");
  const { stdout } = await execFileAsync(powershellPath, [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `$signature = Get-AuthenticodeSignature -LiteralPath '${escapedPath}'; ` +
      "[PSCustomObject]@{ Status = [string]$signature.Status; Subject = $signature.SignerCertificate.Subject } | ConvertTo-Json -Compress",
  ]);
  const signature = JSON.parse(stdout.trim());
  if (signature.Status !== "Valid" || !signature.Subject) {
    throw new Error(`Authenticode signature is not valid: ${JSON.stringify(signature)}`);
  }
}

console.log(
  `Verified ${process.env.DSH_RELEASE_BUILD === "1" ? "signed release" : "development"} Windows x64 app: ${executablePath}`,
);
