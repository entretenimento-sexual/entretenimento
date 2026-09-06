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

import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  buildCommunityDiscoveryCursor,
  parseCommunityDiscoveryCursor,
} from './community-discovery-cursor.policy';
import {
  resolveCommunityDiscoveryMembershipBatchSize,
} from './community-discovery-membership-batch.policy';
import {
  resolveCommunityDiscoveryProjectionBatchSize,
} from './community-discovery-projection-batch.policy';
import { getCommunityDiscoveryRankingMode } from './community-discovery-ranking-mode.service';
import {
  buildCommunityDiscoveryTelemetry,
} from './community-discovery-telemetry.policy';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';
import {
  assertCommunityCallableAppCheck,
  REQUIRE_COMMUNITY_APP_CHECK,
} from './community-callable-security';
import {
  CommunityDiscoveryPageRequest,
  CommunityDiscoveryPageResponse,
  CommunityPreviewCard,
  filterCommunityDiscoveryCardForViewer,
  normalizeCommunityDiscoveryPageRequest,
  sanitizeCommunityDiscoveryProjection,
} from './community-preview.model';
import {
  assertCommunitySocialAccessForUid,
} from './community-social-access.service';

interface CommunityDiscoveryCandidate {
  readonly index: number;
  readonly item: CommunityPreviewCard;
}

interface VisibleDiscoveryCandidatesResult {
  readonly visibleCandidates: ReadonlyMap<number, CommunityPreviewCard>;
  readonly membershipReads: number;
  readonly blockedExcluded: number;
}

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

function collectDiscoveryCandidates(
  documents: readonly FirebaseFirestore.QueryDocumentSnapshot[],
  startIndex: number,
  endIndex: number,
  effectiveSourceType: CommunityPreviewCard['source']['type'] | null,
  tagId: string | null
): readonly CommunityDiscoveryCandidate[] {
  const candidates: CommunityDiscoveryCandidate[] = [];

  for (let index = startIndex; index < endIndex; index += 1) {
    const document = documents[index];
    const item = sanitizeCommunityDiscoveryProjection(
      document.id,
      document.data()
    );

    if (
      item
      && (!effectiveSourceType || item.source.type === effectiveSourceType)
      && (!tagId || item.tags.some((tag) => tag.id === tagId))
    ) {
      candidates.push({ index, item });
    }
  }

  return candidates;
}

async function resolveVisibleDiscoveryCandidates(
  uid: string,
  candidates: readonly CommunityDiscoveryCandidate[]
): Promise<VisibleDiscoveryCandidatesResult> {
  if (candidates.length === 0) {
    return {
      visibleCandidates: new Map<number, CommunityPreviewCard>(),
      membershipReads: 0,
      blockedExcluded: 0,
    };
  }

  const membershipRefs = candidates.map(({ item }) =>
    db
      .collection('communities')
      .doc(item.communityId)
      .collection('members')
      .doc(uid)
  );
  const membershipSnapshots = await db.getAll(...membershipRefs);
  const visibleCandidates = new Map<number, CommunityPreviewCard>();
  let blockedExcluded = 0;

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const visibleItem = filterCommunityDiscoveryCardForViewer(
      candidate.item,
      membershipSnapshots[index].data()
    );

    if (visibleItem) {
      visibleCandidates.set(candidate.index, visibleItem);
    } else {
      blockedExcluded += 1;
    }
  }

  return {
    visibleCandidates,
    membershipReads: membershipSnapshots.length,
    blockedExcluded,
  };
}

