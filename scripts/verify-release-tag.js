import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { projectRoot } from "./package-shared.js";

const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
if (!tag) {
  throw new Error("Usage: node scripts/verify-release-tag.js <v-version-tag>");
}

const packageMetadata = JSON.parse(
  await readFile(join(projectRoot, "package.json"), "utf8"),
);
const expectedTag = `v${packageMetadata.version}`;
if (tag !== expectedTag) {
  throw new Error(`Release tag ${JSON.stringify(tag)} must equal ${JSON.stringify(expectedTag)}`);
}

console.log(`Verified release tag ${tag} for package version ${packageMetadata.version}.`);
