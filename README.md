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

## 阶段

### 1. 验证官方 npm 包

- 安装固定版本的官方包。
- 运行 `dsh web`。
- 验证启动、Web UI 和正常退出。
- 完成后暂停并汇报结果。

### 2. 开发 macOS MVP

- 创建 Electron 桌面外壳。
- 在 App 内启动 Harness。
- 显示官方 Harness Web UI。
- 处理启动失败和退出清理。

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
