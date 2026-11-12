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

演示设备 token：`dev_mac_token`。
