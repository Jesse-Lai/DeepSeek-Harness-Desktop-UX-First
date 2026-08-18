# DeepSeek Harness UX First

一个以用户体验为先的 DeepSeek Harness 桌面客户端：保留官方完整功能，重点优化了产品交互体验，以及生成过程中的 Reasoning、执行进度和工具活动呈现，让复杂 Coding 任务更加清晰、自然、易于掌控。后续也将基于 DeepSeek Harness 的插件理念进行产品功能优化和创新。

> A polished, ready-to-run desktop experience for DeepSeek Harness.

## 项目介绍

DeepSeek Harness UX First 基于官方 DeepSeek Harness 构建，不分叉或长期修改 Harness 官方源码。项目通过 Electron 桌面封装与插件扩展，在保持官方能力和生态兼容性的基础上，持续优化桌面端使用体验。

## v1.0 亮点

- **全新的桌面视觉体验**：重新打磨侧栏、对话区、输入区、菜单和交互状态。
- **更易理解的生成过程**：优化 Reasoning、执行进度和工具活动呈现。
- **保留官方完整功能**：继续使用固定版本的官方 `@deepseek-ai/dsh` 软件包，保留 Harness 原有的会话、工具和输入逻辑。
- **开箱即用**：正式发行物内置 Node、Harness 和运行依赖，无需单独安装 Node 或 npm。
- **兼容 Harness 生态**：保持对 Plugins、MCP、Skills 和工具生态的兼容。
- **多平台支持**：覆盖 macOS Apple Silicon、macOS Intel 和 Windows x64。

## 当前版本：1.0.0

三平台发行物均通过自动化测试、打包验证和启动冒烟测试：

| 平台 | 构建验证 |
| --- | --- |
| macOS Apple Silicon | 已通过 |
| macOS Intel | 已通过 |
| Windows x64 | 已通过 |

`v1.0.0` 提供无需 Node 或 npm 的三平台独立发行包。每个下载包均由 GitHub Actions 从发布标签构建、验证并附带 SHA-256 校验值。

## 下载与安装

请从 [GitHub Releases](https://github.com/Jesse-Lai/DeepSeek-Harness-Desktop-UX-First/releases) 下载对应平台的文件；不要下载 GitHub 自动生成的 Source code 压缩包。

- macOS Apple Silicon：`DeepSeek-Harness-UX-First-macOS-arm64-v1.0.0.zip`
- macOS Intel：`DeepSeek-Harness-UX-First-macOS-x64-v1.0.0.zip`
- Windows x64：`DeepSeek-Harness-UX-First-Windows-x64-v1.0.0.zip`

macOS 用户解压后将应用拖入 `/Applications`，再双击打开。Windows 用户完整解压后，双击 `DeepSeek Harness UX First.exe`。

当前社区发行包没有商业代码签名证书。macOS 包使用 ad-hoc 签名但未经 Apple 公证；如果系统拦截首次启动，请在 Finder 中右键应用并选择“打开”，或前往“系统设置 → 隐私与安全性”选择“仍要打开”。Windows 可能显示 Microsoft Defender SmartScreen 提示，可选择“更多信息 → 仍要运行”。请仅从本仓库 Releases 下载，并可使用随包提供的 `SHA256SUMS` 核对文件完整性。

## 更新与本地数据

1.0 初期通过 GitHub Releases 手动更新：下载新版后覆盖旧应用即可。对话、项目、设置和 API 信息存放在独立的用户数据目录中，不会因覆盖应用而清空。为兼容旧版本，应用继续读取原有的 `DSH Desktop` 数据目录。

完整说明见 [更新与本地数据](docs/updates.md)。发布历史见 [CHANGELOG](CHANGELOG.md)，安全问题请按 [安全策略](SECURITY.md) 私下报告。

## 与官方 DeepSeek Harness 的关系

本项目基于 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 构建，并使用固定版本的官方 `@deepseek-ai/dsh` 软件包。官方项目提供 Agent 核心、会话、工具、模型接入、Web UI，以及 Plugins、MCP 和 Skills 生态。本项目主要负责：

- Electron 桌面应用封装
- 本地 Harness 服务的启动、停止与异常清理
- 桌面窗口和操作系统集成
- Node、Harness 与运行依赖的一体化打包
- macOS 与 Windows 发行物构建
- 基于插件机制的视觉、交互与 Reasoning 呈现优化

DeepSeek Harness UX First 是社区项目，与 DeepSeek 官方无隶属关系。

## 桌面架构

- Electron 只创建一个主 `BrowserWindow`，Harness React 应用是唯一交互渲染层。
- 侧栏、Composer、按钮、菜单、Modal、Hover 和焦点状态全部由 Chromium DOM/CSS 处理。
- macOS 主窗口通过系统 vibrancy 与 Web 背景配合实现视觉效果。
- 桌面 UI 插件位于 [`plugins/@jesse-lai/dsh-desktop-ui`](plugins/@jesse-lai/dsh-desktop-ui)，不替换官方会话、工具和输入逻辑。

## 本地开发

需要 Node.js 和 npm。克隆仓库后运行：

```bash
npm ci
npm test
npm start
```

`node_modules` 和 `dist` 仅保留在本机，不提交到 GitHub。也可以生成可从 Finder 双击启动的 macOS 开发版：

```bash
npm run app:dev:mac
```

发布流程和签名凭据说明见 [1.0 发布手册](docs/releasing-1.0.md)。

## 参与贡献

欢迎通过 Issues 提交问题、建议和产品想法，也欢迎通过 Pull Requests 参与功能、交互、插件和文档改进。

## 特别感谢

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 与 DeepSeek AI 团队提供 Agent 核心、工具、会话、Web UI 和插件生态。
- [Cordis](https://github.com/deepseek-ai/deepseek-harness/tree/main/vendor/cordis) 提供插件化基础。
- [Prompt Kit](https://github.com/ibelick/prompt-kit) 提供交互与视觉模式参考。
- [lucide-animated](https://github.com/pqoqubbw/icons) 提供界面图标资源。
- 所有参与讨论、测试、反馈和贡献的社区成员。

## License

本项目采用 MIT License。第三方依赖和相关许可信息请参阅 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和 [THIRD_PARTY_DEPENDENCIES.md](THIRD_PARTY_DEPENDENCIES.md)。
