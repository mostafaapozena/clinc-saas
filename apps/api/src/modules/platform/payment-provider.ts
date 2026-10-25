import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../../http/errors.js';
import { clock } from '../../time/clock.js';
import { SimulatorSubscriptionModel } from './billing.model.js';

// The payment-provider boundary (docs/architecture/SUBSCRIPTIONS.md). The rest of the platform only
// sees verified ProviderEvents and provider-side subscription state; it never trusts the browser
// about money and never handles card data. The only implementation today is the SIMULATOR: a
// clearly labelled stand-in that signs its webhooks like a real provider would, so verification,
// replay protection, dedupe, ordering and reconciliation are exercised for real. A real provider
// (B5) implements the same interface with its own signature scheme and API calls.

export type ProviderEvent = { id: string; type: string; occurredAt: Date; data: Record<string, unknown> };
export type ProviderSubscriptionState = { status: 'active' | 'past_due' | 'canceled'; currentPeriodEnd: Date } | null;

export interface PaymentProvider {
  readonly name: 'simulator';
  /** Verifies the signature and freshness of a raw webhook body; throws 400 when invalid. */
  verifyWebhook(rawBody: Buffer, signatureHeader: string | undefined): ProviderEvent;
  /** The provider's own view of a subscription, used by reconciliation. */
  fetchSubscription(providerSubscriptionId: string): Promise<ProviderSubscriptionState>;
}

export const SIMULATOR_SIGNATURE_HEADER = 'x-raclinic-simulator-signature';
/** Signatures older or newer than this are refused (replay protection on top of event-id dedupe). */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

const invalid = (reason: string) => new HttpError(400, 'WEBHOOK_SIGNATURE_INVALID', `Webhook rejected: ${reason}`);

export function signSimulatorPayload(secret: string, rawBody: string, timestamp = Math.floor(clock.now().getTime() / 1000)) {
  const v1 = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

export function createSimulatorProvider(secret: string): PaymentProvider {
  return {
    name: 'simulator',
    verifyWebhook(rawBody, header) {
      if (!header) throw invalid('missing signature');
      const parts = Object.fromEntries(
        header.split(',').map((part) => {
          const i = part.indexOf('=');
          return [part.slice(0, i).trim(), part.slice(i + 1).trim()];
        }),
      );
      const t = Number(parts.t);
      const v1 = parts.v1 ?? '';
      if (!Number.isInteger(t) || !/^[0-9a-f]{64}$/.test(v1)) throw invalid('malformed signature');
      const age = Math.abs(clock.now().getTime() / 1000 - t);
      if (age > WEBHOOK_TOLERANCE_SECONDS) throw invalid('timestamp outside tolerance');
      const expected = createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest();
      const given = Buffer.from(v1, 'hex');
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw invalid('signature mismatch');
      let body: unknown;
      try {
        body = JSON.parse(rawBody.toString('utf8'));
      } catch {
        throw invalid('body is not JSON');
      }
      if (typeof body !== 'object' || body === null) throw invalid('body is not an event');
      const { id, type, occurredAt, data } = body as Record<string, unknown>;
      if (typeof id !== 'string' || !/^evt_[A-Za-z0-9_]{6,80}$/.test(id) || typeof type !== 'string' || type.length > 60)
        throw invalid('event shape');
      if (typeof occurredAt !== 'string' || Number.isNaN(Date.parse(occurredAt))) throw invalid('event time');
      if (typeof data !== 'object' || data === null || Array.isArray(data)) throw invalid('event data');
      return { id, type, occurredAt: new Date(occurredAt), data: data as Record<string, unknown> };
    },
    async fetchSubscription(providerSubscriptionId) {
      const record = await SimulatorSubscriptionModel.findOne({ providerSubscriptionId }).lean();
      return record ? { status: record.status, currentPeriodEnd: record.currentPeriodEnd } : null;
    },
  };
}

export const newSimulatorId = (prefix: 'evt_sim' | 'sub_sim') => `${prefix}_${randomBytes(12).toString('hex')}`;

/** Builds a simulator event body and its signature header, exactly as an HTTP delivery would carry them. */
export function simulatorDelivery(
  secret: string,
  type: string,
  data: Record<string, unknown>,
  occurredAt = clock.now(),
  id = newSimulatorId('evt_sim'),
) {
  const raw = JSON.stringify({ id, type, occurredAt: occurredAt.toISOString(), data, simulator: true });
  return { id, raw: Buffer.from(raw), signature: signSimulatorPayload(secret, raw) };
}
