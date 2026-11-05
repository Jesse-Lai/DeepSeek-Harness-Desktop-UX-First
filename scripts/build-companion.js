import { execFile } from 'node:child_process';
import { mkdir, cp, copyFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const arch = process.argv[2] ?? process.arch;
if (!['arm64', 'x64'].includes(arch)) throw new Error('Unsupported companion architecture');
const triple = `${arch === 'x64' ? 'x86_64' : 'arm64'}-apple-macosx26.0`;
const scratch = join(root, 'dist', 'companion-build', arch);
const source = join(root, 'native', 'DSHCompanion');
const env = { ...process.env, CLANG_MODULE_CACHE_PATH: join(scratch, 'module-cache'), SWIFTPM_MODULECACHE_OVERRIDE: join(scratch, 'module-cache') };
const args = ['build', '--package-path', source, '--scratch-path', scratch, '--disable-sandbox', '--configuration', 'release', '--triple', triple];
await exec('swift', args, { env, maxBuffer: 8 * 1024 * 1024 });
const { stdout } = await exec('swift', [...args, '--show-bin-path'], { env });
const app = join(root, 'dist', 'native', 'DSH Companion.app');
const contents = join(app, 'Contents');
await mkdir(join(contents, 'MacOS'), { recursive: true });
await mkdir(join(contents, 'Resources'), { recursive: true });
await copyFile(join(stdout.trim(), 'JesseCompanion'), join(contents, 'MacOS', 'JesseCompanion'));
await cp(join(source, 'Sources/JesseCompanion/Resources/FluentIcons'), join(contents, 'Resources/FluentIcons'), { recursive: true });
await writeFile(join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.jesselai.dsh.companion</string>
<key>CFBundleName</key><string>DSH Companion</string>
<key>CFBundleDisplayName</key><string>DSH</string>
<key>CFBundleExecutable</key><string>JesseCompanion</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.0.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSMinimumSystemVersion</key><string>26.0</string>
<key>LSUIElement</key><true/>
<key>NSHighResolutionCapable</key><true/>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
<key>NSAccessibilityUsageDescription</key><string>读取你选择的文字或当前页面，并把结果安全回填到原位置。</string>
<key>NSAppleEventsUsageDescription</key><string>读取当前 Chrome 或 Safari 标签页的地址和标题作为任务上下文。</string>
<key>NSScreenCaptureUsageDescription</key><string>捕获你选择的屏幕区域或当前窗口用于分析。</string>
</dict></plist>`);
await exec('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--requirements', '=designated => identifier "com.jesselai.dsh.companion"', app]);
await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
console.log(`Built ${app} (${arch})`);
