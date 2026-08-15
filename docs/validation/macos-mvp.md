# Intel Mac 桌面 MVP 验证记录

## 环境

- 架构：`x86_64`
- macOS：26.5.1（25F80）
- Node.js：22.22.1
- Electron：43.4.0
- Harness：`@deepseek-ai/dsh@0.1.0-rc.6`

## 实现

- Electron 使用隔离渲染器：`nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`。
- Harness 仅监听 `127.0.0.1`，端口由操作系统动态分配。
- `DSH_HOME` 和 workspace 位于 Electron 用户数据目录，避免依赖开发机全局配置。
- Electron 内置 Node 通过 `ELECTRON_RUN_AS_NODE=1` 启动官方 CLI，并传入官方 HMR 所需的
  `--expose-internals`。
- 识别启动 URL 后继续探测首页，只有 HTTP 页面可访问才向窗口加载。
- 外部网页交给系统浏览器打开，应用窗口只允许停留在 Harness 本地源。
- 正常退出先发送 `SIGTERM`，超时后使用 `SIGKILL`；启动取消和异常退出均有独立处理。

## 验证结果

- 8 项单元测试全部通过，覆盖 URL 解析、启动参数、启动失败、HTTP 就绪等待、异常退出、
  启动取消竞态和强制清理。
- Electron 冒烟验证通过：Harness 根路径返回成功，页面标题为 `DeepSeek Harness`。
- 可见窗口成功显示官方 DeepSeek Harness Web UI 和首次启动 API Key 提示。
- 正常退出返回状态 0；退出后临时 Electron 二进制无进程占用，Harness 子进程已清理。

## 阶段结论

macOS Intel MVP 已达到阶段 2 目标。下一阶段将制作完整安装包，并在干净环境验证用户无需安装
Node、npm 或其他开发工具即可双击运行。
