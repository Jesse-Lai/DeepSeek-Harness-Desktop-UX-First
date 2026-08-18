import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const sourceAvatar = join(projectRoot, "assets", "app-icon-source.png");
const outputDirectory = join(projectRoot, "dist", "icon");
const masterIcon = join(outputDirectory, "app-icon-1024.png");
const outputIcon = join(outputDirectory, "app-icon.icns");

const iconRepresentations = [
  [16, "icp4"],
  [32, "icp5"],
  [64, "icp6"],
  [128, "ic07"],
  [256, "ic08"],
  [512, "ic09"],
  [1024, "ic10"],
];

if (process.platform !== "darwin") {
  throw new Error("The macOS app icon can only be built on macOS.");
}

await mkdir(outputDirectory, { recursive: true });

const background = Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
    <defs>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%">
        <feDropShadow dx="0" dy="22" stdDeviation="24" flood-color="#000000" flood-opacity="0.18"/>
      </filter>
    </defs>
    <rect x="64" y="52" width="896" height="896" rx="220" fill="#000000" filter="url(#shadow)"/>
    <rect x="76" y="64" width="872" height="872" rx="208" fill="#000000" stroke="#3f3f46" stroke-width="8"/>
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
const chunks = await Promise.all(
  iconRepresentations.map(async ([size, type]) => {
    const png = await sharp(masterPng).resize(size, size).png().toBuffer();
    const chunkHeader = Buffer.alloc(8);
    chunkHeader.write(type, 0, 4, "ascii");
    chunkHeader.writeUInt32BE(png.length + chunkHeader.length, 4);
    return Buffer.concat([chunkHeader, png]);
  }),
);
const header = Buffer.alloc(8);
const body = Buffer.concat(chunks);
header.write("icns", 0, 4, "ascii");
header.writeUInt32BE(header.length + body.length, 4);
await writeFile(outputIcon, Buffer.concat([header, body]));

console.log(`Wrote macOS app icon to: ${outputIcon}`);
