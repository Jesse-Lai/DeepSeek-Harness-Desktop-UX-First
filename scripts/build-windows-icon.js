import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { projectRoot } from "./package-shared.js";

const sourceAvatar = join(projectRoot, "assets", "app-icon-source.png");
const outputDirectory = join(projectRoot, "dist", "icon");
const masterIcon = join(outputDirectory, "app-icon-1024.png");
const outputIcon = join(outputDirectory, "app-icon.ico");
const iconSizes = [16, 24, 32, 48, 64, 128, 256];

await mkdir(outputDirectory, { recursive: true });

const background = Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
    <rect x="56" y="56" width="912" height="912" rx="208" fill="#000000"/>
    <rect x="68" y="68" width="888" height="888" rx="196" fill="none" stroke="#3f3f46" stroke-width="8"/>
  </svg>
`);
const avatar = await sharp(sourceAvatar)
  .resize(660, 660, { fit: "contain" })
  .png()
  .toBuffer();
await sharp(background)
  .composite([{ input: avatar, left: 182, top: 182 }])
  .png()
  .toFile(masterIcon);

const masterPng = await readFile(masterIcon);
const images = await Promise.all(
  iconSizes.map((size) => sharp(masterPng).resize(size, size).png().toBuffer()),
);
const directoryHeader = Buffer.alloc(6);
directoryHeader.writeUInt16LE(0, 0);
directoryHeader.writeUInt16LE(1, 2);
directoryHeader.writeUInt16LE(images.length, 4);

const entries = [];
let imageOffset = directoryHeader.length + images.length * 16;
for (let index = 0; index < images.length; index += 1) {
  const size = iconSizes[index];
  const image = images[index];
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size === 256 ? 0 : size, 0);
  entry.writeUInt8(size === 256 ? 0 : size, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(image.length, 8);
  entry.writeUInt32LE(imageOffset, 12);
  entries.push(entry);
  imageOffset += image.length;
}

await writeFile(outputIcon, Buffer.concat([directoryHeader, ...entries, ...images]));
console.log(`Wrote Windows app icon to: ${outputIcon}`);
