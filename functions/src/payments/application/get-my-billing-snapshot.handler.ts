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
// - entitlement ativo e consistente é a confirmação de acesso adquirido;
// - eventual divergência entre projeção e entitlement não concede acesso;
// - nenhum parâmetro financeiro é recebido do frontend.
//
// Escalabilidade:
// - a assinatura da plataforma possui entitlement determinístico por usuário;
// - isso evita query ampla no retorno de billing;
// - novos escopos, como creator_subscription ou paid_media, poderão ganhar
//   snapshots próprios sem misturar regras de autorização.

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { db } from '../../firebaseApp';
import { FUNCTIONS_REGION } from '../../config/functions-region';

import {
  EntitlementDoc,
  PlatformRole,
} from '../domain/billing.model';

interface BillingSnapshotResponse {
  role?: PlatformRole | null;
  tier?: PlatformRole | null;
  isSubscriber: boolean;
  entitlements: string[];
  updatedAt?: number | null;
}

type EntitlementData = Partial<EntitlementDoc> & {
  active?: unknown;
  scope?: unknown;
  grantedRole?: unknown;
  updatedAt?: unknown;
};

function isPlatformRole(value: unknown): value is PlatformRole {
  return value === 'basic' || value === 'premium' || value === 'vip';
}

function toFiniteNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : null;
}

/**
 * Resolve exclusivamente o entitlement da assinatura principal.
 *
 * O identificador determinístico permite:
 * - leitura eficiente;
 * - menor custo;
 * - ausência de query ampla;
 * - contrato claro para a autorização de mensalidade da plataforma.
 */
async function getActivePlatformSubscriptionEntitlement(
  uid: string
): Promise<{
  active: boolean;
  role: PlatformRole | null;
  updatedAt: number | null;
}> {
  const entitlementId = `platform_subscription_${uid}`;

  const snapshot = await db
    .collection('entitlements')
    .doc(entitlementId)
    .get();

  if (!snapshot.exists) {
    return {
      active: false,
      role: null,
      updatedAt: null,
    };
  }

  const entitlement = (snapshot.data() ?? {}) as EntitlementData;

  /**
   * Normalizamos o papel concedido antes de decidir se o entitlement é
   * utilizável.
   *
   * Isso mantém o fluxo fail-closed:
   * - valores desconhecidos;
   * - valores ausentes;
   * - dados legados incompletos;
   *
   * nunca são tratados como assinatura válida.
   */
  const grantedRole = isPlatformRole(entitlement.grantedRole)
    ? entitlement.grantedRole
    : null;

  if (
    entitlement.active !== true ||
    entitlement.scope !== 'platform_subscription' ||
    grantedRole === null
  ) {
    return {
      active: false,
      role: null,
      updatedAt: toFiniteNumberOrNull(entitlement.updatedAt),
    };
  }

  return {
    active: true,
    role: grantedRole,
    updatedAt: toFiniteNumberOrNull(entitlement.updatedAt),
  };
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