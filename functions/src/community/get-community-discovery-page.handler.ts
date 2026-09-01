// functions/src/community/get-community-discovery-page.handler.ts
// -----------------------------------------------------------------------------
// GET COMMUNITY DISCOVERY PAGE
// -----------------------------------------------------------------------------
// Descoberta paginada por projeção sanitizada e backend-only. A ordenação por
// score novo só é ativada quando configuração, índice e backfill da versão atual
// estiverem prontos; qualquer inconsistência mantém o `rankScore` legado.
// O cursor carrega o modo de ranking que gerou a página e falha fechado se o
// cutover/rollback ocorrer entre duas requisições de paginação.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  buildCommunityDiscoveryCursor,
  parseCommunityDiscoveryCursor,
} from './community-discovery-cursor.policy';
import { getCommunityDiscoveryRankingMode } from './community-discovery-ranking-mode.service';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';
import {
  assertCommunityCallableAppCheck,
  REQUIRE_COMMUNITY_APP_CHECK,
} from './community-callable-security';
import {
  CommunityDiscoveryPageRequest,
  CommunityDiscoveryPageResponse,
  CommunityPreviewCard,
  normalizeCommunityDiscoveryPageRequest,
  sanitizeCommunityDiscoveryProjection,
} from './community-preview.model';

function assertPreviewRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) {
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

function assertValidTag(
  raw: CommunityDiscoveryPageRequest | null | undefined,
  normalized: string | null
): void {
  const provided = String(raw?.tagId ?? '').trim();

  if (provided && !normalized) {
    throw new HttpsError('invalid-argument', 'Filtro de interesse inválido.');
  }
}

export const getCommunityDiscoveryPage =
  onCall<CommunityDiscoveryPageRequest>(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
    },
    async (request): Promise<CommunityDiscoveryPageResponse> => {
      assertCommunityCallableAppCheck(request.app);
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
      assertValidTag(request.data, pageRequest.tagId);

      if (pageRequest.tagId && pageRequest.sourceType === 'venue') {
        throw new HttpsError(
          'invalid-argument',
          'Filtro de interesse está disponível somente para Comunidades.'
        );
      }

      const rankingMode = await getCommunityDiscoveryRankingMode();
      const cursor = pageRequest.cursor
        ? parseCommunityDiscoveryCursor(pageRequest.cursor)
        : null;

      if (pageRequest.cursor && !cursor) {
        throw new HttpsError('invalid-argument', 'Cursor de paginação inválido.');
      }

      if (cursor && cursor.mode !== rankingMode.effectiveMode) {
        throw new HttpsError(
          'aborted',
          'A ordem da descoberta foi atualizada. Reinicie a paginação.'
        );
      }

      const orderField = rankingMode.orderField;
      const effectiveSourceType = pageRequest.tagId
        ? 'community'
        : pageRequest.sourceType;
      const projection = db.collection('community_discovery_index');
      const scanLimit = pageRequest.limit * 3 + 1;
      let pageQuery = pageRequest.tagId
        ? projection
          .where('source.type', '==', 'community')
          .where('tagIds', 'array-contains', pageRequest.tagId)
          .orderBy(orderField, 'desc')
          .limit(scanLimit)
        : effectiveSourceType
          ? projection
            .where('source.type', '==', effectiveSourceType)
            .orderBy(orderField, 'desc')
            .limit(scanLimit)
          : projection.orderBy(orderField, 'desc').limit(scanLimit);

      if (cursor) {
        const cursorSnapshot = await projection.doc(cursor.documentId).get();

        if (!cursorSnapshot.exists) {
          throw new HttpsError(
            'invalid-argument',
            'Cursor de paginação não encontrado.'
          );
        }

        const cursorData = cursorSnapshot.data() ?? {};
        const cursorSource = (cursorData['source'] ?? {}) as Record<
          string,
          unknown
        >;

        if (
          effectiveSourceType
          && cursorSource['type'] !== effectiveSourceType
        ) {
          throw new HttpsError(
            'invalid-argument',
            'O cursor não pertence a esta categoria.'
          );
        }

        if (
          pageRequest.tagId
          && (!Array.isArray(cursorData['tagIds'])
            || !cursorData['tagIds'].includes(pageRequest.tagId))
        ) {
          throw new HttpsError(
            'invalid-argument',
            'O cursor não pertence a este filtro de interesse.'
          );
        }

        if (!Number.isFinite(Number(cursorData[orderField]))) {
          throw new HttpsError(
            'invalid-argument',
            'O cursor não pertence à versão atual da descoberta.'
          );
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
          && (!effectiveSourceType || item.source.type === effectiveSourceType)
          && (!pageRequest.tagId
            || item.tags.some((tag) => tag.id === pageRequest.tagId))
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
      const nextCursor = mayHaveAnotherPage && lastConsumedDocument
        ? buildCommunityDiscoveryCursor(
          rankingMode.effectiveMode,
          lastConsumedDocument.id
        )
        : null;

      if (mayHaveAnotherPage && lastConsumedDocument && !nextCursor) {
        throw new HttpsError(
          'data-loss',
          'Não foi possível construir o cursor seguro da descoberta.'
        );
      }

      return {
        items,
        nextCursor,
        generatedAt: Date.now(),
      };
    }
  );
