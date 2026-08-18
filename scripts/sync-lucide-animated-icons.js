import { readFile, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";

const sourceRoot = process.argv[2];
if (!sourceRoot) {
  throw new Error("usage: node scripts/sync-lucide-animated-icons.js <pqoqubbw/icons checkout>");
}

const outputPath = resolve("plugins/@jesse-lai/dsh-desktop-ui/lib/client.js");

const iconMap = {
  IconAgentPresetOutline16: "bot",
  IconApiOutline14: "terminal",
  IconArchiveOutline20: "archive",
  IconBranchOutline16: "git-branch",
  IconBrowseOutline16: "file-text",
  IconCheckOutline14: "check",
  IconCheckOutline16: "check",
  IconChecklistOutline14: "circle-check",
  IconChevronDownOutline14: "chevron-down",
  IconChevronLeftOutline14: "chevron-left",
  IconChevronRightOutline14: "chevron-right",
  IconChevronUpOutline14: "chevron-up",
  IconCloseFill14: "x",
  IconCloseOutline16: "x",
  IconCodeOutline16: "terminal",
  IconCopyOutline16: "copy",
  IconCordisPluginOutline14: "blocks",
  IconDarkOutline16: "moon",
  IconDataOutline16: "database-backup",
  IconDislikeFill16: "downvote",
  IconDislikeOutline16: "downvote",
  IconDownloadOutline16: "download",
  IconEditOutline16: "square-pen",
  IconEllipsisOutline16: "menu",
  IconEnhanceOutline16: "sparkles",
  IconFolderClose16: "folder-root",
  IconFolderOpen16: "folder-open",
  IconFolderOpenOutline16: "folder-open",
  IconFollowsystemOutline16: "monitor-cog",
  IconFullscreenOutline16: "expand",
  IconGlobeOutline14: "earth",
  IconGoalOutline16: "circle-gauge",
  IconInspectOutline12: "scan-text",
  IconLightOutline16: "sun",
  IconLikeFill16: "upvote",
  IconLikeOutline16: "upvote",
  IconLinkOutline14: "link",
  IconLinkOutline16: "link",
  IconListPenOutline16: "file-pen-line",
  IconLoadingOutline16: "loader-circle",
  IconNewChatOutline16: "message-square-plus",
  IconPanelLeftOutline16: "panel-left-close",
  IconPaperclipOutline16: "link",
  IconPauseOutline16: "pause",
  IconPersonalizationOutline16: "user-round-cog",
  IconPlayOutline16: "play",
  IconPlusOutline16: "plus",
  IconProjectAddOutline16: "folder-plus",
  IconQuestionOutline14: "circle-help",
  IconQueueOutline14: "square-stack",
  IconRefreshOutline14: "refresh-cw",
  IconRefreshOutline16: "refresh-cw",
  IconRightUpOutline14: "arrow-up-right",
  IconRightUpOutline16: "arrow-up-right",
  IconSearchOutline16: "search",
  IconSendOutline14: "arrow-up",
  IconSendOutline16: "arrow-up",
  IconSettingsOutline14: "settings",
  IconSettingsOutline16: "settings",
  IconShareOutline16: "square-arrow-up",
  IconSkillOutline16: "file-cog",
  IconSparkle16: "sparkles",
  IconStopFill16: "ban",
  IconThinkOutline14: "brain",
  IconThinkOutline16: "brain",
  IconTrashOutline16: "shredder",
  IconTreeCorner8x10: "corner-down-right",
  IconTriangleRightFill14: "play",
  IconUserOutline16: "user",
  IconWarningOutline16: "badge-alert",
};

const inlineIconMap = [
  ["chevron-right", '<svg><path d="M6 3.5L10.5 8L6 12.5"/></svg>'],
  ["shredder", '<svg><path d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9a1 1 0 001 .9h4.6a1 1 0 001-.9L12 4M6.5 6.8v4.4M9.5 6.8v4.4"/></svg>'],
  ["shield-check", '<svg><path d="M8.20554 0.899994L14.7901 3.36857V7.01026C14.7901 12 11.0466 14.2103 8.20554 15.3C5.36446 14.2103 1.62012 12 1.62012 7.01026V3.36857L8.20554 0.899994Z"/><path d="M12.1654 5.7552L8.9447 9.41475C8.73044 9.65816 8.53628 9.8804 8.35774 10.0423C8.1713 10.2114 7.94235 10.3717 7.64016 10.4254C7.48207 10.4535 7.32 10.4552 7.16151 10.4294C6.85843 10.3801 6.62728 10.2223 6.43836 10.0559C6.25752 9.89653 6.06037 9.67732 5.84264 9.43705L4.72925 8.20897L5.63557 7.38707L6.74897 8.61594C6.98603 8.87755 7.12974 9.03533 7.24673 9.13839C7.31033 9.19443 7.34485 9.21476 7.35823 9.22122C7.38068 9.22484 7.40352 9.22515 7.42593 9.22122C7.40522 9.22502 7.42893 9.23294 7.53583 9.136C7.65132 9.03126 7.79316 8.87139 8.02643 8.60638L11.2479 4.94763L12.1654 5.7552Z"/></svg>'],
  ["file-pen-line", '<svg><path d="M8.08887 0.251709C8.20479 0.23085 8.32486 0.241168 8.43652 0.282959L15.0215 2.75171C15.2787 2.84819 15.4492 3.09414 15.4492 3.3689V7.0105C15.4492 7.10986 15.4441 7.2081 15.4414 7.30542C15.0285 7.07175 14.5905 6.87695 14.1309 6.73022V3.82495L8.20508 1.60327L2.2793 3.82495V7.0105C2.27936 9.7171 3.4745 11.5379 5.02734 12.7947C5.01025 12.9942 5 13.1962 5 13.4001C5.00001 13.7617 5.02722 14.1169 5.08008 14.4636C2.91555 13.0393 0.961014 10.752 0.960938 7.0105V3.3689C0.960938 3.09417 1.13146 2.84821 1.38867 2.75171L7.97461 0.282959L8.08887 0.251709Z"/><path d="M11.3525 5.64688V6.85688H5V5.64688H11.3525Z"/><path d="M9.5824 8.29376V9.50376H5V8.29376H9.5824Z"/><path d="M14.6647 15.6852H10.0338C10.3878 15.3751 10.7567 15.0517 11.0772 14.7706C11.2531 14.6164 11.4144 14.4746 11.5511 14.3547H14.6647V15.6852Z"/><path d="M8.14852 14.1308L7.33925 15.4976C7.22458 15.6912 7.42245 15.9194 7.63037 15.8333L9.09785 15.2254L15.0399 10.0719L14.0905 8.97733L8.14852 14.1308Z"/></svg>'],
  ["badge-alert", '<svg><path d="M8.20554 0.899994L14.7901 3.36857V7.01026C14.7901 12 11.0466 14.2103 8.20554 15.3C5.36446 14.2103 1.62012 12 1.62012 7.01026V3.36857L8.20554 0.899994Z"/><path d="M9.10094 4.5V8.75939H7.59888V4.5H9.10094Z"/><path d="M9.10094 9.8114V11.5H7.59888V9.8114H9.10094Z"/></svg>'],
  ["ban", '<svg><rect x="3" y="3" width="10" height="10" rx="3"/></svg>'],
  ["arrow-up", '<svg><path d="M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z"/></svg>'],
  ["x", '<svg><path d="M4 4l8 8M12 4l-8 8"/></svg>'],
  ["wrench", '<svg><path d="M14 3.3a3.8 3.8 0 0 1-4.8 4.8l-5.1 5.1a1.6 1.6 0 1 1-2.3-2.3l5.1-5.1A3.8 3.8 0 0 1 11.7 1l-2.3 2.3 2.3 2.3L14 3.3Z"/></svg>'],
  ["wrench", '<svg><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z"/></svg>'],
  ["circle-help", '<svg><circle cx="8" cy="8" r="6.7"/><circle cx="8" cy="5.5" r=".85"/><path d="M8 7.75v3.4"/></svg>'],
  ["shrink", '<svg><path d="m2.5 2.5 3.75 3.75M3 6.25h3.25V3"/><path d="m13.5 2.5-3.75 3.75M13 6.25H9.75V3"/><path d="m2.5 13.5 3.75-3.75M3 9.75h3.25V13"/><path d="m13.5 13.5-3.75-3.75M13 9.75H9.75V13"/></svg>'],
  ["clock", '<svg><circle cx="8" cy="8" r="5.25"/><path d="M8 4.75V8l2.25 1.5"/></svg>'],
  ["circle-check", '<svg><circle cx="7" cy="7" r="6.4"/><path d="M10.9631 5.71411L7.70154 8.97571C7.48011 9.19714 7.27736 9.40099 7.09229 9.54993C6.89742 9.70669 6.66314 9.85279 6.3634 9.90027C6.2049 9.92534 6.04339 9.92534 5.88489 9.90027C5.58515 9.85279 5.35087 9.70669 5.15601 9.54993C4.97093 9.40099 4.76818 9.19714 4.54675 8.97571L3.03516 7.46411L3.96313 6.53613L5.47473 8.04773C5.7169 8.28989 5.86196 8.43389 5.97888 8.52795C6.08597 8.61409 6.10875 8.60701 6.08997 8.604C6.11259 8.60758 6.13571 8.60758 6.15833 8.604C6.13954 8.60701 6.16232 8.61409 6.26941 8.52795C6.38633 8.43389 6.53139 8.28989 6.77356 8.04773L10.0352 4.78613L10.9631 5.71411Z"/></svg>'],
  ["loader-circle", '<svg><circle cx="7" cy="7" r="6.4"/></svg>'],
  ["circle-dashed", '<svg><circle cx="7" cy="7" r="6.4" stroke-dasharray="2.4 2.4"/></svg>'],
  ["loader-circle", '<svg><rect x="0" y="0" width="2" height="2"/><rect x="4" y="0" width="2" height="2"/><rect x="8" y="0" width="2" height="2"/><rect x="8" y="4" width="2" height="2"/><rect x="8" y="8" width="2" height="2"/><rect x="4" y="8" width="2" height="2"/><rect x="0" y="8" width="2" height="2"/><rect x="0" y="4" width="2" height="2"/></svg>'],
];

// These icons are injected into text, CSS, or native-browser affordances and
// therefore have no DSH SVG geometry to hash.
const runtimeIconSlugs = ["history"];

const geometryTags = new Set([
  "circle",
  "ellipse",
  "g",
  "line",
  "path",
  "polygon",
  "polyline",
  "rect",
]);
const geometryAttributes = [
  "d",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "x",
  "y",
  "x1",
  "x2",
  "y1",
  "y2",
  "width",
  "height",
  "points",
  "transform",
  "mask",
  "clip-path",
  "fill-rule",
  "stroke-dasharray",
];

function hashText(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function geometryHashFromMarkup(markup) {
  const rows = [];
  for (const match of markup.matchAll(/<(circle|ellipse|g|line|path|polygon|polyline|rect)\b([^>]*)>/g)) {
    const [, tag, attributes] = match;
    const row = [tag];
    for (const attribute of geometryAttributes) {
      const value = attributes.match(new RegExp(`\\s${attribute}="([^"]*)"`))?.[1];
      if (value !== undefined) row.push(`${attribute}=${value}`);
    }
    rows.push(row.join("|"));
  }
  return hashText(rows.join(";"));
}

function findTagEnd(source, start) {
  let braces = 0;
  let quote = "";
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && source[index - 1] !== "\\") quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "{") {
      braces += 1;
    } else if (character === "}") {
      braces -= 1;
    } else if (character === ">" && braces === 0) {
      return index;
    }
  }
  throw new Error("unterminated JSX tag");
}

