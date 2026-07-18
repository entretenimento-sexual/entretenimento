// functions/src/subscriber-experiences/exclusive-connections/get-my-exclusive-connections.handler.ts
// -----------------------------------------------------------------------------
// GET MY EXCLUSIVE CONNECTIONS
// -----------------------------------------------------------------------------
// Consulta paginada da primeira experiência preparada para assinantes.
//
// Segurança:
// - disponível somente no Functions Emulator enquanto o produto está em prévia;
// - usa request.auth.uid como escopo obrigatório;
// - revalida entitlement ativo e vigente no backend;
// - exige plano Premium ou VIP;
// - lê somente a subcoleção pertencente ao viewer autenticado;
// - devolve uma projeção sanitizada, sem localização precisa ou dados privados;
// - documentos inválidos, inativos ou expirados são descartados.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import {
  getActivePlatformSubscriptionEntitlement,
  hasMinimumPlatformRole,
} from '../../payments/application/platform-subscription-entitlement.service';
import {
  isFunctionsEmulatorRuntime,
} from '../../shared/runtime/functions-runtime.guard';
import {
  ExclusiveConnectionCard,
  ExclusiveConnectionsPageRequest,
  ExclusiveConnectionsPageResponse,
  normalizeExclusiveConnectionsPageRequest,
  sanitizeExclusiveConnectionCandidate,
} from './exclusive-connections.model';

function assertPreviewRuntime(): void {
  if (isFunctionsEmulatorRuntime()) {
    return;
  }

  throw new HttpsError(
    'failed-precondition',
    'Esta experiência ainda não está disponível neste ambiente.'
  );
}

function assertValidCursorInput(
  rawRequest: ExclusiveConnectionsPageRequest | null | undefined,
  normalizedCursor: string | null
): void {
  const rawCursor = String(rawRequest?.cursor ?? '').trim();

  if (rawCursor && normalizedCursor === null) {
    throw new HttpsError('invalid-argument', 'Cursor de paginação inválido.');
  }
}

export const getMyExclusiveConnectionsPage =
  onCall<ExclusiveConnectionsPageRequest>(
    { region: FUNCTIONS_REGION },
    async (request): Promise<ExclusiveConnectionsPageResponse> => {
      assertPreviewRuntime();

      const uid = request.auth?.uid ?? null;

      if (!uid) {
        throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
      }

      const pageRequest = normalizeExclusiveConnectionsPageRequest(request.data);
      assertValidCursorInput(request.data, pageRequest.cursor);

      const entitlement =
        await getActivePlatformSubscriptionEntitlement(uid);

      if (
        !entitlement.active
        || !hasMinimumPlatformRole(entitlement.role, 'premium')
      ) {
        throw new HttpsError(
          'permission-denied',
          'Assinatura Premium ativa necessária.'
        );
      }

      const candidateCollection = db
        .collection('exclusive_connection_candidates')
        .doc(uid)
        .collection('items');

      let candidateQuery = candidateCollection
        .orderBy('compatibilityScore', 'desc')
        .limit(pageRequest.limit + 1);

      if (pageRequest.cursor) {
        const cursorSnapshot = await candidateCollection
          .doc(pageRequest.cursor)
          .get();

        if (!cursorSnapshot.exists) {
          throw new HttpsError(
            'invalid-argument',
            'Cursor de paginação não encontrado.'
          );
        }

        candidateQuery = candidateQuery.startAfter(cursorSnapshot);
      }

      const now = Date.now();
      const querySnapshot = await candidateQuery.get();
      const pageDocuments = querySnapshot.docs.slice(0, pageRequest.limit);
      const items = pageDocuments
        .map((document): ExclusiveConnectionCard | null =>
          sanitizeExclusiveConnectionCandidate(
            document.id,
            document.data(),
            now
          )
        )
        .filter(
          (item): item is ExclusiveConnectionCard => item !== null
        );

      return {
        items,
        nextCursor:
          querySnapshot.docs.length > pageRequest.limit
            ? (pageDocuments.at(-1)?.id ?? null)
            : null,
        generatedAt: now,
      };
    }
  );
