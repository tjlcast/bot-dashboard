# WorkBuddy Reporter Hook

`workbuddy-reporter` 是一个 WorkBuddy 用户级 `Stop` Hook。每次 AI 正常结束一轮回复时，它会从 WorkBuddy transcript 中读取：

- 当前 `session_id`；
- 本轮用户输入；
- 本轮 assistant 的纯文本回复；
- 用户消息的 `parentId`，用于支持编辑历史消息后重新发送的分支链路。

随后它将内容上报到 Agent Control Plane。它不是 Skill、MCP 服务，也不是通过 WorkBuddy 插件市场安装的插件包；无需 npm 安装依赖。

## 前提条件

- Windows 上已安装并可以启动 WorkBuddy；
- Node.js 18 或更高版本已安装，PowerShell 中 `node --version` 可用；
- Agent Control Plane 已启动。默认地址为 `http://localhost:3000/v1`。

## 安装

以下命令以当前 Windows 用户 `phx10` 为例。将 `<用户名>` 替换为实际 Windows 用户名。

### 1. 创建 Hook 目录并复制脚本

在 PowerShell 执行：

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.workbuddy\hooks"
Copy-Item `
  "C:\Users\<用户名>\code\bot-dashboard\clients\workbuddy-reporter\scripts\report.mjs" `
  "$env:USERPROFILE\.workbuddy\hooks\workbuddy-reporter.mjs"
```

安装后的脚本位置应为：

```text
C:\Users\<用户名>\.workbuddy\hooks\workbuddy-reporter.mjs
```

### 2. 注册 `Stop` Hook

打开：

```text
C:\Users\<用户名>\.workbuddy\settings.json
```

在根对象中添加或合并 `hooks.Stop`。如果没有现有的 `hooks` 字段，可添加：

```json
"hooks": {
  "Stop": [
    {
      "hooks": [
        {
          "type": "command",
          "command": "node \"C:\\Users\\<用户名>\\.workbuddy\\hooks\\workbuddy-reporter.mjs\"",
          "timeout": 15
        }
      ]
    }
  ]
}
```

JSON 的根对象内各字段之间需要逗号。例如在已有字段后添加 `hooks` 时，应保留前一字段末尾的逗号。

如果已有 `hooks` 或 `Stop` 配置，**不要覆盖它们**；只把上述 command hook 追加进现有的 `Stop` 数组。

### 3. 配置平台地址或设备 token（可选）

默认上报到本机平台：

```text
http://localhost:3000/v1
```

需要自定义地址或复用已有设备 token 时，在启动 WorkBuddy 前的 PowerShell 中设置：

```powershell
$env:ACP_API_URL = 'http://localhost:3000/v1'
$env:ACP_DEVICE_TOKEN = '<已有的平台 device token>'
$env:ACP_DEVICE_NAME = 'my-workbuddy-device'
```

未设置 `ACP_DEVICE_TOKEN` 时，第一次成功上报会自动向平台配对并保存 token。

### 4. 重启并验证

1. 完全退出 WorkBuddy，再重新打开；
2. 发送一条消息，并等待 AI 正常完成文本回复；
3. 在平台工作台检查新节点：`app` 应为 `workbuddy`，并能看到 session、用户输入与 AI 回复；
4. 在同一会话再发送一条消息，后续节点应连接到前一节点；编辑历史消息并重新发送时，新节点应从被编辑消息之前的 assistant 节点分支。

## 本地状态与重试

默认状态文件为：

```text
C:\Users\<用户名>\.workbuddy\plugins\workbuddy-reporter\state.json
```

它包含设备 token、网络失败时待重试的上报，以及 `assistant messageId → 平台 nodeId` 映射。不要共享此文件。网络不可用时，Hook 不会干扰 WorkBuddy 回复；事件留在 outbox，并在下一次正常回复时重试。

可通过 `ACP_WORKBUDDY_REPORTER_STATE_PATH` 覆盖此位置。

## 升级

修改仓库中的 `scripts/report.mjs` 后，重新执行安装步骤 1 的复制命令覆盖已安装脚本，然后重启 WorkBuddy。已有状态文件会保留，因此映射和待重试事件不会丢失。

## 卸载

### 1. 从 settings 中移除本 Hook

编辑：

```text
C:\Users\<用户名>\.workbuddy\settings.json
```

只删除 `hooks.Stop` 数组中 command 为以下值的对象：

```text
node "C:\Users\<用户名>\.workbuddy\hooks\workbuddy-reporter.mjs"
```

如果它是 `Stop` 数组中的唯一对象，可删除整个 `Stop` 字段；若 `hooks` 也随之为空，可删除整个 `hooks` 字段。不要删除其他 Hook。

### 2. 删除安装脚本

确认 settings 已保存后执行：

```powershell
Remove-Item -LiteralPath "$env:USERPROFILE\.workbuddy\hooks\workbuddy-reporter.mjs"
```

### 3. 删除凭据与本地状态（可选）

若不再需要重试历史事件、设备 token 或本地消息映射，可删除：

```powershell
Remove-Item -LiteralPath "$env:USERPROFILE\.workbuddy\plugins\workbuddy-reporter\state.json"
```

这不会删除平台中已上报的节点，也不会撤销已经创建的设备配对；如需在平台侧撤销设备访问，应在平台中单独处理。

### 4. 重启 WorkBuddy

完全退出并重新打开 WorkBuddy，确保已经移除的 Hook 不再被加载。

## 故障排查

- PowerShell 找不到 `node`：安装 Node.js，或将 Node.js 所在目录加入 `PATH` 后重启 WorkBuddy。
- 平台没有节点：确认平台服务正在监听 `ACP_API_URL`，并检查上述 `state.json` 中是否有 `pending` 项。
- Hook 触发但没有文本节点：仅 assistant `output_text` 会上报；工具调用、推理或空回复会被忽略。
- 编辑重发未成分支：被编辑消息之前的 assistant 回复必须已在本机 state 文件中留下 `messageId → nodeId` 映射。若该回复发生在安装 Hook 前，会安全地成为根节点，之后的新回复会建立映射。