const staticAttributes = new Set([
  ...geometryAttributes,
  "clipPathUnits",
  "fill",
  "id",
  "offset",
  "opacity",
  "pathLength",
  "preserveAspectRatio",
  "spreadMethod",
  "stopColor",
  "stopOpacity",
  "stroke",
  "strokeDasharray",
  "strokeDashoffset",
  "strokeLinecap",
  "strokeLinejoin",
  "strokeMiterlimit",
  "strokeOpacity",
  "strokeWidth",
  "viewBox",
]);
const attributeAliases = {
  clipPath: "clip-path",
  clipPathUnits: "clipPathUnits",
  fillRule: "fill-rule",
  pathLength: "pathLength",
  preserveAspectRatio: "preserveAspectRatio",
  spreadMethod: "spreadMethod",
  stopColor: "stop-color",
  stopOpacity: "stop-opacity",
  strokeDasharray: "stroke-dasharray",
  strokeDashoffset: "stroke-dashoffset",
  strokeLinecap: "stroke-linecap",
  strokeLinejoin: "stroke-linejoin",
  strokeMiterlimit: "stroke-miterlimit",
  strokeOpacity: "stroke-opacity",
  strokeWidth: "stroke-width",
};
const allowedTags = new Set([
  ...geometryTags,
  "clipPath",
  "defs",
  "linearGradient",
  "mask",
  "radialGradient",
  "stop",
  "svg",
]);

