#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createSalesSuiteClient } from './client.js';
import { createServer, parseToolsets, SERVER_VERSION } from './server.js';

async function main(): Promise<void> {
  const apiKey = process.env.SALESSUITE_API_KEY?.trim();
  if (!apiKey) {
    console.error(
      'salessuite-mcp: SALESSUITE_API_KEY is not set.\n' +
        'Create an API key in SalesSuite (Settings > General) and pass it via the "env" block of your MCP client configuration.',
    );
    process.exit(1);
  }

  const client = createSalesSuiteClient({
    apiKey,
    baseUrl: process.env.SALESSUITE_BASE_URL?.trim() || undefined,
    userAgent: `salessuite-mcp/${SERVER_VERSION}`,
  });
  const server = createServer({
    client,
    readOnly: isTruthy(process.env.SALESSUITE_READ_ONLY),
    toolsets: parseToolsets(process.env.SALESSUITE_TOOLSETS),
  });
  await server.connect(new StdioServerTransport());
}

function isTruthy(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase());
}

main().catch((error: unknown) => {
  console.error('salessuite-mcp:', error);
  process.exit(1);
});
