import { readFileSync } from 'node:fs';
import { cleanSpecDescriptions, toMarkdown } from './text.js';

export interface OperationInfo {
  operationId: string;
  method: string;
  path: string;
  summary: string;
  description: string;
  tag: string;
  deprecated: boolean;
}

export interface SpecIndex {
  version: string;
  operations: Map<string, OperationInfo>;
  /** The API's own guide (data model, property identification, pagination, rate limits, …) as Markdown. */
  guide: string;
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/** Swagger-UI specific sections of the API guide that are irrelevant for an MCP client. */
const IRRELEVANT_GUIDE_SECTIONS = ['Swagger UI usage', 'OpenAPI schema', 'Quick start'];

/** The bundled spec the client code in `src/generated` was generated from. */
export const BUNDLED_SPEC_URL = new URL('../openapi/salessuite.openapi.json', import.meta.url);

let cached: SpecIndex | undefined;

export function loadSpecIndex(): SpecIndex {
  cached ??= indexSpec(JSON.parse(readFileSync(BUNDLED_SPEC_URL, 'utf8')));
  return cached;
}

export function indexSpec(raw: unknown): SpecIndex {
  const spec = cleanSpecDescriptions(raw) as {
    info?: { version?: string; description?: string };
    paths?: Record<string, Record<string, Record<string, unknown>>>;
  };
  const operations = new Map<string, OperationInfo>();
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!op || typeof op.operationId !== 'string') continue;
      operations.set(op.operationId, {
        operationId: op.operationId,
        method: method.toUpperCase(),
        path,
        summary: typeof op.summary === 'string' ? op.summary : '',
        description: typeof op.description === 'string' ? op.description : '',
        tag: Array.isArray(op.tags) && typeof op.tags[0] === 'string' ? op.tags[0] : 'General',
        deprecated: op.deprecated === true,
      });
    }
  }
  return { version: spec.info?.version ?? 'unknown', operations, guide: buildGuide(spec.info?.description) };
}

function buildGuide(description: string | undefined): string {
  // `description` was already converted to Markdown by cleanSpecDescriptions; drop navigation and Swagger-only sections.
  const sections = toMarkdown(description)
    .split(/\n(?=#{1,2} )/)
    .filter((section) => section.startsWith('#'))
    .filter((section) => !IRRELEVANT_GUIDE_SECTIONS.some((name) => section.replace(/^#+ /, '').startsWith(name)));
  return sections.join('\n\n').trim();
}
