// functions/src/payments/application/payment-webhook.handler.ts
// -----------------------------------------------------------------------------
// PAYMENT WEBHOOK HANDLER
// -----------------------------------------------------------------------------
// Entrada pública mínima:
// 1. valida o token do provedor;
// 2. sanitiza o evento;
// 3. persiste o envelope idempotente;
// 4. responde 200 rapidamente.
//
// Settlement, renovação, reversão e cancelamentos rodam de forma assíncrona.
// -----------------------------------------------------------------------------

import * as logger from 'firebase-functions/logger';
import { HttpsError, onRequest } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import {
  AsaasPaymentProvider,
} from '../infrastructure/providers/asaas.provider';
import {
  ASAAS_WEBHOOK_TOKEN,
  resolveAsaasRuntimeConfig,
} from '../config/asaas.config';
import {
  persistVerifiedProviderWebhookEvent,
} from './provider-webhook-inbox.service';

type WebhookHeaderMap = Record<string, string | string[] | undefined>;

function readRawBody(request: {
  rawBody?: Buffer;
  body?: unknown;
}): string {
  if (Buffer.isBuffer(request.rawBody)) {
    return request.rawBody.toString('utf8');
  }

  if (typeof request.body === 'string') {
    return request.body;
  }

  try {
    return JSON.stringify(request.body ?? {});
  } catch {
    return '';
  }
}

function mapWebhookErrorToStatus(error: unknown): number {
  if (!(error instanceof HttpsError)) return 500;

  switch (error.code) {
  case 'invalid-argument':
    return 400;
  case 'unauthenticated':
    return 401;
  case 'permission-denied':
    return 403;
  case 'resource-exhausted':
    return 429;
  default:
    return 500;
  }
}

export const paymentWebhook = onRequest(
  {
    region: FUNCTIONS_REGION,
    timeoutSeconds: 30,
    memory: '256MiB',
    secrets: [ASAAS_WEBHOOK_TOKEN],
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({
        ok: false,
        code: 'method_not_allowed',
      });
      return;
    }

    const rawBody = readRawBody(req);

    try {
      const provider = new AsaasPaymentProvider({
        runtime: resolveAsaasRuntimeConfig(),
        webhookToken: ASAAS_WEBHOOK_TOKEN.value(),
      });

      const verifiedEvent = await provider.verifyWebhook({
        headers: req.headers as WebhookHeaderMap,
        rawBody,
      });

      const persisted = await persistVerifiedProviderWebhookEvent(
        verifiedEvent
      );

      res.status(200).json({
        ok: true,
        accepted: true,
        idempotent: !persisted.created,
      });
    } catch (error: unknown) {
      const statusCode = mapWebhookErrorToStatus(error);

      logger.error('[paymentWebhook] rejected', {
        statusCode,
        errorCode:
          error instanceof HttpsError ? error.code : 'internal',
        errorMessage:
          error instanceof Error
            ? error.message.slice(0, 300)
            : 'Unknown webhook error',
      });

      res.status(statusCode).json({
        ok: false,
        code: 'payment_event_rejected',
      });
    }
  }
);
