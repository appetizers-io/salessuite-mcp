import { afterEach, describe, expect, it } from 'vitest';
import { parseToolsets } from '../src/server.js';
import { connect, json, text } from './helpers.js';

type Session = Awaited<ReturnType<typeof connect>>;
let session: Session | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
});

describe('tools/list', () => {
  it('lists all tools with JSON input schemas and annotations', async () => {
    session = await connect();
    const { tools } = await session.client.listTools();
    expect(tools).toHaveLength(53);

    const getDeal = tools.find((t) => t.name === 'get_deal')!;
    expect(getDeal.description).toContain('Get Deal by ID');
    expect(getDeal.inputSchema.required).toEqual(['dealId']);
    expect(getDeal.annotations).toMatchObject({ readOnlyHint: true });

    const deleteNote = tools.find((t) => t.name === 'delete_note')!;
    expect(deleteNote.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });

    const search = tools.find((t) => t.name === 'search_contacts')!;
    expect(search.annotations).toMatchObject({ readOnlyHint: true });
  });

  it('allows custom properties on create/update payloads', async () => {
    session = await connect();
    const { tools } = await session.client.listTools();
    const updateDeal = tools.find((t) => t.name === 'update_deal')!;
    const body = (updateDeal.inputSchema.properties as Record<string, { additionalProperties?: unknown }>).body!;
    expect(body.additionalProperties).not.toBe(false);
  });

  it('descriptions contain no Swagger UI HTML or anchors', async () => {
    session = await connect();
    const { tools } = await session.client.listTools();
    const all = JSON.stringify(tools);
    expect(all).not.toMatch(/<a |<br|#operations-|#doc-section-|&#x2F;/);
  });

  it('only registers read-only tools in read-only mode', async () => {
    session = await connect({ readOnly: true });
    const { tools } = await session.client.listTools();
    expect(tools.length).toBeGreaterThan(20);
    for (const tool of tools) expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
    expect(tools.map((t) => t.name)).toContain('search_deals');
    expect(tools.map((t) => t.name)).not.toContain('create_contact');
  });
});

