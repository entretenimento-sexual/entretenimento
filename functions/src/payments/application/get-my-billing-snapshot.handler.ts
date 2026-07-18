// functions/src/payments/application/get-my-billing-snapshot.handler.ts
// -----------------------------------------------------------------------------
// GET MY BILLING SNAPSHOT HANDLER
// -----------------------------------------------------------------------------
//
// Consulta consolidada do estado de acesso financeiro do usuário autenticado.
//
// Responsabilidade:
// - devolver ao frontend o estado atual de assinatura da plataforma;
// - usar entitlement ativo como fonte autorizativa de acesso pago;
// - manter compatibilidade com o contrato atual do frontend;
// - não expor documentos financeiros completos, IDs internos de transação,
//   auditoria, payloads ou informações de provedor.
//
// Segurança:
// - users/{uid}.role, tier e isSubscriber são apenas projeções rápidas;
// - entitlement ativo, vigente e pertencente ao UID é a confirmação de acesso;
// - eventual divergência entre projeção e entitlement não concede acesso;
// - nenhum parâmetro financeiro é recebido do frontend.
//
// Escalabilidade:
// - a assinatura da plataforma possui entitlement determinístico por usuário;
// - isso evita query ampla no retorno de billing;
// - novos escopos, como creator_subscription ou paid_media, poderão ganhar
//   snapshots próprios sem misturar regras de autorização.

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { PlatformRole } from '../domain/billing.model';
import {
  getActivePlatformSubscriptionEntitlement,
} from './platform-subscription-entitlement.service';

interface BillingSnapshotResponse {
  role?: PlatformRole | null;
  tier?: PlatformRole | null;
  isSubscriber: boolean;
  entitlements: string[];
  updatedAt?: number | null;
}

export const getMyBillingSnapshot = onCall<Record<string, never>>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<BillingSnapshotResponse> => {
    const uid = request.auth?.uid ?? null;

    if (!uid) {
      throw new HttpsError(
        'unauthenticated',
        'Usuário não autenticado.'
      );
    }

    const platformEntitlement =
      await getActivePlatformSubscriptionEntitlement(uid);

    if (!platformEntitlement.active || !platformEntitlement.role) {
      return {
        role: null,
        tier: null,
        isSubscriber: false,
        entitlements: [],
        updatedAt: platformEntitlement.updatedAt,
      };
    }

    return {
      role: platformEntitlement.role,
      tier: platformEntitlement.role,
      isSubscriber: true,
      entitlements: ['platform_subscription'],
      updatedAt: platformEntitlement.updatedAt,
    };
  }
);
