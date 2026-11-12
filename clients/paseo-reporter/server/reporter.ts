import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { dirname, join } from 'node:path';

export type PaseoAgent = {
  id: string;
  provider: string;
  title: string | null;
  workspaceId: string | null;
  cwd: string;
};

type Credential = { deviceId: string; token: string; pairedAt: string };
type PendingReport = {
  idempotencyKey: string;
  body: ReportBody;
  queuedAt: string;
  attempts: number;
};
type PersistedState = {
  version: 1;
  credential?: Credential;
  pending: PendingReport[];
};
type ReportBody = {
  app: string;
  sessionId: string;
  localTraceSeq: string;
  traceTitle: string;
  nodeType: 'report';
  title: string;
  detail: string;
  conclusion: string;
  occurredAt: string;
};

const apiBase = (process.env.ACP_API_URL ?? 'http://localhost:3000/v1').replace(/\/$/, '');
const statePath = process.env.ACP_PASEO_REPORTER_STATE_PATH
  ?? join(process.env.PASEO_HOME ?? join(homedir(), '.paseo'), 'plugins', 'paseo-reporter', 'state.json');
const deviceName = process.env.ACP_DEVICE_NAME ?? `paseo-${hostname()}`;

let state: PersistedState | undefined;
let serial = Promise.resolve();

function defaultState(): PersistedState {
  return { version: 1, pending: [] };
}

async function loadState(): Promise<PersistedState> {
  if (state) return state;
  try {
    const parsed = JSON.parse(await readFile(statePath, 'utf8')) as Partial<PersistedState>;
    state = {
      version: 1,
      credential: parsed.credential,
      pending: Array.isArray(parsed.pending) ? parsed.pending : []
    };
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    state = defaultState();
  }
  return state;
}

async function saveState(): Promise<void> {
  if (!state) return;
  await mkdir(dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, statePath);
}

async function api<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, init);
  const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? `Agent Control Plane request failed (${response.status})`);
  return body as T;
}

async function credential(): Promise<Credential> {
  const configuredToken = process.env.ACP_DEVICE_TOKEN;
  if (configuredToken) return { deviceId: 'configured', token: configuredToken, pairedAt: '' };

  const saved = await loadState();
  if (saved.credential) return saved.credential;
  const paired = await api<{ deviceId: string; token: string; createdAt: string }>('/devices/pair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: deviceName })
  });
  saved.credential = { deviceId: paired.deviceId, token: paired.token, pairedAt: paired.createdAt };
  await saveState();
  return saved.credential;
}

async function send(report: PendingReport): Promise<void> {
  const auth = await credential();
  await api('/reports', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.token}`,
      'Idempotency-Key': report.idempotencyKey
    },
    body: JSON.stringify(report.body)
  });
}

async function flushPending(): Promise<void> {
  const saved = await loadState();
  while (saved.pending.length > 0) {
    const report = saved.pending[0];
    try {
      await send(report);
      saved.pending.shift();
      await saveState();
    } catch {
      report.attempts += 1;
      await saveState();
      return;
    }
  }
}

function queued<T>(work: () => Promise<T>): Promise<T> {
  const next = serial.then(work, work);
  serial = next.then(() => undefined, () => undefined);
  return next;
}

function keyFor(agentId: string, turnId: string | null, text: string): string {
  if (turnId) return `paseo:${agentId}:${turnId}`;
  return `paseo:${agentId}:no-turn:${createHash('sha256').update(text).digest('hex')}:${randomUUID()}`;
}

export async function reportCompletedText(agent: PaseoAgent, turnId: string | null, text: string): Promise<void> {
  if (!text.trim()) return;
  await queued(async () => {
    const saved = await loadState();
    const idempotencyKey = keyFor(agent.id, turnId, text);
    if (!saved.pending.some((item) => item.idempotencyKey === idempotencyKey)) {
      saved.pending.push({
        idempotencyKey,
        queuedAt: new Date().toISOString(),
        attempts: 0,
        body: {
          app: agent.provider || 'paseo',
          sessionId: agent.id,
          localTraceSeq: agent.id,
          traceTitle: agent.title ?? `Paseo agent ${agent.id}`,
          nodeType: 'report',
          title: agent.title ? `${agent.title}: text reply` : 'Paseo agent text reply',
          detail: text,
          conclusion: text,
          occurredAt: new Date().toISOString()
        }
      });
      await saveState();
    }
    await flushPending();
  });
}

export function retryPendingReports(): void {
  void queued(flushPending);
}
