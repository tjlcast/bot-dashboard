import { randomUUID } from 'node:crypto';

type Args = Record<string, string | boolean>;

const apiBase = (process.env.ACP_API_URL ?? 'http://localhost:3000/v1').replace(/\/$/, '');

function parseArgs(argv: string[]): { command?: string; args: Args } {
  const [command, ...rest] = argv;
  const args: Args = {};
  for (let i = 0; i < rest.length; i += 1) {
    const item = rest[i];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const value = rest[i + 1];
    if (!value || value.startsWith('--')) args[key] = true;
    else { args[key] = value; i += 1; }
  }
  return { command, args };
}

function stringArg(args: Args, key: string, required = false): string | undefined {
  const value = args[key];
  if (required && (typeof value !== 'string' || !value.trim())) throw new Error(`缺少必填参数 --${key}`);
  return typeof value === 'string' ? value : undefined;
}

async function request(path: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(`${apiBase}${path}`, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: { message?: string } }).error?.message ?? `请求失败 (${response.status})`);
  return body;
}

async function pair(args: Args) {
  const name = stringArg(args, 'name', true);
  return request('/devices/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
}

async function report(args: Args) {
  const token = stringArg(args, 'token') ?? process.env.ACP_DEVICE_TOKEN;
  if (!token) throw new Error('请提供 --token 或设置 ACP_DEVICE_TOKEN');
  const nodeType = stringArg(args, 'type', true);
  if (!['report', 'blocked', 'decision', 'checkpoint'].includes(nodeType!)) throw new Error('--type 必须是 report、blocked、decision 或 checkpoint');
  const body = {
    app: stringArg(args, 'app', true),
    sessionId: stringArg(args, 'session', true),
    localTraceSeq: stringArg(args, 'trace', true),
    traceTitle: stringArg(args, 'trace-title'),
    parentNodeId: stringArg(args, 'parent'),
    nodeType,
    title: stringArg(args, 'title', true),
    detail: stringArg(args, 'detail') ?? '',
    input: stringArg(args, 'input'),
    conclusion: stringArg(args, 'conclusion'),
    sourceUrl: stringArg(args, 'source-url'),
    occurredAt: stringArg(args, 'occurred-at') ?? new Date().toISOString()
  };
  return request('/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Idempotency-Key': randomUUID() },
    body: JSON.stringify(body)
  });
}

function help() {
  console.log(`Agent Reporter CLI

配对：
  tsx src/index.ts pair --name "My Agent"

上报：
  ACP_DEVICE_TOKEN=<token> tsx src/index.ts report --app codex --session session-1 --trace task-1 --type report --title "开始任务"

可选参数：--parent --trace-title --detail --input --conclusion --source-url --occurred-at --token`);
}

async function main() {
  const { command, args } = parseArgs(process.argv.slice(2));
  if (command === 'pair') console.log(JSON.stringify(await pair(args)));
  else if (command === 'report') console.log(JSON.stringify(await report(args)));
  else help();
}

main().catch((error: Error) => { console.error(`错误：${error.message}`); process.exitCode = 1; });
