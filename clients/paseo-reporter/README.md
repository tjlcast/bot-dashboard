# Paseo Reporter Plugin

将 Paseo Agent 的成功文本回复自动上报到 Agent Control Plane。插件直接使用 Paseo 的 `agent.id` 作为平台 `sessionId` 和 trace 标识；不依赖 MCP 或底层 Agent 提供额外身份。

## 前置条件

- Paseo daemon / Desktop `0.14.0` 或更高版本。
- 本仓库的 Agent Control Plane 服务可访问。
- Node.js 与 npm（仅用于插件依赖安装和类型检查）。

## 快速安装（Windows）

### 1. 启动平台服务

默认地址为 `http://localhost:3000/v1`，因此本地开发不需要配置 `ACP_API_URL`：

```powershell
cd ~\code\bot-dashboard\platform
.\scripts\start.ps1
```

浏览器打开 `http://localhost:3000` 可确认平台服务已启动。

### 2. 安装插件依赖并检查

```powershell
cd ~\code\bot-dashboard\clients\paseo-reporter
npm install
npm run check
```

### 3. 安装到 Paseo daemon

优先使用 Paseo Desktop 自带的 CLI。某些 Windows 环境中 PATH 内的 `paseo` 是 GUI 程序，不会正确执行 plugin 子命令。

```powershell
& "$env:LOCALAPPDATA\Programs\Paseo\resources\bin\paseo.cmd" plugin install .
```

如果你已正确将 Paseo CLI 配入 PATH，也可以在插件目录直接执行：

```powershell
paseo plugin install .
```

### 4. 验证运行状态

```powershell
& "$env:LOCALAPPDATA\Programs\Paseo\resources\bin\paseo.cmd" plugin ls

& "$env:LOCALAPPDATA\Programs\Paseo\resources\bin\paseo.cmd" plugin logs paseo-reporter
```

看到 `paseo-reporter` 的状态为 `running`、`enabled`，且日志含 `Plugin ready`，即安装完成。

之后在 Paseo 中让任意 Agent 完成一次带文本的回复；刷新 Agent Control Plane 页面，应能看到对应上报。

## 默认配置与可选配置

默认无需设置环境变量：

| 配置 | 默认值 | 用途 |
| --- | --- | --- |
| `ACP_API_URL` | `http://localhost:3000/v1` | Agent Control Plane API 地址 |
| `ACP_DEVICE_NAME` | `paseo-<hostname>` | 首次自动配对时在平台中显示的设备名 |
| `ACP_DEVICE_TOKEN` | 无 | 已有设备 token；配置后跳过自动配对 |
| `ACP_PASEO_REPORTER_STATE_PATH` | 见下文 | 覆盖插件本地状态文件位置 |

例如平台部署到其他机器时，需将 `ACP_API_URL` 配置给**运行 Paseo daemon 的进程**，然后重启或重载插件。桌面应用从开始菜单启动时，不会继承当前 PowerShell 的 `$env:` 临时变量。

## 身份、持久化与安全

未设置 `ACP_DEVICE_TOKEN` 时，插件在首次上报前调用 `/devices/pair` 自动创建平台设备。它将以下内容保存到本地状态文件：

- `deviceId` 和 device token；
- 未发送成功的上报 outbox；
- Paseo `messageId -> 平台 nodeId` 映射，用于恢复链路与回退分支。

默认状态文件位置：

```text
$PASEO_HOME/plugins/paseo-reporter/state.json
```

未设置 `PASEO_HOME` 时为：

```text
~/.paseo/plugins/paseo-reporter/state.json
```

状态文件包含访问 token；应只允许运行 Paseo daemon 的用户读取。不要将它提交到版本控制或发送给他人。

## 上报与链路行为

- 仅在 `agent.turn.after` 且结果为 `completed` 时上报；失败或取消的回合跳过。
- 只上报 assistant 的文本回复；纯工具调用或空文本不会创建空节点。
- 同时提取触发该回复的最近一条用户消息，并写入平台节点的“输入 / 上下文”字段。
- 同一个 Paseo Agent 使用相同的 `agent.id` 作为 `sessionId` 与 `localTraceSeq`，所以显示在同一条 trace 中。
- 上报优先以 `messageId` 作为幂等标识；若 provider 未提供则退回使用 `turnId`。
- 成功上报后会保存 `messageId -> nodeId`。下一条回复会从当前 Paseo timeline 找到其前一条 assistant 消息，并将对应平台节点作为 `parentNodeId`，组成链。
- 若在 Paseo 回退到历史消息，已丢弃分支不会出现在当前 timeline；新回复会接到回退点的历史节点，形成新分支，而不会错误连接到旧分支的末尾。
- 网络或平台暂时不可用时，事件先写入本地 outbox；插件每分钟及下一次成功回合时重试。

如果某条历史消息发生在插件安装前，尚未建立 `messageId -> nodeId` 映射，插件会安全地创建根节点，而不是猜测父节点。

## 更新与重载

修改插件源码后先检查，再重载已安装插件：

```powershell
cd ~\code\bot-dashboard\clients\paseo-reporter
npm install
npm run check
& "$env:LOCALAPPDATA\Programs\Paseo\resources\bin\paseo.cmd" plugin reload paseo-reporter
```

重载后用 `plugin logs paseo-reporter` 确认出现新的 `Plugin ready` 记录。

## 卸载

```powershell
& "$env:LOCALAPPDATA\Programs\Paseo\resources\bin\paseo.cmd" plugin remove paseo-reporter
```

卸载不会保证删除状态文件。如需同时废除本机保存的 token 与上报队列，手动删除上述 `state.json`；删除后再次安装并上报时会创建新的平台设备身份。

## 排查

| 现象 | 检查方式 |
| --- | --- |
| 插件未显示或不是 `running` | 执行 `plugin ls` 与 `plugin logs paseo-reporter` |
| 平台没有新节点 | 确认平台服务已启动；在 Paseo 中发送一条会产生文本回复的新消息；查看插件日志 |
| 提示无法连接平台 | 检查默认地址 `http://localhost:3000/v1`，或为 daemon 正确配置 `ACP_API_URL` |
| 重启后出现新的平台设备 | 检查 `state.json` 是否被删除、不可写或由另一用户运行 Paseo |
| 回退后无法连接到旧节点 | 该回退点可能生成于插件安装前，或当时上报未成功；插件会创建安全根节点 |
