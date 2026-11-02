/**
 * Downloads the SalesSuite OpenAPI spec into openapi/salessuite.openapi.json and regenerates src/generated.
 *
 *   SALESSUITE_API_KEY=… npm run update-spec
 *
 * The spec is tenant-specific (custom properties, tenant links). Tenant identifiers are replaced with placeholders
 * so the committed file is generic. Use the API key of a tenant without custom properties.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { DEFAULT_BASE_URL } from '../src/client.ts';

const apiKey = process.env.SALESSUITE_API_KEY?.trim();
if (!apiKey) {
  console.error('SALESSUITE_API_KEY is required.');
  process.exit(1);
}
const baseUrl = process.env.SALESSUITE_BASE_URL?.trim() || DEFAULT_BASE_URL;
const headers = { 'x-api-key': apiKey, accept: 'application/json' };

const auth = await fetchJson<{ tenantId: string; name: string }>(`${baseUrl}/v1/auth`);
const spec = await fetchJson<{ info: { version: string; description?: string }; servers?: Array<{ description?: string }> }>(
  `${baseUrl}/openapi-schema.json?lang=en`,
);

// The description starts with a block naming the API key and tenant of the session that fetched it.
spec.info.description = spec.info.description?.replace(/<p><strong>Active OpenAPI session<\/strong><\/p>\s*<ul>[\s\S]*?<\/ul>/, '');
let output = JSON.stringify(spec, null, 2);
output = output.split(auth.tenantId).join('{tenantId}').split(auth.name).join('{tenantName}');
if (output.includes(apiKey)) throw new Error('Refusing to write a spec that contains the API key.');

writeFileSync('openapi/salessuite.openapi.json', `${output}\n`);
console.log(`Saved SalesSuite API spec ${spec.info.version} to openapi/salessuite.openapi.json`);

execFileSync('npx', ['openapi-ts'], { stdio: 'inherit' });

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`GET ${url} failed: HTTP ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}
