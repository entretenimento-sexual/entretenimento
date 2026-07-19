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
      const scanLimit = pageRequest.limit * 3 + 1;
      let pageQuery = pageRequest.sourceType
        ? projection
            .where('source.type', '==', pageRequest.sourceType)
            .orderBy('rankScore', 'desc')
            .limit(scanLimit)
        : projection.orderBy('rankScore', 'desc').limit(scanLimit);

      if (pageRequest.cursor) {
        const cursorSnapshot = await projection.doc(pageRequest.cursor).get();

        if (!cursorSnapshot.exists) {
          throw new HttpsError(
            'invalid-argument',
            'Cursor de paginação não encontrado.'
          );
        }

        if (pageRequest.sourceType) {
          const cursorSource = (cursorSnapshot.data()?.['source'] ?? {}) as Record<
            string,
            unknown
          >;

          if (cursorSource['type'] !== pageRequest.sourceType) {
            throw new HttpsError(
              'invalid-argument',
              'O cursor não pertence a esta categoria.'
            );
          }
        }

        pageQuery = pageQuery.startAfter(cursorSnapshot);
      }

      const querySnapshot = await pageQuery.get();
      const items: CommunityPreviewCard[] = [];
      let lastConsumedIndex = -1;

      for (let index = 0; index < querySnapshot.docs.length; index += 1) {
        const document = querySnapshot.docs[index];
        lastConsumedIndex = index;

        const item = sanitizeCommunityDiscoveryProjection(
          document.id,
          document.data()
        );

        if (
          item
          && (!pageRequest.sourceType || item.source.type === pageRequest.sourceType)
        ) {
          items.push(item);
        }

        if (items.length >= pageRequest.limit) {
          break;
        }
      }

      const lastConsumedDocument =
        lastConsumedIndex >= 0
          ? querySnapshot.docs[lastConsumedIndex]
          : null;
      const hasBufferedDocuments =
        lastConsumedIndex >= 0
        && lastConsumedIndex < querySnapshot.docs.length - 1;
      const mayHaveAnotherPage =
        querySnapshot.docs.length === scanLimit || hasBufferedDocuments;

      return {
        items,
        nextCursor:
          mayHaveAnotherPage ? (lastConsumedDocument?.id ?? null) : null,
        generatedAt: Date.now(),
      };
    }
  );
