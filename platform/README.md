# Agent Control Plane · V1

单用户 Agent 工作流控制面：聚合多设备、多 App 的汇报链，优先呈现需要人工介入的事项。

## 本地启动

```bash
npm install
npm run dev
```

打开 `http://localhost:3000`。首次启动会在 `data/agent-control-plane.db` 创建 SQLite 数据库。

默认启动为空数据库。如需本地演示数据，可设置 `SEED_DEMO=true` 后启动一次。

## 服务脚本

启动与停止脚本会识别本平台的 `server/index.js` 进程，不影响其他 Node 服务：

```powershell
.\scripts\start.ps1
.\scripts\stop.ps1
```

```bash
./scripts/start.sh
./scripts/stop.sh
```

## API 概览

- `POST /v1/reports`：设备/Agent 上报节点（需要 Bearer device token 与 `Idempotency-Key`）
- `GET /v1/traces`、`GET /v1/traces/:id/nodes`、`GET /v1/nodes/:id`
- `GET /v1/inbox?status=pending`、`POST /v1/nodes/:id/interventions`
- `GET /v1/devices`、`POST /v1/devices/pair`、`GET /v1/events`（SSE）
- `GET /v1/settings/scene`、`PUT /v1/settings/scene`：场景配置（HBrain url、apiKey、用户名字、信息 Sink 开关）
- `GET /v1/settings/sink-stats?windowMinutes=60`：最近一次发送时间与窗口内成功/失败数量

设置菜单左下角可编辑场景配置。开启信息 Sink 后，每收到一条新汇报，服务端会向 `{url}/v1/messages/add` 发送 POST 请求；`user_id` 取用户名字，`session_id` 取汇报会话；`messages` 中 `role=user` 的 `content` 为汇报的「输入 / 上下文」纯文本，`role=assistant` 的 `content` 为汇报的「内容」纯文本。Sink 板块展示最近一次发送时间，并可在 1 小时 / 24 小时 / 7 天窗口间切换查看成功与失败数；发送日志仅保留 7 天。

演示设备 token：`dev_mac_token`。
