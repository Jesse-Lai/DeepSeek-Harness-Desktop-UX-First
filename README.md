# DeepSeek Harness UX First

这个以用户体验为先的 DeepSeek Harness 桌面客户端：保留官方完整功能，打磨极致交互体验，开箱即用，持续更新！

> A polished, ready-to-run desktop experience for DeepSeek Harness.

<img width="1792" height="1154" alt="Light" src="https://github.com/user-attachments/assets/8750bf15-fa9d-4e86-a764-ebde212c5990" />
<img width="1743" height="1150" alt="Dark" src="https://github.com/user-attachments/assets/c4c5cecc-63ce-4d9c-bf22-7f0a569eb05d" />

## 项目介绍

DeepSeek Harness UX First 基于官方 DeepSeek Harness 构建，致力于提供媲美 Codex 的 Coding 产品使用体验。

项目不分叉或长期修改 Harness 官方源码，而是在保留官方能力和生态兼容性的基础上，通过桌面封装与插件扩展，持续优化视觉、交互、Reasoning 和复杂任务的执行体验。

## v1.0 亮点

- **全新的桌面视觉体验**：重新打磨侧栏、对话区、输入区、菜单和交互状态，让界面更加清晰、统一。
- **更易理解的生成过程**：优化生成中的 Reasoning、执行进度和工具活动呈现，让复杂 Coding 任务更容易跟随和掌控。
- **保留官方完整功能**：继续使用官方 `@deepseek-ai/dsh` 软件包，保留 Harness 原有的会话、工具和输入逻辑。
- **开箱即用**：正式安装包内置 Node、Harness 和运行依赖，无需单独安装 Node 或 npm。
- **兼容 Harness 生态**：保持对 Plugins、MCP、Skills 和工具生态的兼容。
- **多平台支持**：提供 macOS Apple Silicon、macOS Intel 和 Windows x64 版本。

## 当前版本：v1.0

DeepSeek Harness UX First 1.0 已正式发布。

v1.0 在保留 DeepSeek Harness 官方完整能力的基础上，重点优化了桌面端视觉体验，以及生成过程中的 Reasoning、执行进度和工具活动呈现，让复杂 Coding 任务更加清晰、自然、易于掌控。

| 平台 | 状态 |
| --- | --- |
| macOS Apple Silicon | v1.0 已发布 |
| macOS Intel | v1.0 已发布 |
| Windows x64 | v1.0 已发布 |

## 下载与安装

前往 [GitHub Releases](https://github.com/Jesse-Lai/DeepSeek-Harness-Desktop-UX-First/releases) 下载 v1.0：

- macOS Apple Silicon
- macOS Intel
- Windows x64

下载对应平台版本后即可直接运行，无需单独安装 Node、npm 或 DeepSeek Harness。

## 快速开始

1. 从 GitHub Releases 下载对应平台的 v1.0 安装包。
2. 解压或安装应用。
3. 启动 DeepSeek Harness UX First。
4. 按照界面指引完成配置并开始使用。

## 产品方向

DeepSeek Harness UX First 基于 DeepSeek Harness 打造，致力于提供媲美 Codex 的 Coding 产品使用体验。

在持续打磨视觉、交互、Reasoning 和任务执行体验的同时，项目也将基于 DeepSeek Harness 的插件理念进行产品创新：

- 探索插件驱动的 Coding 工作流
- 扩展 Plugins、MCP、Skills 和工具生态
- 创新复杂任务的进度、Reasoning 与活动呈现
- 持续提升桌面端 Coding Agent 的可用性和掌控感

## 与官方 DeepSeek Harness 的关系

本项目基于 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 构建，并使用固定版本的官方 `@deepseek-ai/dsh` npm 软件包，不复制或长期修改 Harness 官方源码。

官方项目提供 Agent 核心、会话、工具、模型接入、Web UI，以及 Plugins、MCP 和 Skills 生态。本项目主要负责：

- Electron 桌面应用封装
- 本地 Harness 服务的启动、停止与异常清理
- 桌面窗口和操作系统集成
- Node、Harness 与运行依赖的一体化打包
- macOS 与 Windows 安装包构建
- 基于插件机制的视觉、交互与 Reasoning 呈现优化

如果你希望使用命令行版本、了解 Harness 核心能力或参与上游开发，请优先访问官方仓库。

DeepSeek Harness UX First 是社区项目，与 DeepSeek 官方无隶属关系。

## 给开发者

与直接修改上游 Web UI 不同，本项目的体验增强本身就是一个 DSH 插件。桌面壳与 UI 插件沿用 DeepSeek Harness 的官方组合路径，在保持核心功能和生态兼容性的同时，对桌面端体验进行独立迭代。

当前的桌面 UI 插件位于 [`plugins/@jesse-lai/dsh-desktop-ui`](plugins/@jesse-lai/dsh-desktop-ui)，通过 Harness 配置树接入主题、布局、侧栏和会话界面，负责：

- 桌面端视觉样式和布局优化
- Reasoning、执行进度与工具活动呈现
- 插件的安装、启用与卸载
- 在不替换官方会话、工具和输入逻辑的前提下持续迭代交互

这种边界让上游 Harness 可以持续升级，也让桌面体验能够以插件方式独立演进。关于当前版本的启动与兼容性验证，可查看 [Intel Mac 验证记录](docs/validation/intel-mac.md) 和 [macOS MVP 验证记录](docs/validation/macos-mvp.md)。

## 本地开发

需要 Node.js 和 npm。克隆仓库后运行：

```bash
npm ci
npm test
npm start
```

`node_modules` 和 `dist` 仅保留在本机，不提交到 GitHub。

## 参与贡献

欢迎通过 Issues 提交问题、建议和产品想法，也欢迎通过 Pull Requests 参与功能、交互、插件和文档改进。

## 特别感谢

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 原始仓库与 DeepSeek AI 团队，为本项目提供 Agent 核心、工具、会话、Web UI 和插件生态。
- [Cordis](https://github.com/deepseek-ai/deepseek-harness/tree/main/vendor/cordis) 提供的插件化基础，让桌面能力和体验增强可以沿统一的组合路径实现。
- [Prompt Kit](https://github.com/ibelick/prompt-kit) 提供的交互与视觉模式参考，相关许可信息记录在 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
- [lucide-animated](https://github.com/pqoqubbw/icons) 提供的图标资源，让桌面界面在导航、命令和状态表达上保持统一、清晰的视觉语言，相关许可信息记录在 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
- 所有参与讨论、测试、反馈、贡献，以及持续使用和支持本项目的社区成员。

## License

本项目采用 MIT License。第三方依赖和相关许可信息请参阅 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
