# DSH Desktop

## 目标

- 将官方 DeepSeek Harness 做成桌面应用。
- 支持 macOS x64、macOS arm64 和 Windows x64。
- 用户下载后直接使用，无需安装 Node 或 npm。
- 保持对 Harness Plugins、MCP、Skills 和工具生态的兼容。

## 原则

- 使用固定版本的官方 `@deepseek-ai/dsh` npm 包。
- 不复制或长期修改 Harness 官方源码。
- 不提交 `node_modules`。
- 发布时将 Node、Harness 和所需依赖一起打包。
- 优先完成 macOS；Windows 先保证基本可用。

## 桌面架构

- Electron 只创建一个主 `BrowserWindow`，Harness React 应用是唯一交互渲染层。
- 侧栏、Composer、按钮、菜单、Modal、Hover 和焦点状态全部由 Chromium DOM/CSS 处理。
- macOS 主窗口使用透明背景与 `vibrancy: "under-window"`；侧栏通过半透明 Web 背景露出系统模糊，主对话区保持不透明。
- 交通灯由 Electron 窗口 API 管理。项目不使用 `NSGlassEffectView`、`NSPanel` 或透明子窗口覆盖 Chromium。

## 阶段

### 1. 验证官方 npm 包

- [x] 安装固定版本的官方包（`@deepseek-ai/dsh@0.1.0-rc.6`）。
- [x] 运行 `dsh web`。
- [x] 验证启动、Web UI 和正常退出。
- 完成后暂停并汇报结果。

### 2. 开发 macOS MVP

- [x] 创建 Electron 桌面外壳。
- [x] 在 App 内启动 Harness。
- [x] 显示官方 Harness Web UI。
- [x] 处理启动失败和退出清理。

### 3. 制作完整安装包

- 内置 Node、Harness 和全部运行依赖。
- 确保用户无需安装开发工具。
- 在干净环境验证双击运行。

### 4. 多平台构建

- 构建 macOS x64 安装包。
- 构建并验证 macOS arm64 安装包。
- 构建 Windows x64 安装包并完成基本启动测试。

### 5. 发布开源版本

- 补充使用说明和第三方许可证。
- 完成应用签名、公证和安装包验证。
- 通过 GitHub Releases 发布。

## 当前进度

阶段 1 和阶段 2 已于 2026-08-16 在 Intel Mac 上完成：

- [官方包验证记录](docs/validation/intel-mac.md)
- [macOS MVP 验证记录](docs/validation/macos-mvp.md)

第一版桌面 UI 插件已接入官方 Harness 配置树，用于调整侧栏、聊天区和输入区的视觉表现，
不替换 Harness 原有的会话、工具或输入逻辑。

下一步进入阶段 3，制作无需 Node 或 npm 的完整安装包。

## 本地开发

正常网络环境使用：

```bash
npm ci
npm test
npm start
```

如果公司网络无法访问 npm，可在 GitHub Actions 手动运行
`Prepare macOS ARM64 development dependencies`。该工作流会在 ARM64 macOS runner 上按
`package-lock.json` 安装并测试依赖，然后生成保留 7 天的开发依赖包。将包内的
`node_modules` 解压到项目根目录后即可开发。

工作流会先确认 Electron 主程序为 ARM64，并用它启动一次真实 Harness 冒烟测试；因此依赖包
不仅包含 JavaScript 依赖，也包含本机开发所需的 Electron ARM64 runtime。

`node_modules` 和 `dist` 只保留在本机，不提交到 GitHub。

日常界面开发使用 `npm start` 直接预览；只在阶段完成、打包配置变更或准备发布时重新构建
ARM64、x64 和 Windows 安装包。

也可以生成一个可从 Finder 双击启动的 macOS 开发版：

```bash
npm run app:dev:mac
```

生成的 `dist/dev/DSH Desktop Dev.app` 直接读取当前项目源码。修改 UI 后退出并重新打开即可看到
更新；项目目录被移动、删除，或 `node_modules` 不存在时，开发版将无法启动。
