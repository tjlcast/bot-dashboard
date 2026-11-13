# WorkBuddy Reporter Plugin

WorkBuddy 原生 Hook：每次 AI 正常结束回复时，`Stop` hook 读取当前会话 transcript，提取本轮的用户输入和 assistant text，并将它上报至 Agent Control Plane。

WorkBuddy hook 输入中的 `session_id` 直接作为平台的 `sessionId` 与 `localTraceSeq`；上报应用固定为 `workbuddy`。本轮用户文本写入平台的 `input`，assistant 文本写入 `detail` 与 `conclusion`。

## 安装

在 WorkBuddy 的插件管理中添加本目录，或使用 WorkBuddy/CodeBuddy CLI 安装本地插件目录。插件根目录必须是本目录，清单位于 `.codebuddy-plugin/plugin.json`。

插件没有 npm 依赖；WorkBuddy 所在环境需要 Node.js 18 或更高版本（提供 `fetch`）。如果通过用户级 Hook 目录手动安装，请将 `scripts/report.mjs` 复制到 `~/.workbuddy/hooks/`，再在 `~/.workbuddy/settings.json` 注册 `Stop` command hook；命令需指向该脚本的绝对路径。

将以下片段合并到 `~/.workbuddy/settings.json` 的 `hooks` 字段（将路径替换为实际位置）：

```json
{
  "Stop": [
    {
      "hooks": [
        {
          "type": "command",
          "command": "node \"C:\\Users\\<username>\\.workbuddy\\hooks\\workbuddy-reporter.mjs\"",
          "timeout": 15
        }
      ]
    }
  ]
}
```

不要覆盖已有的 `hooks` 配置；只在其中增加 `Stop` 项。修改后重启 WorkBuddy 或新开会话。

## 配置

```powershell
$env:ACP_API_URL = 'http://localhost:3000/v1'
$env:ACP_DEVICE_TOKEN = '<existing-device-token>'
$env:ACP_DEVICE_NAME = 'my-workbuddy-device'
```

`ACP_DEVICE_TOKEN` 可选。未提供时，首次上报会自动创建平台设备配对。凭据与待重试上报默认存放于 WorkBuddy 的插件数据目录（`CODEBUDDY_PLUGIN_DATA`）；若该变量不存在，则存放于 `~/.workbuddy/plugins/workbuddy-reporter/state.json`。可用 `ACP_WORKBUDDY_REPORTER_STATE_PATH` 显式覆盖。

## 行为

- 仅由 `Stop` hook 触发，失败或取消的轮次不会走该 hook。
- 从 stdin 获取 `session_id` 和 `transcript_path`，使用前者作为会话 ID。
- 只提取最近一条用户消息中的 `<user_query>`（没有系统上下文标记时回退为 `input_text`）和其后的 assistant `output_text`；不上传工具调用、推理或 WorkBuddy 注入的系统上下文。
- 空文本不会上报。
- 使用 session ID 加 assistant message ID（缺失时为文本哈希）生成幂等键。
- 成功上报后持久化 `assistant messageId → 平台 nodeId` 映射；下一轮使用其用户记录的 `parentId`（支持历史编辑后重新发送）查找父节点，并作为 `parentNodeId` 上报，因此分支会正确接回被编辑消息之前的 assistant 节点。
- 网络不可用时将事件保存到本地 outbox；每次后续成功回复都会先尝试发送待处理事件。
