# Bot Dashboard Workspace

该仓库按产品边界收纳代码：

```text
platform/       # Agent Control Plane 平台服务与 Dashboard
clients/        # 后续接入端（Watcher、MCP、CLI 等）
需求/            # 产品需求讨论
平台设计/        # 交互与技术设计
```

## 平台工程

进入 `platform/` 后安装并运行：

```bash
cd platform
npm install
npm start
```

启动与停止脚本位于 `platform/scripts/`。