function staticTag(source, start) {
  const end = findTagEnd(source, start);
  const raw = source.slice(start, end + 1);
  const closing = raw.match(/^<\/(?:motion\.)?([A-Za-z]+)/);
  if (closing) {
    return { end, output: allowedTags.has(closing[1]) ? `</${closing[1]}>` : "" };
  }
  const opening = raw.match(/^<(?:motion\.)?([A-Za-z]+)/);
  if (!opening || !allowedTags.has(opening[1])) return { end, output: "" };
  const tag = opening[1];
  const attributes = [];
  for (const match of raw.matchAll(/\s([A-Za-z][\w:-]*)=("[^"]*"|'[^']*')/g)) {
    const name = match[1];
    if (!staticAttributes.has(name)) continue;
    attributes.push(`${attributeAliases[name] ?? name}=${match[2]}`);
  }
  const suffix = /\/\s*>$/.test(raw) ? "/>" : ">";
  return {
    end,
    output: `<${tag}${attributes.length ? ` ${attributes.join(" ")}` : ""}${suffix}`,
  };
}

function extractStaticSvg(source, slug) {
  const rootStart = source.search(/<(?:motion\.)?svg\b/);
  if (rootStart < 0) throw new Error(`${slug}: SVG root not found`);
  const output = [];
  for (let index = rootStart; index < source.length; index += 1) {
    if (source[index] !== "<") continue;
    const { end, output: tag } = staticTag(source, index);
    if (tag) output.push(tag);
    index = end;
    if (tag === "</svg>") break;
  }
  const svg = output.join("");
  if (!svg.startsWith("<svg") || !svg.endsWith("</svg>")) {
    throw new Error(`${slug}: failed to extract complete SVG`);
  }
  return svg
    .replace(/^<svg[^>]*>/, '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">')
    .replace(/<([A-Za-z]+)><\/\1>/g, "");
}

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".css")) {
      return { format: "module", source: "export default {}", shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const primitivesUrl = pathToFileURL(
  resolve("node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/index.js"),
).href;
const primitives = await import(primitivesUrl);
const sourceHashes = {};
for (const name of Object.keys(iconMap)) {
  const component = primitives[name];
  if (typeof component !== "function") throw new Error(`${name}: DSH icon export missing`);
  const markup = renderToStaticMarkup(component({}));
  const hash = geometryHashFromMarkup(markup);
  if (sourceHashes[hash] !== undefined && sourceHashes[hash] !== iconMap[name]) {
    throw new Error(`${name}: geometry hash collision with ${sourceHashes[hash]}`);
  }
  sourceHashes[hash] = iconMap[name];
}
for (const [slug, markup] of inlineIconMap) {
  const hash = geometryHashFromMarkup(markup);
  if (sourceHashes[hash] !== undefined && sourceHashes[hash] !== slug) {
    throw new Error(`${slug}: inline geometry hash collision with ${sourceHashes[hash]}`);
  }
  sourceHashes[hash] = slug;
}

const slugs = [
  ...new Set([
    ...Object.values(iconMap),
    ...inlineIconMap.map(([slug]) => slug),
    ...runtimeIconSlugs,
  ]),
].sort();
const icons = {};
for (const slug of slugs) {
  const source = await readFile(resolve(sourceRoot, "icons", `${slug}.tsx`), "utf8");
  icons[slug] = extractStaticSvg(source, slug);
}
icons.bot = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 8V4H8"/><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><line x1="15" x2="15" y1="13" y2="15"/><line x1="9" x2="9" y1="13" y2="15"/></svg>';
/* circle-dashed animates from runtime path data in the source package. Keep
 * its canonical Lucide resting geometry when extracting a static registry. */
icons["circle-dashed"] = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M10.1 2.182a10 10 0 0 1 3.8 0"/><path d="M13.9 21.818a10 10 0 0 1-3.8 0"/><path d="M17.609 3.721a10 10 0 0 1 2.69 2.7"/><path d="M2.182 13.9a10 10 0 0 1 0-3.8"/><path d="M20.279 17.609a10 10 0 0 1-2.7 2.69"/><path d="M21.818 10.1a10 10 0 0 1 0 3.8"/><path d="M3.721 6.391a10 10 0 0 1 2.7-2.69"/><path d="M6.391 20.279a10 10 0 0 1-2.69-2.7"/></svg>';
icons.sun = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="m19.07 4.93-1.41 1.41"/><path d="M20 12h2"/><path d="m17.66 17.66 1.41 1.41"/><path d="M12 20v2"/><path d="m6.34 17.66-1.41 1.41"/><path d="M2 12h2"/><path d="m4.93 4.93 1.41 1.41"/></svg>';

const generated = `    /* Generated from https://github.com/pqoqubbw/icons (lucide-animated).
     * Source revision: 61c4202489f898cccaa2aa64b6a2d5a1a713a32e
     * MIT license; see THIRD_PARTY_NOTICES.md.
     */
    const animatedIconMarkup = ${JSON.stringify(icons, null, 2)};

    const dshIconGeometryMap = new Map(${JSON.stringify(
  Object.entries(sourceHashes).map(([hash, slug]) => [Number(hash), slug]),
  null,
  2,
)});`;

const client = await readFile(outputPath, "utf8");
const startMarker = "    /* lucide-animated generated registry: start */";
const endMarker = "    /* lucide-animated generated registry: end */";
const start = client.indexOf(startMarker);
const end = client.indexOf(endMarker);
if (start < 0 || end < start) throw new Error("lucide-animated registry markers missing");
const nextClient = `${client.slice(0, start + startMarker.length)}\n${generated}\n${client.slice(end)}`;
await writeFile(outputPath, nextClient);
console.log(
  `updated ${outputPath} (${slugs.length} animated icons, ${Object.keys(sourceHashes).length} source mappings)`,
);
