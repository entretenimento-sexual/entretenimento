// functions/src/payments/application/payment-webhook.handler.ts
// -----------------------------------------------------------------------------
// PAYMENT WEBHOOK HANDLER
// -----------------------------------------------------------------------------
//
// Endpoint público de entrada para eventos enviados por provedores de
// pagamento.
//
// Responsabilidade:
// - receber a requisição externa do provedor;
// - selecionar o adaptador correspondente;
// - exigir verificação segura do webhook no adaptador;
// - encaminhar somente VerifiedPaymentEvent para PaymentSettlementService;
// - responder de forma idempotente e sem expor dados sensíveis.
//
// Segurança:
// - body, query string e headers não comprovam pagamento por si próprios;
// - status "paid" recebido diretamente não é confiável;
// - retorno do navegador não passa por este endpoint;
// - payload bruto não é persistido;
// - dados financeiros sensíveis não são devolvidos na resposta;
// - enquanto AsaasPaymentProvider não validar assinatura real, o endpoint
//   falha fechado e não concede acesso.
//
// Emulator:
// - a simulação local NÃO ocorre aqui;
// - a simulação controlada permanece em processBillingReturn, protegida pelo
//   Functions Emulator Runtime;
// - isso evita múltiplas rotas de desenvolvimento capazes de conceder acesso.
//
// Evolução futura:
// - separar endpoints por provedor caso necessário;
// - validar assinatura/segredo do Asaas via Secret Manager;
// - suportar refund e chargeback com settlement reverso;
// - persistir somente hash sanitizado do evento para auditoria.

import * as logger from 'firebase-functions/logger';
import { HttpsError, onRequest } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';

import {
  PaymentProviderPort,
  ProviderWebhookInput,
} from '../domain/payment-provider.port';

import {
  VerifiedPaymentEvent,
} from '../domain/billing.model';

import {
  AsaasPaymentProvider,
} from '../infrastructure/providers/asaas.provider';

import {
  settleVerifiedPaidEvent,
} from './payment-settlement.service';

type WebhookHeaderMap = Record<string, string | string[] | undefined>;

function getHeaderValue(
  headers: WebhookHeaderMap,
  headerName: string
): string | null {
  const value = headers[headerName.toLowerCase()];

  if (Array.isArray(value)) {
    return String(value[0] ?? '').trim() || null;
  }

  return typeof value === 'string' && value.trim()
    ? value.trim()
    : null;
}

function readRawBody(request: {
  rawBody?: Buffer;
  body?: unknown;
}): string {
  /**
   * Em Cloud Functions, rawBody preserva o conteúdo necessário para futura
   * validação criptográfica da assinatura do provider.
   *
   * O fallback existe apenas para robustez local; um provider real deverá
   * exigir o rawBody correto antes de aceitar qualquer evento.
   */
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

function resolveProvider(
  headers: WebhookHeaderMap
): PaymentProviderPort {
  /**
   * Por ora, o endpoint está reservado ao futuro webhook real do Asaas.
   *
   * O header pode ajudar no roteamento futuro, mas não serve como prova de
   * origem. A confiança financeira só poderá vir de verifyWebhook().
   */
  const requestedProvider =
    getHeaderValue(headers, 'x-billing-provider')?.toLowerCase() ??
    'asaas';

  if (requestedProvider !== 'asaas') {
    throw new HttpsError(
      'invalid-argument',
      'Provedor de pagamento não suportado.'
    );
  }

  return new AsaasPaymentProvider();
}

function assertSupportedFinancialEvent(
  event: VerifiedPaymentEvent
): void {
  if (event.financialStatus === 'paid') {
    return;
  }

  /**
   * Refund e chargeback exigirão processador reverso próprio:
   * - revogar entitlement;
   * - ajustar assinatura;
   * - gerar auditoria;
   * - eventualmente bloquear saldo/saque futuro.
   *
   * Até essa camada existir, o sistema não confirma silenciosamente eventos
   * reversos nem altera acesso parcialmente.
   */
  throw new HttpsError(
    'failed-precondition',
    'Evento financeiro reverso ainda não possui processamento seguro habilitado.'
  );
}

function mapWebhookErrorToStatus(error: unknown): number {
  if (!(error instanceof HttpsError)) {
    /**
     * Enquanto o provider real ainda não está configurado, o placeholder
     * lança Error e a operação deve permanecer indisponível.
     */
    return 503;
  }

  switch (error.code) {
  case 'invalid-argument':
    return 400;

  case 'unauthenticated':
    return 401;

  case 'permission-denied':
    return 403;

  case 'not-found':
    return 404;

  case 'already-exists':
  case 'failed-precondition':
    return 409;

  default:
    return 500;
  }
}

function buildProviderWebhookInput(
  headers: WebhookHeaderMap,
  rawBody: string
): ProviderWebhookInput {
  return {
    headers,
    rawBody,
  };
}

export const paymentWebhook = onRequest(
  {
    region: FUNCTIONS_REGION,
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({
        ok: false,
        code: 'method_not_allowed',
      });
      return;
    }

    const headers = req.headers as WebhookHeaderMap;
    const rawBody = readRawBody(req);

    try {
      const provider = resolveProvider(headers);

      /**
       * Ponto de confiança do fluxo:
       *
       * - nenhum campo recebido é usado para conceder acesso antes daqui;
       * - AsaasPaymentProvider atual falha fechado;
       * - futuramente verifyWebhook() deverá validar assinatura/segredo e
       *   construir VerifiedPaymentEvent com valor, moeda e IDs confiáveis.
       */
      const verifiedEvent = await provider.verifyWebhook(
        buildProviderWebhookInput(headers, rawBody)
      );

      assertSupportedFinancialEvent(verifiedEvent);

      const settlement = await settleVerifiedPaidEvent(verifiedEvent);

      /**
       * Resposta mínima ao provider.
       * Não devolvemos uid, role, plano, valores ou dados de entitlement.
       */
      res.status(200).json({
        ok: true,
        processed: settlement.processed,
        idempotent: settlement.idempotent,
      });
    } catch (error: unknown) {
      const statusCode = mapWebhookErrorToStatus(error);

      /**
       * Não logamos body, headers completos ou dados pessoais.
       * O log técnico registra apenas informações necessárias para diagnóstico.
       */
      logger.error('[paymentWebhook] rejected or unavailable', {
        statusCode,
        errorCode:
          error instanceof HttpsError
            ? error.code
            : 'provider_not_configured_or_internal_error',
        errorMessage:
          error instanceof Error
            ? error.message
            : 'Unknown webhook error',
      });

      res.status(statusCode).json({
        ok: false,
        code:
          statusCode === 503
            ? 'payment_provider_not_configured'
            : 'payment_event_rejected',
      });
    }
  }
);