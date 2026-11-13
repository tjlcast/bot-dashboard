import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const dataDir = join(root, 'data');
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
const db = new Database(join(dataDir, 'agent-control-plane.db'));
db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON'); db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL, state TEXT NOT NULL DEFAULT 'online', last_seen_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS traces (id TEXT PRIMARY KEY, title TEXT NOT NULL, source_summary TEXT NOT NULL, created_at TEXT NOT NULL, last_activity_at TEXT NOT NULL, pending_count INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS nodes (id TEXT PRIMARY KEY, trace_id TEXT NOT NULL REFERENCES traces(id), parent_node_id TEXT REFERENCES nodes(id), node_type TEXT NOT NULL, status TEXT NOT NULL, device_id TEXT NOT NULL REFERENCES devices(id), app TEXT NOT NULL, session_id TEXT NOT NULL, occurred_at TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL, input TEXT, conclusion TEXT, source_url TEXT);
CREATE TABLE IF NOT EXISTS interventions (id TEXT PRIMARY KEY, node_id TEXT NOT NULL REFERENCES nodes(id), body TEXT NOT NULL, status TEXT NOT NULL, sent_at TEXT NOT NULL, replied_at TEXT);
CREATE TABLE IF NOT EXISTS idempotency_keys (token_hash TEXT NOT NULL, key TEXT NOT NULL, response_json TEXT NOT NULL, expires_at TEXT NOT NULL, PRIMARY KEY(token_hash, key));
CREATE TABLE IF NOT EXISTS event_log (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_trace_activity ON traces(last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_node_trace ON nodes(trace_id, occurred_at ASC);
CREATE INDEX IF NOT EXISTS idx_node_parent ON nodes(parent_node_id);
`);
// Existing reports establish the initial read baseline on upgrade.
let addedTraceViewColumn = false;
try { db.exec('ALTER TABLE traces ADD COLUMN last_viewed_at TEXT'); addedTraceViewColumn = true; } catch (error) {
  if (!String(error.message).includes('duplicate column name')) throw error;
}
if (addedTraceViewColumn) db.prepare('UPDATE traces SET last_viewed_at=last_activity_at WHERE last_viewed_at IS NULL').run();
try { db.exec('ALTER TABLE traces ADD COLUMN name TEXT'); } catch (error) {
  if (!String(error.message).includes('duplicate column name')) throw error;
}
// Backfill legacy/default titles from each chain's first report without
// overwriting a name that was explicitly changed by the user.
db.prepare(`UPDATE traces
  SET name=COALESCE(
    NULLIF(trim((SELECT input FROM nodes WHERE trace_id=traces.id ORDER BY occurred_at LIMIT 1)), ''),
    NULLIF(trim((SELECT detail FROM nodes WHERE trace_id=traces.id ORDER BY occurred_at LIMIT 1)), ''),
    title
  )
  WHERE name IS NULL OR trim(name)='' OR name=title`).run();

const now = () => new Date().toISOString();
const hash = (text) => createHash('sha256').update(text).digest('hex');
const shortHash = (text) => hash(text).slice(0, 20);
const clients = new Set();
function emit(type, payload) {
  const createdAt = now();
  const event = db.prepare('INSERT INTO event_log(type,payload_json,created_at) VALUES(?,?,?)').run(type, JSON.stringify(payload), createdAt);
  const message = `id: ${event.lastInsertRowid}\nevent: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const reply of clients) reply.raw.write(message);
}
function refreshTrace(traceId) {
  const row = db.prepare(`SELECT MAX(occurred_at) AS latest, SUM(CASE WHEN status='blocked' THEN 1 ELSE 0 END) AS pending FROM nodes WHERE trace_id=?`).get(traceId);
  db.prepare('UPDATE traces SET last_activity_at=?, pending_count=? WHERE id=?').run(row.latest, row.pending || 0, traceId);
}
function seed() {
  if (db.prepare('SELECT COUNT(*) AS c FROM devices').get().c) return;
  const at = now();
  const addDevice = db.prepare('INSERT INTO devices VALUES(?,?,?,?,?,?)');
  addDevice.run('macbook-pro', 'MacBook Pro', hash('dev_mac_token'), 'online', at, at);
  addDevice.run('workstation-win', 'Windows Workstation', hash('dev_windows_token'), 'online', at, at);
  addDevice.run('mac-mini', 'Mac mini', hash('dev_mini_token'), 'offline', '2026-11-12T01:15:00.000Z', at);
  const addTrace = db.prepare('INSERT INTO traces(id,title,name,source_summary,created_at,last_activity_at,pending_count,last_viewed_at) VALUES(?,?,?,?,?,?,?,?)');
  const addNode = db.prepare('INSERT INTO nodes VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const records = [
    ['trace-launch', '发布营销站', 'MacBook Pro · Codex', '2026-11-12T01:20:00.000Z', [
      ['launch-01', null, 'report', 'completed', 'macbook-pro', 'codex', 'session-marketing', '2026-11-12T01:20:00.000Z', '梳理发布范围', '已拆分信息架构、视觉方向和验收清单。', '发布一个支持产品叙事与转化的营销站。', '先确认主色，再进入高保真实现。', 'codex://session/session-marketing'],
      ['launch-02', 'launch-01', 'decision', 'completed', 'macbook-pro', 'codex', 'session-marketing', '2026-11-12T01:43:00.000Z', '信息架构已确认', '首页、案例与价格页结构已经形成。', '目标访客为产品负责人和技术团队。', '推荐简约产品叙事，突出任务链可视化。', 'codex://session/session-marketing'],
      ['launch-03', 'launch-02', 'report', 'completed', 'macbook-pro', 'codex', 'session-marketing', '2026-11-12T02:05:00.000Z', '完成桌面端布局', '主画板、右侧链列表及详情抽屉布局完成。', '沿用已确认的信息架构。', '等待视觉方向最终确认。', 'codex://session/session-marketing'],
      ['launch-04', 'launch-02', 'blocked', 'blocked', 'macbook-pro', 'codex', 'session-marketing', '2026-11-12T02:06:00.000Z', '确认品牌主色', '需要选择视觉方向后继续完成组件和插图。', '请在冷静蓝和暖橙中选择。', '等待你的选择后继续。', 'codex://session/session-marketing']
    ]],
    ['trace-api', 'API 错误排查', 'Windows Workstation · WorkBuddy', '2026-11-12T01:58:00.000Z', [
      ['api-01', null, 'checkpoint', 'completed', 'workstation-win', 'workbuddy', 'session-api', '2026-11-12T01:58:00.000Z', '开始复现生产环境超时', '本地环境无法稳定复现。', '支付 API 在生产环境偶发超时。', '需要生产环境最近请求的 trace。', null],
      ['api-02', 'api-01', 'blocked', 'blocked', 'workstation-win', 'workbuddy', 'session-api', '2026-11-12T02:02:00.000Z', '提供生产环境错误日志', '缺少包含 traceId 的请求日志，无法缩小排查范围。', '请提供最近一次超时请求的日志。', '等待输入。', null]
    ]],
    ['trace-research', '竞品研究摘要', 'Mac mini · Codex', '2026-11-12T01:41:00.000Z', [
      ['research-01', null, 'report', 'completed', 'mac-mini', 'codex', 'session-research', '2026-11-12T01:41:00.000Z', '收集竞品信号', '完成控制面与协作工具的调研。', '对比 Agent 任务编排产品。', '用户更重视少打扰、可回溯的控制体验。', 'codex://session/session-research'],
      ['research-02', 'research-01', 'decision', 'completed', 'mac-mini', 'codex', 'session-research', '2026-11-12T01:45:00.000Z', '初版结论已生成', '摘要可供审阅，暂不阻塞下一步。', '将研究整理为内部决策输入。', '建议采用“先处理需要人的事”作为首页原则。', 'codex://session/session-research']
    ]]
  ];
  for (const [id, title, source, created, nodes] of records) {
    addTrace.run(id, title, title, source, created, created, 0, created);
    for (const node of nodes) addNode.run(node[0], id, ...node.slice(1));
    refreshTrace(id);
  }
}
// 演示数据仅在显式开启时写入，正式环境默认保持空库。
if (process.env.SEED_DEMO === 'true') seed();

