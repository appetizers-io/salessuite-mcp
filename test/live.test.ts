/**
 * Runs against the real SalesSuite API. Opt-in:
 *   SALESSUITE_API_KEY=… npm run test:live                         # read-only checks
 *   SALESSUITE_API_KEY=… SALESSUITE_LIVE_WRITE=1 npm run test:live  # also creates a contact (cannot be deleted via the API)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, text } from './helpers.js';

const apiKey = process.env.SALESSUITE_API_KEY;
const enabled = process.env.SALESSUITE_LIVE_TEST === '1' && !!apiKey;
const writes = enabled && process.env.SALESSUITE_LIVE_WRITE === '1';

describe.skipIf(!enabled)('live SalesSuite API', () => {
  let session: Awaited<ReturnType<typeof connect>>;
  beforeAll(async () => {
    session = await connect({ apiKey, fetch: globalThis.fetch });
  });
  afterAll(async () => session?.close());

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await session.client.callTool({ name, arguments: args });
    expect(result.isError, `${name}: ${text(result)}`).toBeFalsy();
    const body = text(result);
    return body.startsWith('Success') ? undefined : JSON.parse(body);
  };

  it('reads tenant metadata', async () => {
    const tenant = await call('get_tenant_info');
    expect(tenant.tenantId).toBeTruthy();
    const properties = await call('list_properties', { cardType: ['Contact'] });
    expect(properties.some((p: { fullPropertyIdentifier: string }) => p.fullPropertyIdentifier === 'contact_companyName')).toBe(true);
    await call('list_users');
    await call('list_call_types');
    await call('list_pipelines');
    await call('list_cards');
  });

  it('searches contacts with a filter', async () => {
    const result = await call('search_contacts', {
      body: {
        pageSize: 5,
        orFilterGroups: [{ andFilterItems: [{ propertyIdentification: 'contact_companyName', condition: { type: 'string', check: 'isNotNull' } }] }],
      },
    });
    expect(result).toBeDefined();
  });

  it.skipIf(!writes)('creates and updates a contact, and manages a note', async () => {
    const stamp = Date.now();
    const created = await call('create_contact', {
      body: {
        contact: { companyName: `MCP Test ${stamp}`, website: 'https://example.com' },
        contactPerson: { firstName: 'Ada', lastName: 'Lovelace', email: `mcp-test-${stamp}@example.com` },
      },
    });
    const contactId: string = created.contact?.id ?? created.id;
    expect(contactId).toBeTruthy();

    const updated = await call('update_contact', { contactId, body: { city: 'Berlin' } });
    expect(JSON.stringify(updated)).toContain('Berlin');

    const byEmail = await call('get_contact_by_email', { email: `mcp-test-${stamp}@example.com` });
    expect(JSON.stringify(byEmail)).toContain(contactId);

    const note = await call('create_note', { contactId, body: '<p>Created by the <strong>salessuite-mcp</strong> live test.</p>' });
    const notes = await call('list_notes', { contactId });
    expect(JSON.stringify(notes)).toContain(note.id);
    await call('delete_note', { noteId: note.id });
  });
});
