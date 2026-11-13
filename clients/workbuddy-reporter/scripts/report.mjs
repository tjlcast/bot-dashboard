import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { dirname, join } from 'node:path';

const API_BASE = (process.env.ACP_API_URL ?? 'http://localhost:3000/v1').replace(/\/$/, '');
const STATE_PATH = process.env.ACP_WORKBUDDY_REPORTER_STATE_PATH
  ?? join(process.env.CODEBUDDY_PLUGIN_DATA ?? join(homedir(), '.workbuddy', 'plugins', 'workbuddy-reporter'), 'state.json');
const DEVICE_NAME = process.env.ACP_DEVICE_NAME ?? `workbuddy-${hostname()}`;

function textFromContent(content, acceptedTypes) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part && typeof part === 'object' && acceptedTypes.has(part.type) && typeof part.text === 'string')
    .map((part) => typeof part.text === 'string' ? part.text : '')
    .join('');
}

function userTextFromContent(content) {
  const raw = textFromContent(content, new Set(['input_text', 'text']));
  const queries = [...raw.matchAll(/<user_query>([\s\S]*?)<\/user_query>/g)]
    .map((match) => match[1].trim())
    .filter(Boolean);
  if (queries.length) return queries.join('\n');

  // WorkBuddy may combine system context and the user's prompt in one input_text block.
  // Do not upload that context if a user-query boundary is unavailable.
  if (/<system-reminder\b|<identity_context\b|<project_context\b/i.test(raw)) return '';
  return raw;
}

function timelineRecord(line) {
  if (!line || typeof line !== 'object') return null;
  const message = line.message && typeof line.message === 'object' ? line.message : line;
  const role = message.role ?? line.role;
  if (role !== 'user' && role !== 'assistant') return null;
  const content = message.content ?? line.content ?? message.text ?? line.text;
  return {
    role,
    text: role === 'user'
      ? userTextFromContent(content)
      : textFromContent(content, new Set(['output_text', 'text'])),
    id: message.id ?? line.uuid ?? line.id ?? null,
    parentId: message.parentId ?? line.parentId ?? null
  };
}

async function latestTurn(transcriptPath) {
  const transcript = await readFile(transcriptPath, 'utf8');
  let userText = '';
  let assistantText = '';
  let messageId = null;
  let parentMessageId = null;
  for (const line of transcript.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const record = timelineRecord(JSON.parse(line));
      if (!record) continue;
      if (record.role === 'user') {
        userText = record.text;
        assistantText = '';
        messageId = null;
        // A resent/edited user message points to its actual branch parent here.
        parentMessageId = record.parentId;
      } else {
        assistantText += record.text;
        messageId = record.id ?? messageId;
      }
    } catch {
      // WorkBuddy may still be writing the transcript; ignore one incomplete JSONL line.
    }
  }
  return { userText: userText.trim(), assistantText: assistantText.trim(), messageId, parentMessageId };
}

async function loadState() {
  try {
    const parsed = JSON.parse(await readFile(STATE_PATH, 'utf8'));
    return {
      version: 1,
      apiBase: typeof parsed.apiBase === 'string' ? parsed.apiBase : undefined,
      credential: parsed.credential,
      pending: Array.isArray(parsed.pending) ? parsed.pending : [],
      nodeIdByMessageId: parsed.nodeIdByMessageId && typeof parsed.nodeIdByMessageId === 'object'
        ? parsed.nodeIdByMessageId
        : {}
    };
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return { version: 1, apiBase: undefined, pending: [], nodeIdByMessageId: {} };
  }
}

async function saveState(state) {
  await mkdir(dirname(STATE_PATH), { recursive: true });
  const temporary = `${STATE_PATH}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, STATE_PATH);
}

async function api(path, init) {
  const response = await fetch(`${API_BASE}${path}`, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error?.message ?? `Agent Control Plane request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return body;
}

async function reconcileApiBase(state) {
  if (state.apiBase === API_BASE) return;

  // A device token and platform node IDs belong to one server/database.  Do not
  // send them to a newly configured platform; retain the outbox for replay.
  state.apiBase = API_BASE;
  delete state.credential;
  state.nodeIdByMessageId = {};
  await saveState(state);
}

async function credential(state) {
  if (process.env.ACP_DEVICE_TOKEN) return { token: process.env.ACP_DEVICE_TOKEN, external: true };
  if (state.credential) return state.credential;
  const paired = await api('/devices/pair', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: DEVICE_NAME })
  });
  state.credential = { deviceId: paired.deviceId, token: paired.token, pairedAt: paired.createdAt };
  await saveState(state);
  return state.credential;
}

async function flushPending(state) {
  let auth = await credential(state);
  let pairedAfterUnauthorized = false;
  while (state.pending.length) {
    const report = state.pending[0];
    try {
      const parentNodeId = report.parentMessageId ? state.nodeIdByMessageId[report.parentMessageId] : undefined;
      const result = await api('/reports', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.token}`,
          'Idempotency-Key': report.idempotencyKey
        },
        body: JSON.stringify({ ...report.body, parentNodeId: parentNodeId ?? null })
      });
      if (report.messageId && result.nodeId) rememberNode(state, report.messageId, result.nodeId);
      state.pending.shift();
      await saveState(state);
    } catch (error) {
      // A platform can be redeployed with an empty database without changing
      // its URL. Pair once more and replay the same queued report.
      if (error?.status === 401 && !auth.external && !pairedAfterUnauthorized) {
        pairedAfterUnauthorized = true;
        delete state.credential;
        state.nodeIdByMessageId = {};
        await saveState(state);
        auth = await credential(state);
        continue;
      }
      report.attempts += 1;
      await saveState(state);
      console.error(`[workbuddy-reporter] report deferred: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
  }
}

function rememberNode(state, messageId, nodeId) {
  state.nodeIdByMessageId[messageId] = nodeId;
  const messageIds = Object.keys(state.nodeIdByMessageId);
  for (const obsoleteId of messageIds.slice(0, Math.max(0, messageIds.length - 2_000))) {
    delete state.nodeIdByMessageId[obsoleteId];
  }
}

function reportKey(sessionId, turn) {
  const identity = turn.messageId ?? createHash('sha256').update(`${turn.userText}\n${turn.assistantText}`).digest('hex');
  return `workbuddy:${sessionId}:${identity}`;
}

async function main() {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  if (input.hook_event_name !== 'Stop' || input.stop_hook_active || !input.session_id || !input.transcript_path) return;
  const turn = await latestTurn(input.transcript_path);
  if (!turn.assistantText) return;

  const state = await loadState();
  await reconcileApiBase(state);
  if (turn.messageId && state.nodeIdByMessageId[turn.messageId]) return;
  const key = reportKey(input.session_id, turn);
  if (!state.pending.some((report) => report.idempotencyKey === key)) {
    const occurredAt = new Date().toISOString();
    state.pending.push({
      idempotencyKey: key, messageId: turn.messageId, parentMessageId: turn.parentMessageId,
      queuedAt: occurredAt, attempts: 0,
      body: {
        app: 'workbuddy', sessionId: input.session_id, localTraceSeq: input.session_id,
        traceTitle: `WorkBuddy session ${input.session_id}`, nodeType: 'report',
        title: 'WorkBuddy text reply', input: turn.userText, detail: turn.assistantText,
        conclusion: turn.assistantText, occurredAt
      }
    });
    await saveState(state);
  }
  await flushPending(state);
}

try {
  await main();
  process.stdout.write('{"continue":true}\n');
} catch (error) {
  console.error(`[workbuddy-reporter] ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.stdout.write('{"continue":true}\n');
}
