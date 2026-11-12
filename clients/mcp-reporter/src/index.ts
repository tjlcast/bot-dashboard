import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const apiBase = (process.env.ACP_API_URL ?? 'http://localhost:3000/v1').replace(/\/$/, '');
type PairState = { deviceId: string; token: string; pairedAt: string };
type RetainedNode = {
  nodeId: string;
  traceId: string;
  trace: string;
  title: string;
  nodeType: 'report' | 'blocked' | 'decision' | 'checkpoint';
  parentNodeId?: string;
  reportedAt: string;
};
type ReportResult = { traceId: string; nodeId: string; createdAt: string; status: string };
const retainedNodes = new Map<string, RetainedNode>();

type ApiError = { error?: { message?: string } };

async function api(path: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(`${apiBase}${path}`, init);
  const body = await response.json().catch(() => ({})) as ApiError;
  if (!response.ok) throw new Error(body.error?.message ?? `Platform API request failed (${response.status})`);
  return body;
}

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function retainedNodeList() {
  return [...retainedNodes.values()];
}

function toolError(message: string) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message, retainedNodes: retainedNodeList() }, null, 2) }]
  };
}

const server = new McpServer({ name: 'agent-reporter-mcp', version: '0.1.0' });

async function pairOnStartup(): Promise<PairState> {
  const name = process.env.ACP_DEVICE_NAME ?? `mcp-${hostname()}-${process.pid}`;
  const result = await api('/devices/pair', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name })
  }) as { deviceId: string; token: string; createdAt: string };
  process.stderr.write(`[agent-reporter-mcp] paired device ${result.deviceId}\n`);
  return { deviceId: result.deviceId, token: result.token, pairedAt: result.createdAt };
}

// 一个 MCP 子进程对应一个 Agent 实例：启动时自动配对，Token 只存在于该进程内存。
const pairState = await pairOnStartup();

server.tool(
  'report_progress',
  'Report an Agent progress node to Agent Control Plane. Reuse the same trace value for a workflow and pass a prior nodeId as parentNodeId to create a chain or branch.',
  {
    app: z.string().min(1).describe('Reporting application, such as codex or workbuddy.'),
    sessionId: z.string().min(1).describe('The source Agent session ID.'),
    trace: z.string().min(1).describe('A stable local workflow ID. Reuse it for every node in the same report chain.'),
    traceTitle: z.string().min(1).optional().describe('Readable workflow title; normally provide it for the first node.'),
    parentNodeId: z.string().uuid().optional().describe('Parent nodeId for a child node or a DAG branch.'),
    nodeType: z.enum(['report', 'blocked', 'decision', 'checkpoint']).describe('Node type.'),
    title: z.string().min(1).describe('Short status summary.'),
    detail: z.string().optional().describe('Full progress detail.'),
    input: z.string().optional().describe('Relevant input or human question.'),
    conclusion: z.string().optional().describe('Agent conclusion or next action.'),
    sourceUrl: z.string().url().optional().describe('Optional deep link to the source conversation.'),
    occurredAt: z.string().datetime().optional().describe('RFC 3339 timestamp; defaults to current time.')
  },
  async (input) => {
    if (retainedNodes.size > 0 && !input.parentNodeId) {
      return toolError('parentNodeId is required after the first report in this MCP instance. Choose one of the retained node IDs.');
    }
    if (input.parentNodeId && !retainedNodes.has(input.parentNodeId)) {
      return toolError(`Unknown parentNodeId: ${input.parentNodeId}. It was not created by this MCP instance.`);
    }
    const parent = input.parentNodeId ? retainedNodes.get(input.parentNodeId) : undefined;
    if (parent && parent.trace !== input.trace) {
      return toolError(`parentNodeId belongs to trace "${parent.trace}", but this report uses trace "${input.trace}".`);
    }
    const result = await api('/reports', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${pairState.token}`,
        'Idempotency-Key': randomUUID()
      },
      body: JSON.stringify({
        ...input,
        localTraceSeq: input.trace,
        parentNodeId: input.parentNodeId ?? null,
        occurredAt: input.occurredAt ?? new Date().toISOString()
      })
    }) as ReportResult;
    const retainedNode: RetainedNode = {
      nodeId: result.nodeId,
      traceId: result.traceId,
      trace: input.trace,
      title: input.title,
      nodeType: input.nodeType,
      parentNodeId: input.parentNodeId,
      reportedAt: result.createdAt
    };
    retainedNodes.set(result.nodeId, retainedNode);
    return text(result);
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
