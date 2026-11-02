import { z } from 'zod';
import * as s from './generated/zod.gen.js';

/** Payload schema per webhook event type. A test checks that the keys match the event types of the API. */
export const WEBHOOK_PAYLOADS = {
  'contact.created': s.zWebhookContactCreatedPayload,
  'contact.propertyChanged': s.zWebhookContactPropertyChangedPayload,
  'deal.created': s.zWebhookDealCreatedPayload,
  'deal.propertyChanged': s.zWebhookDealPropertyChangedPayload,
  'deal.stageChanged': s.zWebhookDealStageChangedPayload,
  'activity.created': s.zWebhookActivityCreatedPayload,
  'form.submitted': s.zWebhookFormSubmittedPayload,
  'actionButton.executed': s.zWebhookActionButtonExecutedPayload,
} as const;

export type WebhookEventType = keyof typeof WEBHOOK_PAYLOADS;
export const WEBHOOK_EVENT_TYPES = Object.keys(WEBHOOK_PAYLOADS) as [WebhookEventType, ...WebhookEventType[]];

type SubscriptionVariant = z.ZodObject<{ type: z.ZodEnum; hookUrl: z.ZodType; filter: z.ZodType }>;

/** The event types declared by the generated subscription schema (one union member per event type). */
export function subscriptionEventTypes(): string[] {
  return (s.zCreateSubscriptionBody.options as readonly SubscriptionVariant[]).flatMap((option) => option.shape.type.options as string[]);
}

/**
 * Compact advertised input schema for create/update subscription. The full schema is a union over all event types with
 * large filter schemas (~6k tokens); the exact filter shape for one event is available via `describe_webhook_event`,
 * and the full generated schema still validates the body before the request is sent.
 */
export const webhookSubscriptionInputBody = z
  .object({
    hookUrl: z.url().describe('HTTPS URL that receives the webhook payload. Must be publicly reachable.'),
    type: z.enum(WEBHOOK_EVENT_TYPES).describe('The webhook event type.'),
    filter: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Event-specific filter. Required for every type except `contact.created`. Call `describe_webhook_event` for its exact shape.'),
  })
  .describe('Webhook subscription. Call `describe_webhook_event` with the event type first to get the filter schema and payload format.');

/** JSON Schemas of the subscription body (incl. filter) and the delivered payload for one event type. */
export function describeWebhookEvent(type: WebhookEventType): { type: WebhookEventType; subscriptionBody: unknown; payload: unknown } {
  const variant = (s.zCreateSubscriptionBody.options as readonly SubscriptionVariant[]).find((option) =>
    (option.shape.type.options as string[]).includes(type),
  );
  if (!variant) throw new Error(`Unknown webhook event type: ${type}`);
  return {
    type,
    subscriptionBody: z.toJSONSchema(variant, { io: 'input', unrepresentable: 'any' }),
    payload: z.toJSONSchema(WEBHOOK_PAYLOADS[type], { unrepresentable: 'any' }),
  };
}
