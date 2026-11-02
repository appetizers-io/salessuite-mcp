import { readFileSync } from 'node:fs';
import { defineConfig } from '@hey-api/openapi-ts';
import { cleanSpecDescriptions } from './src/text.ts';

/**
 * The SalesSuite spec carries Swagger-UI HTML and anchor links in its descriptions. They are converted to
 * plain Markdown before generation, because the generated Zod metadata becomes the MCP tool input schema
 * that the model reads.
 */
const spec = cleanSpecDescriptions(JSON.parse(readFileSync('./openapi/salessuite.openapi.json', 'utf8')));

export default defineConfig({
  input: spec,
  output: {
    path: './src/generated',
    clean: true,
  },
  plugins: [
    '@hey-api/client-fetch',
    '@hey-api/typescript',
    '@hey-api/sdk',
    {
      name: 'zod',
      metadata: true,
      responses: false,
      dates: { offset: true },
    },
  ],
});
