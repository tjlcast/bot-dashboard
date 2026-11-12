# Paseo Reporter Plugin

Paseo daemon 插件：每次 Agent 成功完成一个回合后，提取该回合最后一条用户消息之后的文本输出，并上报到 Agent Control Plane。

`agent.id` 直接作为平台的 `sessionId` 和 trace 标识，因此不依赖 MCP 或底层 Agent 提供额外的 ID。

## 安装

需要 Paseo `0.14.0` 或更高版本，以及可访问的 Agent Control Plane API。

```powershell
cd clients/paseo-reporter
npm install
npm run check
paseo plugin install .
```

可通过环境变量配置平台地址和已有设备 token：

```powershell
$env:ACP_API_URL = 'http://localhost:3000/v1'
$env:ACP_DEVICE_TOKEN = '<existing-device-token>'
```

未配置 `ACP_DEVICE_TOKEN` 时，插件第一次成功上报前会自动配对，并将 device token 与未成功上报的事件保存到：

`$PASEO_HOME/plugins/paseo-reporter/state.json`

未设置 `PASEO_HOME` 时，默认位置为 `~/.paseo/plugins/paseo-reporter/state.json`。可用 `ACP_PASEO_REPORTER_STATE_PATH` 覆盖。这个文件包含访问 token，必须仅允许运行 Paseo daemon 的账户读取。

## 上报行为

- 仅处理 `agent.turn.after` 中 `outcome.kind === 'completed'` 的回合；失败或取消的回合不会上报。
- 纯工具调用或没有文本的回合不会创建空节点。
- 优先使用 Paseo 的 `messageId`（缺失时回退到 `turnId`）生成幂等键；网络异常时事件先写入本地 outbox，之后每分钟和下一次成功回合时重试。
- 同一个 Paseo Agent 的回复使用同一个 `agent.id` 作为 `sessionId` 与 `localTraceSeq`，因而聚合到同一条 trace。插件还会保存 `messageId -> 平台 nodeId` 的映射，并将当前 timeline 中紧邻的前一条 assistant 消息作为 `parentNodeId`。
- 在 Paseo 回退到历史消息后，回退丢弃的消息不再位于当前 timeline。后续回复因此接到该回退点的历史节点，形成新分支，而不会错误接到旧分支末尾。

`ACP_DEVICE_NAME` 可选，用于首次自动配对时显示的设备名；默认值为 `paseo-<hostname>`。