export const getCommunityDiscoveryPage =
  onCall<CommunityDiscoveryPageRequest>(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
    },
    async (request): Promise<CommunityDiscoveryPageResponse> => {
      const startedAt = Date.now();
      assertCommunityCallableAppCheck(request.app);
      assertPreviewRuntime();

      const uid = String(request.auth?.uid ?? '').trim();
      if (!uid) {
        throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
      }

      if (request.auth?.token?.email_verified !== true) {
        throw new HttpsError(
          'failed-precondition',
          'Verifique seu e-mail para continuar.'
        );
      }

      await assertCommunitySocialAccessForUid(uid);

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
      // Orçamento máximo total da varredura. A projeção agora é buscada em
      // lotes incrementais, em vez de pré-carregar todo esse teto de uma vez.
      const scanLimit = pageRequest.limit * 3 + 1;
      const projectionQuery = pageRequest.tagId
        ? projection
          .where('source.type', '==', 'community')
          .where('tagIds', 'array-contains', pageRequest.tagId)
          .orderBy(orderField, 'desc')
        : effectiveSourceType
          ? projection
            .where('source.type', '==', effectiveSourceType)
            .orderBy(orderField, 'desc')
          : projection.orderBy(orderField, 'desc');
      let projectionCursorSnapshot: FirebaseFirestore.DocumentSnapshot | null = null;

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

        projectionCursorSnapshot = cursorSnapshot;
      }

      const items: CommunityPreviewCard[] = [];
      let projectionDocumentsFetched = 0;
      let projectionDocumentsConsumed = 0;
      let candidatesEvaluated = 0;
      let membershipReads = 0;
      let membershipBatches = 0;
      let blockedExcluded = 0;
      let lastConsumedDocument: FirebaseFirestore.QueryDocumentSnapshot | null = null;
      let hasBufferedDocuments = false;
      let sourceExhausted = false;

      while (
        items.length < pageRequest.limit
        && projectionDocumentsFetched < scanLimit
      ) {
        const projectionBatchSize =
          resolveCommunityDiscoveryProjectionBatchSize({
            remainingCards: pageRequest.limit - items.length,
            remainingScanBudget: scanLimit - projectionDocumentsFetched,
            projectionDocumentsConsumed,
            cardsReturned: items.length,
          });

        if (projectionBatchSize === 0) {
          break;
        }

        let projectionBatchQuery = projectionQuery.limit(projectionBatchSize);
        if (projectionCursorSnapshot) {
          projectionBatchQuery = projectionBatchQuery.startAfter(
            projectionCursorSnapshot
          );
        }

        const projectionBatchSnapshot = await projectionBatchQuery.get();
        projectionDocumentsFetched += projectionBatchSnapshot.size;
        sourceExhausted = projectionBatchSnapshot.size < projectionBatchSize;

        if (projectionBatchSnapshot.empty) {
          break;
        }

        let membershipBatchStart = 0;
        while (
          membershipBatchStart < projectionBatchSnapshot.docs.length
          && items.length < pageRequest.limit
        ) {
          const membershipBatchSize =
            resolveCommunityDiscoveryMembershipBatchSize({
              remainingCards: pageRequest.limit - items.length,
              candidatesEvaluated,
              blockedExcluded,
            });

          if (membershipBatchSize === 0) {
            break;
          }

          const membershipBatchEnd = Math.min(
            membershipBatchStart + membershipBatchSize,
            projectionBatchSnapshot.docs.length
          );
          const candidates = collectDiscoveryCandidates(
            projectionBatchSnapshot.docs,
            membershipBatchStart,
            membershipBatchEnd,
            effectiveSourceType,
            pageRequest.tagId
          );
          candidatesEvaluated += candidates.length;

          const visibilityResult = await resolveVisibleDiscoveryCandidates(
            uid,
            candidates
          );
          membershipReads += visibilityResult.membershipReads;
          blockedExcluded += visibilityResult.blockedExcluded;
          if (visibilityResult.membershipReads > 0) {
            membershipBatches += 1;
          }

          for (
            let index = membershipBatchStart;
            index < membershipBatchEnd;
            index += 1
          ) {
            const document = projectionBatchSnapshot.docs[index];
            projectionDocumentsConsumed += 1;
            lastConsumedDocument = document;
            const item = visibilityResult.visibleCandidates.get(index);

            if (item) {
              items.push(item);
            }

            if (items.length >= pageRequest.limit) {
              break;
            }
          }

          membershipBatchStart = membershipBatchEnd;
        }

        if (items.length >= pageRequest.limit) {
          hasBufferedDocuments =
            projectionDocumentsConsumed < projectionDocumentsFetched;
          break;
        }

        if (sourceExhausted) {
          break;
        }

        projectionCursorSnapshot =
          projectionBatchSnapshot.docs.at(-1) ?? projectionCursorSnapshot;
      }

      const mayHaveAnotherPage = Boolean(lastConsumedDocument)
        && (hasBufferedDocuments || !sourceExhausted);
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

      logger.info(
        'community_discovery_page_served',
        buildCommunityDiscoveryTelemetry({
          requestedLimit: pageRequest.limit,
          scanLimit,
          projectionDocumentsFetched,
          projectionDocumentsConsumed,
          candidatesEvaluated,
          membershipReads,
          membershipBatches,
          blockedExcluded,
          cardsReturned: items.length,
          cursorProjectionReads: cursor ? 1 : 0,
          durationMs: Date.now() - startedAt,
          hasCursor: Boolean(cursor),
          hasTagFilter: Boolean(pageRequest.tagId),
          sourceType: effectiveSourceType,
          rankingMode: rankingMode.effectiveMode,
          hasNextPage: Boolean(nextCursor),
        })
      );

      return {
        items,
        nextCursor,
        generatedAt: Date.now(),
      };
    }
  );
