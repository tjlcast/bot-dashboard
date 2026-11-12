# Agent Reporter Client

用于将 Agent 的进度上报到 Agent Control Plane 的 TypeScript 命令行工具。

```powershell
cd clients/agent-reporter
npm install
```

先启动平台服务：

```powershell
..\..\platform\scripts\start.ps1
```

## 手动上报

先配对，命令会返回设备 token：

```powershell
npm run cli -- pair --name "My Codex Agent"
```

设置 token 后上报一个节点：

```powershell
$env:ACP_DEVICE_TOKEN = "<pair 返回的 token>"
npm run cli -- report --app codex --session session-1 --trace task-1 --type report --title "开始任务"
```

## 模拟连续汇报

模拟脚本会自动配对，并每秒调用一次 TypeScript CLI，产生 5 个节点（含一个 blocked 分叉）：

```powershell
.\scripts\simulate.ps1
```

Linux/macOS：

```bash
./scripts/simulate.sh
```

可通过 `ACP_API_URL`（或 PowerShell 的 `-ApiUrl`）指定非默认 API 地址。
