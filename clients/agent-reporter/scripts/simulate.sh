#!/usr/bin/env bash
set -euo pipefail

API_URL="${ACP_API_URL:-http://localhost:3000/v1}"
DELAY="${DELAY_SECONDS:-1}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
CLI="$CLIENT_ROOT/node_modules/.bin/tsx"

[[ -x "$CLI" ]] || { echo "Install dependencies first: cd $CLIENT_ROOT && npm install" >&2; exit 1; }
export ACP_API_URL="$API_URL"
pair="$($CLI "$CLIENT_ROOT/src/index.ts" pair --name Simulated-Codex-Agent)"
export ACP_DEVICE_TOKEN="$(node -e 'process.stdin.on("data", d => console.log(JSON.parse(d).token))' <<< "$pair")"
common=(--app codex --session simulated-session-001 --trace platform-v1-validation --trace-title "平台 V1 验证汇报")
report() { "$CLI" "$CLIENT_ROOT/src/index.ts" report "${common[@]}" "$@"; }
node_id() { node -e 'process.stdin.on("data", d => console.log(JSON.parse(d).nodeId))'; }

root="$(report --type checkpoint --title "开始平台 V1 验证" --detail "Agent 已连接平台，准备执行验证流程。" | node_id)"; sleep "$DELAY"
analysis="$(report --parent "$root" --type report --title "完成 API 连通性验证" --detail "配对、鉴权与节点上报接口均正常响应。" | node_id)"; sleep "$DELAY"
ui="$(report --parent "$analysis" --type report --title "完成工作台展示检查" --detail "右侧链列表和主画板均已显示本次上报。" | node_id)"; sleep "$DELAY"
report --parent "$analysis" --type blocked --title "需要确认验证结论" --detail "请确认是否将模拟流程标记为完成。" >/dev/null; sleep "$DELAY"
report --parent "$ui" --type decision --title "自动化验证结论已生成" --detail "主链完成，同时保留待人工确认分支。"
echo "Simulation complete."
