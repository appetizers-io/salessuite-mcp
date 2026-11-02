import { z } from 'zod';
import type { Client } from './generated/client/index.js';
import * as sdk from './generated/sdk.gen.js';
import * as s from './generated/zod.gen.js';
import { webhookSubscriptionInputBody } from './webhooks.js';

/** Result shape of every generated SDK function when called with `throwOnError: false`. */
type SdkResult = Promise<{ data?: unknown; error?: unknown; response?: Response }>;

/** Any generated SDK function, e.g. `sdk.getDealById`. */
// biome-ignore lint/suspicious/noExplicitAny: must accept every generated SDK function's options type; ToolSpec narrows it per operation.
type AnySdkFn = (options: any) => SdkResult;

/** The request options (`path`, `query`, `body`, …) of a generated SDK function. */
type OptionsOf<F extends AnySdkFn> = NonNullable<Parameters<F>[0]>;

type ZodObjectSchema = z.ZodObject<z.ZodRawShape>;

/** Groups of tools that can be enabled via `SALESSUITE_TOOLSETS`. `metadata` is always enabled. */
export const TOOLSETS = ['metadata', 'contacts', 'deals', 'notes', 'calls', 'emails', 'forms', 'action_buttons', 'webhooks'] as const;
export type Toolset = (typeof TOOLSETS)[number];

export interface ToolDefinition {
  /** MCP tool name (snake_case). */
  name: string;
  toolset: Toolset;
  /** OpenAPI operationId; description, method and path come from the spec. */
  operationId: string;
  /** Flat MCP input schema: path + query params at top level, request body under `body`. */
  inputSchema: ZodObjectSchema;
  pathKeys: readonly string[];
  queryKeys: readonly string[];
  hasBody: boolean;
  call: (client: Client, args: Record<string, unknown>) => SdkResult;
  /** Extra guidance appended to the spec description. */
  hint?: string;
}

/**
 * Binds a generated SDK function to its generated Zod schemas. The schema types are checked against the SDK
 * function's request type, so pairing an operation with the wrong schema fails to compile.
 */
interface ToolSpec<F extends AnySdkFn> {
  name: string;
  operationId: string;
  sdk: F;
  path?: z.ZodType<OptionsOf<F>['path']> & ZodObjectSchema;
  query?: z.ZodType<OptionsOf<F>['query']> & ZodObjectSchema;
  body?: z.ZodType<OptionsOf<F>['body']>;
  /**
   * Smaller schema advertised to the model instead of `body`. `body` then validates the argument before the request
   * is sent. Use only where the full schema is very large.
   */
  inputBody?: z.ZodType;
  bodyDescription?: string;
  hint?: string;
}

export const BODY_KEY = 'body';

function tool<F extends AnySdkFn>(spec: ToolSpec<F>): Omit<ToolDefinition, 'toolset'> {
  const pathKeys = Object.keys(spec.path?.shape ?? {});
  const queryKeys = Object.keys(spec.query?.shape ?? {});
  const keys = [...pathKeys, ...queryKeys];
  if (new Set(keys).size !== keys.length || keys.includes(BODY_KEY)) {
    throw new Error(`Tool ${spec.name}: path/query parameter names collide.`);
  }

  let body = (spec.inputBody ?? spec.body) as z.ZodType | undefined;
  if (body && spec.bodyDescription) body = body.describe(spec.bodyDescription);
  const validateBody = spec.inputBody ? (spec.body as z.ZodType | undefined) : undefined;

  const inputSchema = z.object({
    ...spec.path?.shape,
    ...spec.query?.shape,
    ...(body ? { [BODY_KEY]: body } : {}),
  });

  return {
    name: spec.name,
    operationId: spec.operationId,
    inputSchema,
    pathKeys,
    queryKeys,
    hasBody: body !== undefined,
    hint: spec.hint,
    call: (client, args) =>
      spec.sdk({
        client,
        path: pick(args, pathKeys),
        query: pick(args, queryKeys),
        body: validateBody ? validateBody.parse(args[BODY_KEY]) : args[BODY_KEY],
      }),
  };
}