describe('tools/call', () => {
  it('maps flat arguments to path and query parameters and sends the API key', async () => {
    session = await connect({ apiKey: 'secret-key', responder: () => json({ id: 'c1' }) });
    const result = await session.client.callTool({ name: 'list_deals_by_contact', arguments: { contactId: '7f1c7a4e-0c6b-4b8e-9b44-5a8d2c1f0e11', pageSize: 5 } });

    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain('"id": "c1"');
    const [request] = session.requests;
    expect(request!.method).toBe('GET');
    expect(request!.url.pathname).toBe('/api/v1/deal/by-contact/7f1c7a4e-0c6b-4b8e-9b44-5a8d2c1f0e11');
    expect(request!.url.searchParams.get('pageSize')).toBe('5');
    expect(request!.headers.get('x-api-key')).toBe('secret-key');
    expect(request!.headers.get('x-lang')).toBe('en');
  });

  it('sends JSON bodies and keeps custom properties', async () => {
    session = await connect({ responder: () => json({ id: 'd1' }) });
    const result = await session.client.callTool({
      name: 'update_deal',
      arguments: { dealId: '7f1c7a4e-0c6b-4b8e-9b44-5a8d2c1f0e11', body: { name: 'Big deal', myCustomField: 'x' } },
    });

    expect(result.isError).toBeFalsy();
    const [request] = session.requests;
    expect(request!.method).toBe('PATCH');
    expect(request!.url.pathname).toBe('/api/v2/deal/7f1c7a4e-0c6b-4b8e-9b44-5a8d2c1f0e11');
    expect(request!.headers.get('content-type')).toContain('application/json');
    expect(JSON.parse(request!.body)).toEqual({ name: 'Big deal', myCustomField: 'x' });
  });

  it('sends note content as HTML text', async () => {
    session = await connect({ responder: () => json({ id: 'n1' }, 201) });
    await session.client.callTool({
      name: 'create_note',
      arguments: { contactId: '7f1c7a4e-0c6b-4b8e-9b44-5a8d2c1f0e11', body: '<p>Hello</p>' },
    });
    const [request] = session.requests;
    expect(request!.headers.get('content-type')).toBe('text/html');
    expect(request!.body).toBe('<p>Hello</p>');
    expect(request!.url.searchParams.get('contactId')).toBe('7f1c7a4e-0c6b-4b8e-9b44-5a8d2c1f0e11');
  });

  it('rejects invalid arguments before calling the API', async () => {
    session = await connect();
    const result = await session.client.callTool({ name: 'get_deal', arguments: { dealId: 'not-a-uuid' } });
    expect(result.isError).toBe(true);
    expect(session.requests).toHaveLength(0);
  });

  it('reports API errors with status and body', async () => {
    session = await connect({ responder: () => json({ message: 'Deal not found' }, 404) });
    const result = await session.client.callTool({ name: 'get_deal', arguments: { dealId: '7f1c7a4e-0c6b-4b8e-9b44-5a8d2c1f0e11' } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('HTTP 404');
    expect(text(result)).toContain('Deal not found');
  });

  it('explains authentication failures', async () => {
    session = await connect({ responder: () => json({ message: 'Unauthorized' }, 401) });
    const result = await session.client.callTool({ name: 'get_tenant_info', arguments: {} });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('SALESSUITE_API_KEY');
  });

  it('reports network failures as tool errors', async () => {
    session = await connect({ fetch: async () => { throw new TypeError('fetch failed'); } });
    const result = await session.client.callTool({ name: 'get_tenant_info', arguments: {} });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('fetch failed');
  });

  it('reports 204 responses as success', async () => {
    session = await connect({ responder: () => new Response(null, { status: 204 }) });
    const result = await session.client.callTool({ name: 'delete_note', arguments: { noteId: '7f1c7a4e-0c6b-4b8e-9b44-5a8d2c1f0e11' } });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain('Success (HTTP 204)');
  });
});

describe('toolsets', () => {
  it('registers only the selected toolsets plus metadata', async () => {
    session = await connect({ toolsets: ['notes'] });
    const names = (await session.client.listTools()).tools.map((t) => t.name);
    expect(names).toContain('create_note');
    expect(names).toContain('list_properties');
    expect(names).toContain('get_api_guide');
    expect(names).not.toContain('create_contact');
    expect(names).not.toContain('describe_webhook_event');
  });

  it('parses SALESSUITE_TOOLSETS', () => {
    expect(parseToolsets(undefined)).toBeUndefined();
    expect(parseToolsets(' all ')).toBeUndefined();
    expect(parseToolsets('Contacts, deals')).toEqual(['contacts', 'deals']);
    expect(() => parseToolsets('contacts,invoices')).toThrow(/invoices/);
  });
});

describe('webhooks', () => {
  it('advertises a compact subscription schema', async () => {
    session = await connect();
    const { tools } = await session.client.listTools();
    for (const name of ['create_webhook_subscription', 'update_webhook_subscription']) {
      const tool = tools.find((t) => t.name === name)!;
      expect(JSON.stringify(tool).length, name).toBeLessThan(2500);
    }
  });

  it('validates the body against the full schema before sending', async () => {
    session = await connect();
    const result = await session.client.callTool({
      name: 'create_webhook_subscription',
      arguments: { body: { hookUrl: 'https://example.com/hook', type: 'deal.stageChanged' } },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Invalid arguments');
    expect(session.requests).toHaveLength(0);
  });

  it('sends a valid subscription', async () => {
    session = await connect({ responder: () => json({ id: 'w1' }, 201) });
    const result = await session.client.callTool({
      name: 'create_webhook_subscription',
      arguments: { body: { hookUrl: 'https://example.com/hook', type: 'contact.created' } },
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(session.requests[0]!.body)).toEqual({ hookUrl: 'https://example.com/hook', type: 'contact.created' });
  });

  it('describes the filter and payload of an event type', async () => {
    session = await connect();
    const result = await session.client.callTool({ name: 'describe_webhook_event', arguments: { type: 'deal.stageChanged' } });
    const described = JSON.parse(text(result));
    expect(described.subscriptionBody.properties.filter).toBeDefined();
    expect(described.subscriptionBody.required).toContain('filter');
    expect(described.payload.type).toBe('object');
  });
});

describe('get_api_guide', () => {
  it('returns the guide and filters sections', async () => {
    session = await connect();
    const full = text(await session.client.callTool({ name: 'get_api_guide', arguments: {} }));
    expect(full).toContain('Rate limiting');
    expect(full).not.toContain('Swagger UI usage');

    const notes = text(await session.client.callTool({ name: 'get_api_guide', arguments: { section: 'rate limit' } }));
    expect(notes).toContain('300 requests per minute');
    expect(notes).not.toContain('Cursor pagination');
  });
});
