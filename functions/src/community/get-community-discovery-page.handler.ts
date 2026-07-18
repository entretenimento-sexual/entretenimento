// functions/src/community/get-community-discovery-page.handler.ts
// -----------------------------------------------------------------------------
// GET COMMUNITY DISCOVERY PAGE
// -----------------------------------------------------------------------------
// Descoberta paginada por projeção sanitizada e backend-only.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import { isFunctionsEmulatorRuntime } from '../shared/runtime/functions-runtime.guard';
import {
  CommunityDiscoveryPageRequest,
  CommunityDiscoveryPageResponse,
  CommunityPreviewCard,
  normalizeCommunityDiscoveryPageRequest,
  sanitizeCommunityDiscoveryProjection,
} from './community-preview.model';

function assertPreviewRuntime(): void {
  if (isFunctionsEmulatorRuntime()) {
    return;
  }

  throw new HttpsError(
    'failed-precondition',
    'As comunidades ainda não estão disponíveis neste ambiente.'
  );
}

function assertValidCursor(
  raw: CommunityDiscoveryPageRequest | null | undefined,
  normalized: string | null
): void {
  const provided = String(raw?.cursor ?? '').trim();

  if (provided && !normalized) {
    throw new HttpsError('invalid-argument', 'Cursor de paginação inválido.');
  }
}

export const getCommunityDiscoveryPage =
  onCall<CommunityDiscoveryPageRequest>(
    { region: FUNCTIONS_REGION },
    async (request): Promise<CommunityDiscoveryPageResponse> => {
      assertPreviewRuntime();

      if (!request.auth?.uid) {
        throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
      }

      if (request.auth.token.email_verified !== true) {
        throw new HttpsError(
          'failed-precondition',
          'Verifique seu e-mail para continuar.'
        );
      }

      const pageRequest = normalizeCommunityDiscoveryPageRequest(request.data);
      assertValidCursor(request.data, pageRequest.cursor);

      const projection = db.collection('community_discovery_index');
      let pageQuery = projection
        .where('status', '==', 'active')
        .where('moderationState', '==', 'active')
        .where('visibility', '==', 'public_preview')
        .orderBy('rankScore', 'desc')
        .limit(pageRequest.limit + 1);

      if (pageRequest.cursor) {
        const cursorSnapshot = await projection.doc(pageRequest.cursor).get();

        if (!cursorSnapshot.exists) {
          throw new HttpsError(
            'invalid-argument',
            'Cursor de paginação não encontrado.'
          );
        }

        pageQuery = pageQuery.startAfter(cursorSnapshot);
      }

      const querySnapshot = await pageQuery.get();
      const pageDocuments = querySnapshot.docs.slice(0, pageRequest.limit);
      const items = pageDocuments
        .map((document): CommunityPreviewCard | null =>
          sanitizeCommunityDiscoveryProjection(
            document.id,
            document.data()
          )
        )
        .filter((item): item is CommunityPreviewCard => item !== null);

      return {
        items,
        nextCursor:
          querySnapshot.docs.length > pageRequest.limit
            ? (pageDocuments.at(-1)?.id ?? null)
            : null,
        generatedAt: Date.now(),
      };
    }
  );
