import { createClient, createConfig, type Client } from './generated/client/index.js';

export const DEFAULT_BASE_URL = 'https://api.salessuite.com/api';
const DEFAULT_TIMEOUT_MS = 30_000;

export interface ClientOptions {
  apiKey: string;
  baseUrl?: string;
  userAgent: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/** A Hey API fetch client bound to one SalesSuite tenant (the tenant is derived from the API key). */
export function createSalesSuiteClient(options: ClientOptions): Client {
  const baseFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return createClient(
    createConfig({
      baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
      // Resolved for every operation that declares the `x-api-key` security scheme (all of them).
      auth: () => options.apiKey,
      headers: {
        // Error messages and translated values default to the tenant locale otherwise.
        'x-lang': 'en',
        'user-agent': options.userAgent,
      },
      fetch: (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const signal = request.signal ? AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
        return baseFetch(new Request(request, { signal }));
      },
    }),
  );
}
