import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const lockfilePath = join(projectRoot, "package-lock.json");
const outputPath = join(projectRoot, "THIRD_PARTY_DEPENDENCIES.md");
const checkOnly = process.argv.includes("--check");

function dependencyName(packagePath) {
  const segments = packagePath.replaceAll("\\", "/").split("node_modules/");
  const tail = segments.at(-1)?.split("/") ?? [];
  return tail[0]?.startsWith("@") ? `${tail[0]}/${tail[1]}` : tail[0];
}

function platformLabel(metadata) {
  const parts = [];
  if (Array.isArray(metadata.os)) parts.push(`os: ${metadata.os.join(", ")}`);
  if (Array.isArray(metadata.cpu)) parts.push(`cpu: ${metadata.cpu.join(", ")}`);
  return parts.length === 0 ? "all" : parts.join("; ");
}

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeLineEndings(value) {
  return value.replaceAll("\r\n", "\n");
}

const lockfile = JSON.parse(await readFile(lockfilePath, "utf8"));
const dependencies = [];
const seen = new Set();

for (const [packagePath, metadata] of Object.entries(lockfile.packages ?? {})) {
  if (!packagePath.startsWith("node_modules/") || metadata.dev === true) continue;
  const name = dependencyName(packagePath);
  const version = metadata.version;
  const license = metadata.license;
  if (!name || !version) continue;
  if (!license) {
    throw new Error(`Production dependency is missing license metadata: ${packagePath}`);
  }
  const platform = platformLabel(metadata);
  const key = `${name}\0${version}\0${license}\0${platform}`;
  if (seen.has(key)) continue;
  seen.add(key);
  dependencies.push({ name, version, license, platform });
}

dependencies.sort((left, right) =>
  compareText(left.name, right.name) ||
  compareText(left.version, right.version) ||
  compareText(left.platform, right.platform),
);

const rows = dependencies.map(({ name, version, license, platform }) =>
  `| ${escapeCell(name)} | ${escapeCell(version)} | ${escapeCell(license)} | ${escapeCell(platform)} |`,
);
const output = `# Third-party dependency inventory

This file is generated from \`package-lock.json\` by
\`npm run licenses:generate\`. Do not edit it by hand.

It lists every locked non-development dependency, including optional packages
for platforms other than the current machine. A release artifact contains only
the packages installed for its target platform. Package-specific license and
notice files remain alongside each package in the distributed application.

Total entries: ${dependencies.length}

| Package | Version | License | Platform |
| --- | --- | --- | --- |
${rows.join("\n")}
`;

if (checkOnly) {
  let current;
  try {
    current = await readFile(outputPath, "utf8");
  } catch {
    throw new Error("THIRD_PARTY_DEPENDENCIES.md is missing; run npm run licenses:generate");
  }
  if (normalizeLineEndings(current) !== output) {
    throw new Error("THIRD_PARTY_DEPENDENCIES.md is stale; run npm run licenses:generate");
  }
  console.log(`Verified ${dependencies.length} third-party dependency entries.`);
} else {
  await writeFile(outputPath, output, "utf8");
  console.log(`Wrote ${dependencies.length} entries to ${outputPath}`);
}
