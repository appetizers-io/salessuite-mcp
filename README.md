# salessuite-mcp

MCP server for the [SalesSuite](https://salessuite.com) CRM API: contacts, contact persons, deals, pipelines,
notes, calls, emails, forms, action buttons and webhook subscriptions.

The only configuration is your SalesSuite API key; the tenant is derived from it.

## Usage

Create an API key in SalesSuite (*Settings > General*) and add the server to your MCP client.

**Claude Code**

```sh
claude mcp add salessuite --scope user --env SALESSUITE_API_KEY=your-api-key -- npx -y salessuite-mcp
```

Keep the `--` before `npx`: without it, `--env` also swallows the command and the server is registered without
arguments (it then hangs on "connecting"). `--scope user` makes it available in every project.

**Claude Desktop / Cursor / other clients** (`claude_desktop_config.json`, `.cursor/mcp.json`, …)

```json
{
  "mcpServers": {
    "salessuite": {
      "command": "npx",
      "args": ["-y", "salessuite-mcp"],
      "env": { "SALESSUITE_API_KEY": "your-api-key" }
    }
  }
}
```

| Variable | Required | Description |
| --- | --- | --- |
| `SALESSUITE_API_KEY` | yes | SalesSuite API key (sent as `x-api-key`). |
| `SALESSUITE_TOOLSETS` | no | Comma-separated toolsets to load (default: all), e.g. `contacts,deals,notes`. `metadata` is always loaded. |
| `SALESSUITE_READ_ONLY` | no | `true` registers only tools that do not modify data. |
| `SALESSUITE_BASE_URL` | no | Override the API URL (default `https://api.salessuite.com/api`), e.g. for a mock server. |

## Tools

One tool per non-deprecated API operation, plus `get_api_guide`, which returns the API's own documentation (property
identification, note HTML, pagination, archived records, rate limits, webhooks), and `describe_webhook_event`.

| Toolset | Tools |
| --- | --- |
| `metadata` (always on) | `get_tenant_info`, `list_pipelines`, `list_properties`, `list_cards`, `list_users`, `get_user`, `get_user_by_email` |
| `contacts` | `list_contacts`, `search_contacts`, `get_contact`, `get_contact_by_email`, `create_contact`, `upsert_contact_by_email`, `update_contact` |
| `contacts` | `create_contact_person`, `get_contact_person`, `update_contact_person`, `delete_contact_person`, `set_main_contact_person` |
| `deals` | `list_deals`, `list_deals_by_contact`, `find_deals_by_email`, `search_deals`, `get_deal`, `create_deal`, `update_deal` |
| `notes` | `list_notes`, `list_note_feed`, `get_note`, `create_note`, `delete_note` |
| `calls` | `list_call_types`, `list_call_activities`, `list_call_activity_feed`, `get_call_activity`, `create_call_activity`, `delete_call_activity` |
| `emails` | `list_email_activities`, `list_email_activity_feed`, `get_email_activity`, `log_email_activity`, `delete_email_activity` |
| `forms` | `list_forms`, `list_form_submissions` |
| `action_buttons` | `list_trigger_action_buttons`, `list_action_button_executions` |
| `webhooks` | `list_webhook_subscriptions`, `get_webhook_subscription`, `create_webhook_subscription`, `update_webhook_subscription`, `delete_webhook_subscription`, `describe_webhook_event` |

Path and query parameters are top-level tool arguments; request bodies go into `body`.

**Context size.** All tools together take about 24k tokens of tool definitions (measured as JSON at ~3.5 characters
per token); `SALESSUITE_TOOLSETS=contacts,deals,notes` about 16k, `SALESSUITE_READ_ONLY=true` about 13k. The webhook
subscription tools advertise a compact schema; `describe_webhook_event` returns the event-specific filter and payload
schema on demand, and the full generated schema still validates the body before it is sent.

**Custom properties.** The SalesSuite OpenAPI spec is tenant-specific: custom properties appear as extra fields in
the create/update schemas. The bundled schemas only know the system properties, so the create/update payloads of
contacts, contact persons and deals also accept additional keys. Custom properties are keyed by their
`propertyIdentifier`, which starts with `x_` (e.g. `x_budget`); search filters use the full identifier
(e.g. `contact_x_budget`). `list_properties` with `propertyType: "dynamic"` lists them with their value types and select
options.

<<<<<<< Updated upstream
## License

[MIT](LICENSE)
