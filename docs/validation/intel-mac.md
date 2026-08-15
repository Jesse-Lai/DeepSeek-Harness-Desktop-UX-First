# Intel Mac 官方包验证记录

## 环境

- 架构：`x86_64`
- macOS：26.5.1（25F80）
- Node.js：22.22.1
- npm：10.9.4
- Harness：`@deepseek-ai/dsh@0.1.0-rc.6`

## 验证结果

- 官方包及 531 个依赖安装成功。
- npm audit 报告 0 个已知漏洞。
- `dsh --version` 正确返回 `0.1.0-rc.6`。
- `dsh web --help` 正常显示 `--host`、`--port` 和 `--trusted-host` 参数。
- `dsh web --host 127.0.0.1 --port 0` 成功启动，并由操作系统分配空闲端口。
- Web 根路径返回 HTTP 200 和完整的官方 DeepSeek Harness 前端。
- 浏览器成功渲染会话、工作区、设置和首次启动提示，控制台无错误或警告。
- 测试服务退出后，本地监听端口已释放。

## 对桌面 MVP 的约束

- Electron 应使用 `--host 127.0.0.1 --port 0`，从标准输出解析实际端口，避免固定端口冲突。
- 必须将 `DSH_HOME` 指向 Electron 的用户数据目录，不能依赖开发者机器上的 `~/.dsh`。
- Electron 退出时应先向 Harness 子进程发送 `SIGTERM`，等待最多 5 秒，再执行强制清理。
- 应保持工作目录为用户选定的 workspace，以延续 Harness 的 workspace 语义。
- 应直接加载官方 Web UI，不复制或修改 Harness 前端源码。
