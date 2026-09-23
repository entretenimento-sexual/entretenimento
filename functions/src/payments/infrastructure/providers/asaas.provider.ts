// functions/src/payments/infrastructure/providers/asaas.provider.ts
// -----------------------------------------------------------------------------
// ASAAS PAYMENT PROVIDER
// -----------------------------------------------------------------------------
// Integração real com o Checkout hospedado e assinaturas recorrentes do Asaas.
//
// Segurança:
// - API key e token de webhook são injetados pelo Secret Manager;
// - API key nunca é usada como token do webhook;
// - cartão é capturado somente na página hospedada pelo Asaas;
// - callback de navegador nunca confirma pagamento;
// - payload bruto do webhook não é persistido.
// -----------------------------------------------------------------------------

import {
  createHash,
  timingSafeEqual,
} from 'node:crypto';

import { HttpsError } from 'firebase-functions/v2/https';

import {
  CreateCheckoutInput,
  CreateCheckoutResult,
  PaymentProviderPort,
  ProviderWebhookInput,
} from '../../domain/payment-provider.port';
import type {
  VerifiedProviderWebhookEvent,
} from '../../domain/provider-webhook.model';
import {
  assertAsaasApiKeyMatchesEnvironment,
  type AsaasRuntimeConfig,
} from '../../config/asaas.config';

interface AsaasProviderOptions {
  runtime: AsaasRuntimeConfig;
  apiKey?: string | null;
  webhookToken?: string | null;
}

interface AsaasApiErrorPayload {
  errors?: Array<{
    code?: unknown;
    description?: unknown;
  }>;
}

interface AsaasCheckoutResponse {
  id?: unknown;
}

const ASAAS_REQUEST_TIMEOUT_MS = 60_000;
const MIN_CHECKOUT_EXPIRATION_MINUTES = 10;
const MAX_CHECKOUT_EXPIRATION_MINUTES = 1_440;

function normalizedSecret(value: unknown): string {
  return String(value ?? '').trim();
}

function safeString(value: unknown, maximum = 240): string | null {
  const normalized = String(value ?? '').trim().slice(0, maximum);
  return normalized || null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : null;
}

function toCents(value: unknown): number | null {
  const amount = finiteNumber(value);
  return amount === null ? null : Math.round(amount * 100);
}

function normalizeAsaasTimestamp(value: unknown): number | null {
  const text = safeString(value, 80);
  if (!text) return null;

  const normalized =
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
      ? `${text.replace(' ', 'T')}-03:00`
      : text;

  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatAsaasLocalDateTime(epochMs: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(epochMs));

  const byType = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );

  return (
    `${byType['year']}-${byType['month']}-${byType['day']} ` +
    `${byType['hour']}:${byType['minute']}:${byType['second']}`
  );
}

function resolveMinutesToExpire(expiresAt: number, now = Date.now()): number {
  const remainingMs = Math.max(0, expiresAt - now);
  const minutes = Math.ceil(remainingMs / 60_000);

  if (minutes < MIN_CHECKOUT_EXPIRATION_MINUTES) {
    throw new HttpsError(
      'failed-precondition',
      'A janela segura deste checkout já está próxima do vencimento.'
    );
  }

  return Math.min(minutes, MAX_CHECKOUT_EXPIRATION_MINUTES);
}

function safeEqualSecret(expected: string, supplied: string): boolean {
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const suppliedBuffer = Buffer.from(supplied, 'utf8');

  if (
    expectedBuffer.length === 0 ||
    expectedBuffer.length !== suppliedBuffer.length
  ) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, suppliedBuffer);
}

function firstHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string {
  const raw = headers[name.toLowerCase()];
  return Array.isArray(raw)
    ? String(raw[0] ?? '').trim()
    : String(raw ?? '').trim();
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeWebhookResource(
  eventName: string,
  body: Record<string, unknown>
): Omit<
  VerifiedProviderWebhookEvent,
  | 'provider'
  | 'providerEventId'
  | 'eventName'
  | 'occurredAt'
  | 'receivedAt'
  | 'verified'
  | 'verificationMode'
  | 'sanitizedPayloadHash'
> {
  const checkout = normalizeRecord(body['checkout']);
  const subscription = normalizeRecord(body['subscription']);
  const payment = normalizeRecord(body['payment']);

  if (eventName.startsWith('CHECKOUT_')) {
    return {
      resourceType: 'checkout',
      resourceId: safeString(checkout['id']) ?? '',
      checkoutId: safeString(checkout['id']),
      subscriptionId: null,
      paymentId: null,
      customerId: safeString(checkout['customer']),
      externalReference: safeString(checkout['externalReference'], 200),
      amountCents: null,
      currency: 'BRL',
      providerStatus: safeString(checkout['status'], 80),
    };
  }

  if (eventName.startsWith('SUBSCRIPTION_')) {
    return {
      resourceType: 'subscription',
      resourceId: safeString(subscription['id']) ?? '',
      checkoutId: null,
      subscriptionId: safeString(subscription['id']),
      paymentId: null,
      customerId: safeString(subscription['customer']),
      externalReference: safeString(
        subscription['externalReference'],
        200
      ),
      amountCents: toCents(subscription['value']),
      currency: 'BRL',
      providerStatus: safeString(subscription['status'], 80),
    };
  }

  if (eventName.startsWith('PAYMENT_')) {
    return {
      resourceType: 'payment',
      resourceId: safeString(payment['id']) ?? '',
      checkoutId: null,
      subscriptionId: safeString(payment['subscription']),
      paymentId: safeString(payment['id']),
      customerId: safeString(payment['customer']),
      externalReference: safeString(payment['externalReference'], 200),
      amountCents: toCents(payment['value']),
      currency: 'BRL',
      providerStatus: safeString(payment['status'], 80),
    };
  }

  return {
    resourceType: 'other',
    resourceId: safeString(body['id']) ?? eventName,
    checkoutId: null,
    subscriptionId: null,
    paymentId: null,
    customerId: null,
    externalReference: null,
    amountCents: null,
    currency: 'BRL',
    providerStatus: null,
  };
}

function resolveWebhookOccurredAt(
  eventName: string,
  body: Record<string, unknown>,
  receivedAt: number
): number {
  const payment = normalizeRecord(body['payment']);
  const subscription = normalizeRecord(body['subscription']);
  const checkout = normalizeRecord(body['checkout']);

  const candidates = eventName.startsWith('PAYMENT_')
    ? [
      body['dateCreated'],
      payment['confirmedDate'],
      payment['paymentDate'],
      payment['clientPaymentDate'],
      payment['dateCreated'],
    ]
    : eventName.startsWith('SUBSCRIPTION_')
      ? [subscription['dateCreated'], body['dateCreated']]
      : [checkout['dateCreated'], body['dateCreated']];

  for (const candidate of candidates) {
    const parsed = normalizeAsaasTimestamp(candidate);
    if (parsed !== null) return parsed;
  }

  return receivedAt;
}

function parseAsaasApiError(
  status: number,
  payload: unknown
): HttpsError {
  const body = normalizeRecord(payload) as AsaasApiErrorPayload;
  const first = Array.isArray(body.errors) ? body.errors[0] : undefined;
  const description = safeString(first?.description, 500)
    ?? 'O provedor de pagamento rejeitou a operação.';

  if (status === 400) {
    return new HttpsError('invalid-argument', description);
  }
  if (status === 401 || status === 403) {
    return new HttpsError(
      'failed-precondition',
      'A autenticação do provedor de pagamento não está válida.'
    );
  }
  if (status === 404) {
    return new HttpsError('not-found', 'Recurso financeiro não localizado.');
  }
  if (status === 429) {
    return new HttpsError(
      'resource-exhausted',
      'O provedor de pagamento está limitando solicitações temporariamente.'
    );
  }

  return new HttpsError(
    'unavailable',
    'O provedor de pagamento está temporariamente indisponível.'
  );
}

export class AsaasPaymentProvider extends PaymentProviderPort {
  readonly providerId = 'asaas' as const;

  private readonly runtime: AsaasRuntimeConfig;
  private readonly apiKey: string;
  private readonly webhookToken: string;

  constructor(options: AsaasProviderOptions) {
    super();
    this.runtime = options.runtime;
    this.apiKey = normalizedSecret(options.apiKey);
    this.webhookToken = normalizedSecret(options.webhookToken);
  }

  async createCheckoutSession(
    input: CreateCheckoutInput
  ): Promise<CreateCheckoutResult> {
    const apiKey = this.requireApiKey();
    const minutesToExpire = resolveMinutesToExpire(input.expiresAt);

    const body = {
      billingTypes: ['CREDIT_CARD'],
      chargeTypes: ['RECURRENT'],
      minutesToExpire,
      externalReference: input.checkoutSessionId,
      callback: {
        successUrl: input.successUrl,
        cancelUrl: input.cancelUrl,
        expiredUrl: input.expiredUrl,
      },
      items: [
        {
          name: input.planSnapshot?.title ?? 'Assinatura da plataforma',
          description:
            input.planSnapshot?.description ?? 'Assinatura mensal',
          quantity: 1,
          value: input.amountCents / 100,
        },
      ],
      subscription: {
        cycle: 'MONTHLY',
        nextDueDate: formatAsaasLocalDateTime(Date.now()),
      },
    };

    const response = await this.request<AsaasCheckoutResponse>(
      '/checkouts',
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
      apiKey
    );

    const providerSessionId = safeString(response.id, 200);
    if (!providerSessionId) {
      throw new HttpsError(
        'unavailable',
        'O Asaas não retornou um identificador de checkout válido.'
      );
    }

    const checkoutUrl = new URL(this.runtime.checkoutBaseUrl);
    checkoutUrl.searchParams.set('id', providerSessionId);

    return {
      provider: this.providerId,
      providerSessionId,
      checkoutUrl: checkoutUrl.toString(),
      expiresAt: input.expiresAt,
    };
  }

  async cancelCheckoutSession(
    providerSessionId: string
  ): Promise<void> {
    const apiKey = this.requireApiKey();
    const id = this.requireProviderId(providerSessionId, 'checkout');

    await this.request(
      `/checkouts/${encodeURIComponent(id)}/cancel`,
      { method: 'POST' },
      apiKey
    );
  }

  async cancelRecurringSubscription(
    providerSubscriptionId: string
  ): Promise<void> {
    const apiKey = this.requireApiKey();
    const id = this.requireProviderId(
      providerSubscriptionId,
      'subscription'
    );

    await this.request(
      `/subscriptions/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
      apiKey
    );
  }

  async verifyWebhook(
    input: ProviderWebhookInput
  ): Promise<VerifiedProviderWebhookEvent> {
    const expected = this.webhookToken;
    const supplied = firstHeader(input.headers, 'asaas-access-token');

    if (expected.length < 32 || expected.length > 255) {
      throw new HttpsError(
        'failed-precondition',
        'ASAAS_WEBHOOK_TOKEN possui configuração inválida.'
      );
    }

    if (!safeEqualSecret(expected, supplied)) {
      throw new HttpsError(
        'permission-denied',
        'Webhook financeiro sem autenticação válida.'
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(input.rawBody);
    } catch {
      throw new HttpsError(
        'invalid-argument',
        'Payload de webhook financeiro inválido.'
      );
    }

    const body = normalizeRecord(parsed);
    const providerEventId = safeString(body['id'], 240);
    const eventName = safeString(body['event'], 120);
    const receivedAt = Date.now();

    if (!providerEventId || !eventName) {
      throw new HttpsError(
        'invalid-argument',
        'Webhook financeiro sem identificadores obrigatórios.'
      );
    }

    const resource = normalizeWebhookResource(eventName, body);
    if (!resource.resourceId) {
      throw new HttpsError(
        'invalid-argument',
        'Webhook financeiro sem recurso identificável.'
      );
    }

    return {
      provider: 'asaas',
      providerEventId,
      eventName,
      ...resource,
      occurredAt: resolveWebhookOccurredAt(
        eventName,
        body,
        receivedAt
      ),
      receivedAt,
      verified: true,
      verificationMode: 'verified_webhook_token',
      sanitizedPayloadHash: createHash('sha256')
        .update(input.rawBody)
        .digest('hex'),
    };
  }

  private requireApiKey(): string {
    if (!this.apiKey) {
      throw new HttpsError(
        'failed-precondition',
        'ASAAS_API_KEY não está configurada.'
      );
    }

    assertAsaasApiKeyMatchesEnvironment(
      this.apiKey,
      this.runtime.environment
    );
    return this.apiKey;
  }

  private requireProviderId(
    rawValue: unknown,
    kind: 'checkout' | 'subscription'
  ): string {
    const id = safeString(rawValue, 240);
    if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) {
      throw new HttpsError(
        'invalid-argument',
        `Identificador de ${kind} inválido.`
      );
    }
    return id;
  }

  private async request<T = Record<string, unknown>>(
    path: string,
    init: RequestInit,
    apiKey: string
  ): Promise<T> {
    const response = await fetch(
      `${this.runtime.apiBaseUrl}${path}`,
      {
        ...init,
        signal: AbortSignal.timeout(ASAAS_REQUEST_TIMEOUT_MS),
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'user-agent':
            `Entretenimento/1.0 (Firebase Functions; ${this.runtime.environment})`,
          access_token: apiKey,
          ...(init.headers ?? {}),
        },
      }
    );

    const text = await response.text();
    let payload: unknown = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = {};
      }
    }

    if (!response.ok) {
      throw parseAsaasApiError(response.status, payload);
    }

    return payload as T;
  }
}
