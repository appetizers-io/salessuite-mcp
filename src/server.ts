import { readFileSync } from 'node:fs';
import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Client } from './generated/client/index.js';
import { loadSpecIndex, type OperationInfo } from './spec.js';
import { TOOLS, TOOLSETS, type ToolDefinition, type Toolset } from './tools.js';
import { describeWebhookEvent, WEBHOOK_EVENT_TYPES } from './webhooks.js';

export const SERVER_NAME = 'salessuite';
/** Single source of truth for the version: package.json (bumped by `npm version`). */
export const SERVER_VERSION: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

export interface ServerOptions {
  client: Client;
  /** Only register tools that do not modify data. */
  readOnly?: boolean;
  /** Toolsets to register; all when omitted. `metadata` is always registered. */
  toolsets?: readonly Toolset[];
}

/** Parses a comma-separated `SALESSUITE_TOOLSETS` value. Returns undefined (all toolsets) for an empty value. */
export function parseToolsets(value: string | undefined): Toolset[] | undefined {
  const names = (value ?? '')
    .split(',')
    .map((n) => n.trim().toLowerCase())
    .filter(Boolean);
  if (names.length === 0 || names.includes('all')) return undefined;
  const unknown = names.filter((n) => !(TOOLSETS as readonly string[]).includes(n));
  if (unknown.length > 0) {
    throw new Error(`Unknown toolset(s) in SALESSUITE_TOOLSETS: ${unknown.join(', ')}. Valid: ${TOOLSETS.join(', ')}.`);
  }
  return names as Toolset[];
}

const INSTRUCTIONS = `Tools for the SalesSuite CRM of the tenant that owns the configured API key.

Data model: a contact (usually a company) has 1..n contact persons and 0..n deals. Deals live in pipelines made of phases.
Notes, calls and emails are activities attached to a contact or a deal.

Workflow tips:
- Resolve IDs before writing: \`list_pipelines\` for phase IDs, \`list_users\` for user IDs, \`list_call_types\` for call types.
- \`list_properties\` lists all fields, including tenant-specific custom properties, with the identifiers used by search filters and create/update payloads.
- Prefer \`search_contacts\` / \`search_deals\` (filters + sorting) or the \`*_by_email\` lookups over paging through \`list_*\` results.
- Webhooks: call \`describe_webhook_event\` for the filter and payload schema of an event type before subscribing.
- \`get_api_guide\` explains property identification, note HTML, cursor pagination, archived records and rate limits (300 requests/minute per tenant).`;

/** Read-only operations that use POST. */
const READ_ONLY_POST_OPERATIONS = new Set(['searchContactV2', 'searchDeals']);

export function createServer({ client, readOnly = false, toolsets }: ServerOptions): McpServer {
  const spec = loadSpecIndex();
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });
  const enabled = new Set<Toolset>(toolsets ? ['metadata', ...toolsets] : TOOLSETS);

  for (const def of TOOLS) {
    if (!enabled.has(def.toolset)) continue;
    const op = spec.operations.get(def.operationId);
    if (!op) throw new Error(`Tool ${def.name}: operation ${def.operationId} not found in the bundled spec.`);
    const isReadOnly = op.method === 'GET' || READ_ONLY_POST_OPERATIONS.has(op.operationId);
    if (readOnly && !isReadOnly) continue;

    server.registerTool(
      def.name,
      {
        title: op.summary || def.name,
        description: describe(op, def),
        inputSchema: def.inputSchema,
        annotations: {
          readOnlyHint: isReadOnly,
          destructiveHint: !isReadOnly && op.method !== 'POST',
          idempotentHint: op.method !== 'POST' || isReadOnly,
          openWorldHint: true,
        },
      },
      async (args) => callTool(client, def, args as Record<string, unknown>),
    );
  }

  server.registerTool(
    'get_api_guide',
    {
      title: 'SalesSuite API guide',
      description:
        'Returns the SalesSuite API guide: data model, property identification for search filters, supported note HTML, cursor pagination, archived records, rate limits and webhooks. Optionally filter by a section heading.',
      inputSchema: z.object({
        section: z.string().optional().describe('Case-insensitive substring of a section heading, e.g. "property identification" or "notes".'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ section }) => ({ content: [{ type: 'text', text: guideSection(spec.guide, section) }] }),
  );

  if (enabled.has('webhooks')) {
    server.registerTool(
      'describe_webhook_event',
      {
        title: 'Describe webhook event',
        description:
          'Returns, for one webhook event type, the JSON Schema of the subscription body (incl. the event-specific `filter`) ' +
          'for `create_webhook_subscription` / `update_webhook_subscription`, and the JSON Schema of the payload delivered to `hookUrl`.',
        inputSchema: z.object({ type: z.enum(WEBHOOK_EVENT_TYPES).describe('The webhook event type.') }),
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async ({ type }) => ({ content: [{ type: 'text', text: JSON.stringify(describeWebhookEvent(type), null, 2) }] }),
    );
  }

  return server;
}

function describe(op: OperationInfo, def: ToolDefinition): string {
  const parts = [op.summary && !op.description.startsWith(op.summary) ? `${op.summary}.` : '', op.description, def.hint ?? ''];
  return parts.filter(Boolean).join('\n\n');
}

export async function callTool(client: Client, def: ToolDefinition, args: Record<string, unknown>): Promise<CallToolResult> {
  let result: Awaited<ReturnType<ToolDefinition['call']>>;
  try {
    result = await def.call(client, args);
  } catch (error) {
    if (error instanceof z.ZodError) return errorResult(`Invalid arguments, nothing was sent:\n${z.prettifyError(error)}`);
    return errorResult(`Request to SalesSuite failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const { response, data, error } = result;
  if (!response || !response.ok || error !== undefined) {
    if (!response) return errorResult(`Request to SalesSuite failed: ${formatError(error)}`);
    return errorResult(`SalesSuite API error: HTTP ${response.status} ${response.statusText}${statusHint(response)}\n${formatError(error)}`);
  }

  const empty = response.status === 204 || data === undefined || data === null || data === '';
  const text = empty ? `Success (HTTP ${response.status}).` : typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: 'text', text }] };
}

function statusHint(response: Response): string {
  switch (response.status) {
    case 401:
      return ' — the API key is missing or invalid; check SALESSUITE_API_KEY.';
    case 403:
      return ' — the API key is not allowed to access this resource.';
    case 409:
      return ' — conflict, e.g. an archived record or a duplicate contact person email.';
    case 429: {
      const retry = response.headers.get('retry-after');
      return ` — rate limit exceeded (300 requests/minute per tenant)${retry ? `; retry after ${retry}s` : ''}.`;
    }
    default:
      return '';
  }
}

function formatError(error: unknown): string {
  if (error === undefined || error === null || error === '') return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return JSON.stringify(error, null, 2);
}

function errorResult(text: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: text.trim() }] };
}

export function guideSection(guide: string, section: string | undefined): string {
  if (!section?.trim()) return guide;
  const needle = section.trim().toLowerCase();
  const sections = guide.split(/\n(?=#{1,2} )/);
  const matches = sections.filter((s) => (s.split('\n')[0] ?? '').toLowerCase().includes(needle));
  if (matches.length > 0) return matches.join('\n\n');
  const headings = sections.map((s) => s.split('\n')[0]).join('\n');
  return `No section matching "${section}". Available sections:\n${headings}`;
}