function pick(args: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> | undefined {
  if (keys.length === 0) return undefined;
  return Object.fromEntries(keys.filter((k) => args[k] !== undefined).map((k) => [k, args[k]]));
}

const CUSTOM_PROPERTIES_NOTE =
  'Besides the listed system properties, tenant-specific custom properties are accepted as additional keys. ' +
  'Use the `propertyIdentifier` (custom ones start with `x_`, e.g. `x_budget`) from `list_properties` with `propertyType: "dynamic"`; ' +
  'its `typeDefinition` gives the value type and, for selects, the option keys.';

/**
 * Lets a property object accept tenant-specific custom properties. The generated schemas come from a tenant without
 * custom properties, and Zod would otherwise silently strip unknown keys.
 */
function withCustomProperties<T extends ZodObjectSchema>(schema: T): T {
  return schema.loose().describe(CUSTOM_PROPERTIES_NOTE) as unknown as T;
}

const createContactBody = s.zCreateContactBody.extend({
  contact: withCustomProperties(s.zCreateContactPropertiesInput),
  contactPerson: withCustomProperties(s.zCreateContactPersonInput),
  additionalContactPersons: z.array(withCustomProperties(s.zCreateContactPersonInput)).optional(),
});

const createOrUpdateContactByEmailBody = s.zCreateOrUpdateContactByEmailBody.extend({
  contact: withCustomProperties(s.zCreateContactPropertiesInput),
  contactPerson: withCustomProperties(s.zCreateContactPersonInput),
});

const ACTIVITY_LISTING_HINT = 'Provide `contactId` or `dealId`. Paginate with the returned `cursor` until it is null.';

export const TOOLS: readonly ToolDefinition[] = [
  ...toolset('metadata', [
    tool({ name: 'get_tenant_info', operationId: 'getAuth', sdk: sdk.getAuth }),
    tool({ name: 'list_pipelines', operationId: 'getPipelines', sdk: sdk.getPipelines, hint: 'Use this to find `phaseId`s for creating or moving deals.' }),
    tool({ name: 'list_properties', operationId: 'getProperties', sdk: sdk.getProperties, query: s.zGetPropertiesQuery, hint: 'Use this to discover property identifiers (incl. custom properties) for search filters and create/update payloads.' }),
    tool({ name: 'list_cards', operationId: 'getCards', sdk: sdk.getCards, query: s.zGetCardsQuery }),
    tool({ name: 'list_users', operationId: 'getUsers', sdk: sdk.getUsers, query: s.zGetUsersQuery }),
    tool({ name: 'get_user', operationId: 'getUserById', sdk: sdk.getUserById, path: s.zGetUserByIdPath }),
    tool({ name: 'get_user_by_email', operationId: 'getUserByEmail', sdk: sdk.getUserByEmail, query: s.zGetUserByEmailQuery }),
  ]),
  ...toolset('contacts', [
    tool({ name: 'list_contacts', operationId: 'getContacts', sdk: sdk.getContacts, query: s.zGetContactsQuery }),
    tool({ name: 'search_contacts', operationId: 'searchContactV2', sdk: sdk.searchContactV2, body: s.zSearchContactV2Body, hint: 'Property identifiers look like `contact_companyName` or `contactPerson_email`; see `list_properties` and `get_api_guide`.' }),
    tool({ name: 'get_contact', operationId: 'getContactById', sdk: sdk.getContactById, path: s.zGetContactByIdPath }),
    tool({ name: 'get_contact_by_email', operationId: 'getContactByEmail', sdk: sdk.getContactByEmail, query: s.zGetContactByEmailQuery }),
    tool({ name: 'create_contact', operationId: 'createContact', sdk: sdk.createContact, body: createContactBody }),
    tool({ name: 'upsert_contact_by_email', operationId: 'createOrUpdateContactByEmail', sdk: sdk.createOrUpdateContactByEmail, body: createOrUpdateContactByEmailBody }),
    tool({ name: 'update_contact', operationId: 'updateContactV2', sdk: sdk.updateContactV2, path: s.zUpdateContactV2Path, query: s.zUpdateContactV2Query, body: withCustomProperties(s.zUpdateContactV2Body) }),
    tool({ name: 'create_contact_person', operationId: 'createContactPerson', sdk: sdk.createContactPerson, body: withCustomProperties(s.zCreateContactPersonBody) }),
    tool({ name: 'get_contact_person', operationId: 'getContactPersonById', sdk: sdk.getContactPersonById, path: s.zGetContactPersonByIdPath }),
    tool({ name: 'update_contact_person', operationId: 'updateContactPerson', sdk: sdk.updateContactPerson, path: s.zUpdateContactPersonPath, body: withCustomProperties(s.zUpdateContactPersonBody) }),
    tool({ name: 'delete_contact_person', operationId: 'deleteContactPerson', sdk: sdk.deleteContactPerson, path: s.zDeleteContactPersonPath }),
    tool({ name: 'set_main_contact_person', operationId: 'setMainContactPerson', sdk: sdk.setMainContactPerson, path: s.zSetMainContactPersonPath }),
  ]),
  ...toolset('deals', [
    tool({ name: 'list_deals', operationId: 'getDeals', sdk: sdk.getDeals, query: s.zGetDealsQuery }),
    tool({ name: 'list_deals_by_contact', operationId: 'getDealsByContactId', sdk: sdk.getDealsByContactId, path: s.zGetDealsByContactIdPath, query: s.zGetDealsByContactIdQuery }),
    tool({ name: 'find_deals_by_email', operationId: 'getDealsByEmail', sdk: sdk.getDealsByEmail, query: s.zGetDealsByEmailQuery }),
    tool({ name: 'search_deals', operationId: 'searchDeals', sdk: sdk.searchDeals, body: s.zSearchDealsBody, hint: 'Property identifiers look like `deal_name` or `contact_companyName`; see `list_properties` and `get_api_guide`.' }),
    tool({ name: 'get_deal', operationId: 'getDealById', sdk: sdk.getDealById, path: s.zGetDealByIdPath }),
    tool({ name: 'create_deal', operationId: 'createDealV2', sdk: sdk.createDealV2, body: withCustomProperties(s.zCreateDealV2Body), hint: 'Get a `phaseId` from `list_pipelines` first.' }),
    tool({ name: 'update_deal', operationId: 'updateDealV2', sdk: sdk.updateDealV2, path: s.zUpdateDealV2Path, query: s.zUpdateDealV2Query, body: withCustomProperties(s.zUpdateDealV2Body) }),
  ]),
  ...toolset('notes', [
    tool({ name: 'list_notes', operationId: 'getNotes', sdk: sdk.getNotes, query: s.zGetNotesQuery, hint: ACTIVITY_LISTING_HINT }),
    tool({ name: 'list_note_feed', operationId: 'getNoteFeed', sdk: sdk.getNoteFeed, query: s.zGetNoteFeedQuery, hint: ACTIVITY_LISTING_HINT }),
    tool({ name: 'get_note', operationId: 'getNoteById', sdk: sdk.getNoteById, path: s.zGetNoteByIdPath }),
    tool({ name: 'create_note', operationId: 'createNote', sdk: sdk.createNote, query: s.zCreateNoteQuery, body: s.zCreateNoteBody, bodyDescription: 'Note content as HTML (see the "Notes" section of `get_api_guide` for supported tags). Plain text without tags is accepted too.' }),
    tool({ name: 'delete_note', operationId: 'deleteNote', sdk: sdk.deleteNote, path: s.zDeleteNotePath }),
  ]),
  ...toolset('calls', [
    tool({ name: 'list_call_types', operationId: 'getCallTypes', sdk: sdk.getCallTypes }),
    tool({ name: 'list_call_activities', operationId: 'getCallActivity', sdk: sdk.getCallActivity, query: s.zGetCallActivityQuery, hint: ACTIVITY_LISTING_HINT }),
    tool({ name: 'list_call_activity_feed', operationId: 'getCallActivityFeed', sdk: sdk.getCallActivityFeed, query: s.zGetCallActivityFeedQuery, hint: ACTIVITY_LISTING_HINT }),
    tool({ name: 'get_call_activity', operationId: 'getCallActivityById', sdk: sdk.getCallActivityById, path: s.zGetCallActivityByIdPath }),
    tool({ name: 'create_call_activity', operationId: 'createCallActivity', sdk: sdk.createCallActivity, body: s.zCreateCallActivityBody }),
    tool({ name: 'delete_call_activity', operationId: 'deleteCallActivity', sdk: sdk.deleteCallActivity, path: s.zDeleteCallActivityPath }),
  ]),
  ...toolset('emails', [
    tool({ name: 'list_email_activities', operationId: 'getEmailActivities', sdk: sdk.getEmailActivities, query: s.zGetEmailActivitiesQuery, hint: ACTIVITY_LISTING_HINT }),
    tool({ name: 'list_email_activity_feed', operationId: 'getEmailActivityFeed', sdk: sdk.getEmailActivityFeed, query: s.zGetEmailActivityFeedQuery, hint: ACTIVITY_LISTING_HINT }),
    tool({ name: 'get_email_activity', operationId: 'getEmailActivityById', sdk: sdk.getEmailActivityById, path: s.zGetEmailActivityByIdPath }),
    tool({ name: 'log_email_activity', operationId: 'createLoggedEmailActivity', sdk: sdk.createLoggedEmailActivity, body: s.zCreateLoggedEmailActivityBody }),
    tool({ name: 'delete_email_activity', operationId: 'deleteEmailActivity', sdk: sdk.deleteEmailActivity, path: s.zDeleteEmailActivityPath }),
  ]),
  ...toolset('forms', [
    tool({ name: 'list_forms', operationId: 'getForms', sdk: sdk.getForms, query: s.zGetFormsQuery }),
    tool({ name: 'list_form_submissions', operationId: 'getFormSubmissions', sdk: sdk.getFormSubmissions, path: s.zGetFormSubmissionsPath, query: s.zGetFormSubmissionsQuery }),
  ]),
  ...toolset('action_buttons', [
    tool({ name: 'list_trigger_action_buttons', operationId: 'getTriggerActionButtons', sdk: sdk.getTriggerActionButtons, query: s.zGetTriggerActionButtonsQuery }),
    tool({ name: 'list_action_button_executions', operationId: 'getActionButtonExecutions', sdk: sdk.getActionButtonExecutions, query: s.zGetActionButtonExecutionsQuery }),
  ]),
  ...toolset('webhooks', [
    tool({ name: 'list_webhook_subscriptions', operationId: 'listSubscriptions', sdk: sdk.listSubscriptions }),
    tool({ name: 'get_webhook_subscription', operationId: 'getSubscription', sdk: sdk.getSubscription, path: s.zGetSubscriptionPath }),
    tool({ name: 'create_webhook_subscription', operationId: 'createSubscription', sdk: sdk.createSubscription, body: s.zCreateSubscriptionBody, inputBody: webhookSubscriptionInputBody }),
    tool({ name: 'update_webhook_subscription', operationId: 'updateSubscription', sdk: sdk.updateSubscription, path: s.zUpdateSubscriptionPath, body: s.zUpdateSubscriptionBody, inputBody: webhookSubscriptionInputBody }),
    tool({ name: 'delete_webhook_subscription', operationId: 'deleteSubscription', sdk: sdk.deleteSubscription, path: s.zDeleteSubscriptionPath }),
  ]),
];

function toolset(name: Toolset, tools: Array<Omit<ToolDefinition, 'toolset'>>): ToolDefinition[] {
  return tools.map((t) => ({ ...t, toolset: name }));
}
