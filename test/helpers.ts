import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createSalesSuiteClient } from '../src/client.js';
import { createServer } from '../src/server.js';
import type { Toolset } from '../src/tools.js';

export interface RecordedRequest {
  method: string;
  url: URL;
  headers: Headers;
  body: string;
}

export type Responder = (request: RecordedRequest) => Response | Promise<Response>;

export const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

/** Connects an MCP client to the server, with SalesSuite HTTP calls answered by `responder`. */
export async function connect(
  options: { responder?: Responder; readOnly?: boolean; toolsets?: Toolset[]; apiKey?: string; fetch?: typeof fetch } = {},
) {
  const requests: RecordedRequest[] = [];
  const responder = options.responder ?? (() => json({}));
  const mockFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const recorded = { method: request.method, url: new URL(request.url), headers: request.headers, body: await request.text() };
    requests.push(recorded);
    return responder(recorded);
  };

  const api = createSalesSuiteClient({
    apiKey: options.apiKey ?? 'test-key',
    userAgent: 'salessuite-mcp/test',
    fetch: options.fetch ?? mockFetch,
  });
  const server = createServer({ client: api, readOnly: options.readOnly, toolsets: options.toolsets });
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    client,
    requests,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

export function text(result: { content?: unknown }): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  return content.map((c) => c.text ?? '').join('\n');
}