const app = Fastify({ logger: true });
app.register(fastifyStatic, { root: join(root, 'public'), wildcard: false, index: false });
app.get('/', (_, reply) => reply.sendFile('index.html'));
app.addHook('onClose', () => db.close());

function requireDevice(request, reply) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: '缺少设备 token' } });
  const device = db.prepare('SELECT * FROM devices WHERE token_hash=?').get(hash(token));
  if (!device) return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: '设备 token 无效' } });
  return device;
}
app.get('/v1/traces', (request) => {
  const { sort = 'recent_activity', pendingOnly = 'false' } = request.query;
  const order = sort === 'pending_first' ? 'pending_count DESC, last_activity_at DESC' : sort === 'recent_created' ? 'created_at DESC' : 'last_activity_at DESC';
  const where = pendingOnly === 'true' ? 'WHERE pending_count > 0' : '';
  return { traces: db.prepare(`SELECT *,
    (SELECT COUNT(*) FROM nodes WHERE trace_id=traces.id) AS node_count,
    (SELECT COUNT(*) FROM nodes WHERE trace_id=traces.id AND occurred_at > COALESCE(traces.last_viewed_at, '')) AS unread_count
    FROM traces ${where} ORDER BY ${order}`).all() };
});
app.get('/v1/traces/:traceId', (request, reply) => {
  const trace = db.prepare('SELECT * FROM traces WHERE id=?').get(request.params.traceId);
  return trace ? { trace } : reply.code(404).send({ error: { code: 'NOT_FOUND', message: '汇报链不存在' } });
});
app.get('/v1/traces/:traceId/nodes', (request, reply) => {
  const trace = db.prepare('SELECT id FROM traces WHERE id=?').get(request.params.traceId);
  if (!trace) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '汇报链不存在' } });
  return { nodes: db.prepare('SELECT * FROM nodes WHERE trace_id=? ORDER BY occurred_at').all(request.params.traceId) };
});
app.post('/v1/traces/:traceId/view', (request, reply) => {
  const trace = db.prepare('SELECT last_viewed_at FROM traces WHERE id=?').get(request.params.traceId);
  if (!trace) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '汇报链不存在' } });
  const newNodeIds = db.prepare("SELECT id FROM nodes WHERE trace_id=? AND occurred_at > COALESCE(?, '') ORDER BY occurred_at").all(request.params.traceId, trace.last_viewed_at).map((node) => node.id);
  db.prepare('UPDATE traces SET last_viewed_at=? WHERE id=?').run(now(), request.params.traceId);
  return { newNodeIds };
});
app.patch('/v1/traces/:traceId', (request, reply) => {
  const name = typeof request.body?.name === 'string' ? request.body.name.trim() : '';
  if (!name) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: '汇报链名字不能为空' } });
  if (name.length > 500) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: '汇报链名字不能超过 500 个字符' } });
  const result = db.prepare('UPDATE traces SET name=? WHERE id=?').run(name, request.params.traceId);
  if (!result.changes) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '汇报链不存在' } });
  const trace = db.prepare('SELECT * FROM traces WHERE id=?').get(request.params.traceId);
  emit('trace.updated', { traceId: trace.id, name: trace.name });
  return { trace };
});
app.get('/v1/nodes/:nodeId', (request, reply) => {
  const node = db.prepare(`SELECT n.*, d.name AS device_name, t.name AS trace_title FROM nodes n JOIN devices d ON d.id=n.device_id JOIN traces t ON t.id=n.trace_id WHERE n.id=?`).get(request.params.nodeId);
  return node ? { node } : reply.code(404).send({ error: { code: 'NOT_FOUND', message: '节点不存在' } });
});
app.get('/v1/inbox', (request) => {
  const status = request.query.status || 'pending';
  return { items: db.prepare(`SELECT n.*, t.name AS trace_title, d.name AS device_name FROM nodes n JOIN traces t ON t.id=n.trace_id JOIN devices d ON d.id=n.device_id WHERE n.status=? ORDER BY n.occurred_at DESC`).all(status === 'pending' ? 'blocked' : status) };
});
app.get('/v1/devices', () => ({ devices: db.prepare('SELECT id,name,state,last_seen_at,created_at FROM devices ORDER BY last_seen_at DESC').all() }));
app.post('/v1/devices/pair', (request, reply) => {
  const { name } = request.body || {};
  if (!name) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'name 为必填项' } });
  const id = `device-${shortHash(`${name}-${Date.now()}`)}`, token = randomUUID(), time = now();
  db.prepare('INSERT INTO devices VALUES(?,?,?,?,?,?)').run(id, name, hash(token), 'online', time, time);
  emit('device.updated', { deviceId: id, state: 'online', lastSeenAt: time });
  return reply.code(201).send({ deviceId: id, token, createdAt: time });
});
app.post('/v1/reports', (request, reply) => {
  const device = requireDevice(request, reply); if (!device || device.raw) return;
  const input = request.body || {};
  const needed = ['app', 'sessionId', 'nodeType', 'title', 'occurredAt'];
  if (needed.some((key) => !input[key])) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: `缺少字段：${needed.filter((k) => !input[k]).join(', ')}` } });
  const key = request.headers['idempotency-key'];
  if (!key) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: '缺少 Idempotency-Key' } });
  const existing = db.prepare('SELECT response_json FROM idempotency_keys WHERE token_hash=? AND key=?').get(device.token_hash, key);
  if (existing) return reply.code(200).send(JSON.parse(existing.response_json));
  const traceId = shortHash(`${device.id}|${input.app}|${input.sessionId}|${input.localTraceSeq || input.sessionId}`);
  const nodeId = randomUUID(); const timestamp = input.occurredAt; const source = `${device.name} · ${input.app}`;
  const traceName = [input.input, input.detail, input.traceTitle, input.title].find((value) => typeof value === 'string' && value.trim())?.trim() || input.title;
  const write = db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO traces(id,title,name,source_summary,created_at,last_activity_at,pending_count,last_viewed_at) VALUES(?,?,?,?,?,?,?,?)').run(traceId, input.traceTitle || input.title, traceName, source, timestamp, timestamp, 0, null);
    if (input.parentNodeId) { const parent = db.prepare('SELECT trace_id FROM nodes WHERE id=?').get(input.parentNodeId); if (!parent || parent.trace_id !== traceId) throw new Error('INVALID_PARENT'); }
    db.prepare('INSERT INTO nodes VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(nodeId, traceId, input.parentNodeId || null, input.nodeType, input.nodeType === 'blocked' ? 'blocked' : 'completed', device.id, input.app, input.sessionId, timestamp, input.title, input.detail || '', input.input || null, input.conclusion || null, input.sourceUrl || null);
    db.prepare('UPDATE devices SET last_seen_at=?, state=? WHERE id=?').run(now(), 'online', device.id);
    refreshTrace(traceId);
  });
  try { write(); } catch (error) { return reply.code(error.message === 'INVALID_PARENT' ? 422 : 500).send({ error: { code: error.message === 'INVALID_PARENT' ? 'INVALID_PARENT' : 'STORAGE_ERROR', message: error.message } }); }
  const response = { traceId, nodeId, createdAt: now(), status: input.nodeType === 'blocked' ? 'blocked' : 'completed' };
  db.prepare('INSERT INTO idempotency_keys VALUES(?,?,?,?)').run(device.token_hash, key, JSON.stringify(response), new Date(Date.now() + 86400000).toISOString());
  emit('node.created', { traceId, nodeId });
  return reply.code(201).send(response);
});
app.post('/v1/nodes/:nodeId/interventions', (request, reply) => {
  const node = db.prepare('SELECT * FROM nodes WHERE id=?').get(request.params.nodeId);
  if (!node) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '节点不存在' } });
  const body = request.body?.body?.trim();
  if (!body) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: '回复内容不能为空' } });
  const id = randomUUID(), sentAt = now(), interventionNode = randomUUID();
  const write = db.transaction(() => {
    db.prepare('INSERT INTO interventions VALUES(?,?,?,?,?,NULL)').run(id, node.id, body, 'sent', sentAt);
    db.prepare("UPDATE nodes SET status='replied' WHERE id=?").run(node.id);
    db.prepare('INSERT INTO nodes VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(interventionNode, node.trace_id, node.id, 'decision', 'completed', node.device_id, 'dashboard', node.session_id, sentAt, '人工介入已发送', body, null, '已发送给 Agent，等待回执。', null);
    refreshTrace(node.trace_id);
  }); write();
  emit('intervention.created', { nodeId: node.id, interventionId: id }); emit('node.updated', { traceId: node.trace_id, nodeId: node.id, status: 'replied' });
  return reply.code(201).send({ interventionId: id, status: 'sent', sentAt });
});
app.get('/v1/events', (request, reply) => {
  reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  reply.raw.write(': connected\n\n'); clients.add(reply);
  request.raw.on('close', () => clients.delete(reply));
  return reply;
});

app.listen({ port: Number(process.env.PORT || 3000), host: '0.0.0.0' });
