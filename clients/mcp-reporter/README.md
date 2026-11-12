# MCP Reporter Client

一个通过 stdio 运行的 TypeScript MCP 服务。每个 Agent 启动一个专属 MCP 子进程；该进程启动时自动向平台配对，并在内存中保存设备 Token。Agent 只需调用上报工具。

## 安装

```powershell
cd clients/mcp-reporter
npm install
npm run build
```

平台服务需已启动：

```powershell
..\..\platform\scripts\start.ps1
```

## MCP 配置示例（Windows）

将以下配置加入 MCP 客户端配置。请将路径替换为本机实际绝对路径：

```json
{
  "mcpServers": {
    "agent-reporter": {
      "command": "C:\\Users\\phx10\\tools\\node-v22.19.0-win-x64\\node.exe",
      "args": [
        "C:\\Users\\phx10\\code\\bot-dashboard\\clients\\mcp-reporter\\dist\\index.js"
      ],
      "env": {
        "ACP_API_URL": "http://localhost:3000/v1",
        "ACP_DEVICE_NAME": "Codex-Research-Agent"
      }
    }
  }
}
```

`ACP_DEVICE_NAME` 可选；未提供时会自动使用 `mcp-主机名-进程号`。MCP 进程启动时会自动配对，Token 仅存在于该进程内存中；进程重启会创建新的配对设备。

## 工具

- `report_progress(...)`：上报节点。相同 `trace` 属于同一汇报链；传入之前返回的 `parentNodeId` 可连接或分叉节点。

`report_progress` 会在 MCP 进程内保留每一次成功上报返回的节点 ID 与摘要。第一个上报可不传 `parentNodeId`；之后每次调用必须传入已保留的 `parentNodeId`，且必须属于相同 `trace`。漏传或传入未知 ID 时，工具会返回错误和全部已保留节点列表，便于 Agent 纠正调用。
