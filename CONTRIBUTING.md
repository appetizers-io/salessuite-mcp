# Contributing

## Development

```sh
npm install
npm test             # unit + MCP integration tests (mocked HTTP)
npm run typecheck
npm run build        # → dist/
```

The API client, types and Zod schemas in `src/generated/` are generated with
[Hey API](https://heyapi.dev) (`@hey-api/openapi-ts`) from `openapi/salessuite.openapi.json`. Do not edit them by hand.

```sh
npm run generate                                  # regenerate from the committed spec
SALESSUITE_API_KEY=… npm run update-spec          # download the latest spec (tenant IDs replaced) and regenerate
```

`src/tools.ts` maps each generated SDK function to its generated Zod schemas; the types are checked against each
other, so pairing an operation with the wrong schema fails to compile. A test fails when the spec gains an
operation without a tool.

Live tests against the real API (opt-in):

```sh
SALESSUITE_API_KEY=… npm run test:live                          # read-only
SALESSUITE_API_KEY=… SALESSUITE_LIVE_WRITE=1 npm run test:live  # also creates a test contact (contacts cannot be deleted via the API)
```

Run the server locally with the [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```sh
npm run build && SALESSUITE_API_KEY=… npx @modelcontextprotocol/inspector node dist/index.js
```
