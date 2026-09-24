// functions/src/community/get-community-explore-content.handler.ts
// -----------------------------------------------------------------------------
// GET COMMUNITY EXPLORE CONTENT
// -----------------------------------------------------------------------------
// Retorna uma amostra pequena de conteúdo comunitário previamente projetado.
// A leitura nunca abre N murais: consulta um único índice global backend-only,
// revalida Comunidade/membership em lote e resolve bloqueio bilateral por ator
// com a fronteira agregada já canônica.
// -----------------------------------------------------------------------------

import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  resolveBilateralBlockedUidsForActor,
} from '../friendship/application/bilateral-block-access.policy';
import {
  createTemporaryStorageReadUrl,
} from '../media/application/temporary-storage-read-url.service';
import {
  assertCommunityCallableAppCheck,
  REQUIRE_COMMUNITY_APP_CHECK,
} from './community-callable-security';
import {
  type CommunityExploreContentItem,
  type CommunityExploreContentProjection,
  type CommunityExploreContentResponse,
  sanitizeCommunityExploreContentProjection,
} from './community-explore-content.model';
import {
  resolveCommunityViewerMode,
  sanitizeCommunityDiscoveryProjection,
} from './community-preview.model';
import {
  assertCommunitySocialAccessForUid,
} from './community-social-access.service';

interface CommunityExploreContentRequest {
  readonly limit?: unknown;
}

const DEFAULT_LIMIT = 2;
const MAX_LIMIT = 2;
const SCAN_MULTIPLIER = 6;
const MEDIA_URL_TTL_MS = 20 * 60_000;

function normalizeLimit(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;
}

function assertAuthenticatedUid(
  auth: { uid?: string; token?: Record<string, unknown> } | undefined
): string {
  const uid = String(auth?.uid ?? '').trim();

  if (!uid) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  if (auth?.token?.['email_verified'] !== true) {
    throw new HttpsError(
      'failed-precondition',
      'Verifique seu e-mail para continuar.'
    );
  }

  return uid;
}

export const getCommunityExploreContent =
  onCall<CommunityExploreContentRequest>(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
    },
    async (request): Promise<CommunityExploreContentResponse> => {
      const startedAt = Date.now();
      assertCommunityCallableAppCheck(request.app);
      const uid = assertAuthenticatedUid(request.auth);
      await assertCommunitySocialAccessForUid(uid);

      const limit = normalizeLimit(request.data?.limit);
      const scanLimit = limit * SCAN_MULTIPLIER;
      const snapshot = await db
        .collection('community_explore_content_index')
        .orderBy('publishedAt', 'desc')
        .limit(scanLimit)
        .get();
      const now = Date.now();
      const candidates = snapshot.docs
        .map((document) =>
          sanitizeCommunityExploreContentProjection(document.data(), now)
        )
        .filter((item): item is CommunityExploreContentProjection => item !== null);

      if (candidates.length === 0) {
        return { items: [], generatedAt: now };
      }

      const communityIds = [...new Set(
        candidates.map((candidate) => candidate.communityId)
      )];
      const communityRefs = communityIds.map((communityId) =>
        db.collection('community_discovery_index').doc(communityId)
      );
      const membershipRefs = communityIds.map((communityId) =>
        db
          .collection('communities')
          .doc(communityId)
          .collection('members')
          .doc(uid)
      );
      const [
        blockedUids,
        discoverySnapshots,
        membershipSnapshots,
      ] = await Promise.all([
        resolveBilateralBlockedUidsForActor(uid),
        db.getAll(...communityRefs),
        db.getAll(...membershipRefs),
      ]);
      const discoveryByCommunity = new Map(
        discoverySnapshots.map((item) => [item.id, item] as const)
      );
      const membershipByCommunity = new Map(
        membershipSnapshots.map((item) => [
          item.ref.parent.parent?.id ?? '',
          item,
        ] as const)
      );
      const deliveredCommunityIds = new Set<string>();
      const items: CommunityExploreContentItem[] = [];

      for (const candidate of candidates) {
        if (items.length >= limit) break;
        if (blockedUids.has(candidate.actorUid)) continue;
        if (deliveredCommunityIds.has(candidate.communityId)) continue;

        const discoverySnapshot = discoveryByCommunity.get(
          candidate.communityId
        );
        const currentCommunity = discoverySnapshot?.exists
          ? sanitizeCommunityDiscoveryProjection(
              candidate.communityId,
              discoverySnapshot.data()
            )
          : null;
        if (!currentCommunity || currentCommunity.source.type !== 'community') {
          continue;
        }

        const membershipSnapshot = membershipByCommunity.get(
          candidate.communityId
        );
        const viewer = resolveCommunityViewerMode(
          membershipSnapshot?.exists ? membershipSnapshot.data() : null
        );

        // Esta superfície existe para descoberta. Comunidades já ativas ou com
        // solicitação pendente ficam nos blocos de atividade/"Minhas".
        if (viewer.blocked || viewer.active || viewer.mode === 'pending') {
          continue;
        }

        let image: CommunityExploreContentItem['post']['image'] = null;

        if (candidate.post.kind === 'photo') {
          const storagePath = candidate.post.imageStoragePath;
          if (!storagePath) continue;

          try {
            const url = await createTemporaryStorageReadUrl(
              storagePath,
              now + MEDIA_URL_TTL_MS
            );
            image = {
              url,
              alt:
                candidate.post.imageAlt
                || 'Foto publicada na comunidade',
            };
          } catch (error) {
            logger.warn('community_explore_content_photo_unavailable', {
              communityId: candidate.communityId,
              postId: candidate.postId,
              error:
                error instanceof Error
                  ? error.message.slice(0, 300)
                  : String(error),
            });
            continue;
          }
        }

        deliveredCommunityIds.add(candidate.communityId);
        items.push({
          communityId: candidate.communityId,
          postId: candidate.postId,
          community: {
            name: currentCommunity.name,
            slug: currentCommunity.slug,
            avatarUrl: currentCommunity.avatarUrl,
          },
          post: {
            kind: candidate.post.kind,
            author: candidate.post.author,
            text: candidate.post.text,
            image,
          },
          publishedAt: candidate.publishedAt,
        });
      }

      logger.info('community_explore_content_served', {
        requestedLimit: limit,
        scanLimit,
        candidatesScanned: snapshot.size,
        eligibleCandidates: candidates.length,
        communitiesRevalidated: communityIds.length,
        returned: items.length,
        durationMs: Date.now() - startedAt,
      });

      return {
        items,
        generatedAt: now,
      };
    }
  );
