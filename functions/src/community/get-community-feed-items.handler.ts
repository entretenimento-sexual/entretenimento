// functions/src/community/get-community-feed-items.handler.ts
// -----------------------------------------------------------------------------
// GET COMMUNITY FEED ITEMS
// -----------------------------------------------------------------------------
// Hidratação dirigida por postId para o listener realtime. Evita recarregar a
// primeira página inteira quando apenas um pequeno conjunto de itens mudou.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';
import {
  assertCommunityCallableAppCheck,
  REQUIRE_COMMUNITY_APP_CHECK,
} from './community-callable-security';
import {
  canViewerReadCommunityFeedProjection,
  resolveCommunityFeedContentAccess,
} from './community-feed-access.policy';
import {
  CommunityFeedPageResponse,
  CommunityFeedView,
  SanitizedCommunityFeedProjection,
  sanitizeCommunityFeedProjection,
} from './community-feed.model';
import { hydrateCommunityFeedItemsForViewer } from './community-feed-read.service';
import { getCommunityViewerContext } from './community-viewer-access.service';

interface CommunityFeedItemsRequest {
  communityId?: unknown;
  view?: unknown;
  postIds?: unknown;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const MAX_ITEMS = 20;

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : '';
}

function normalizePostIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const unique = new Set<string>();
  for (const raw of value) {
    const postId = cleanId(raw);
    if (postId) unique.add(postId);
    if (unique.size >= MAX_ITEMS) break;
  }
  return [...unique];
}

function assertRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;
  throw new HttpsError(
    'failed-precondition',
    'O mural comunitário ainda não está disponível neste ambiente.'
  );
}

function assertAuthenticatedUid(
  auth: { uid?: string; token?: Record<string, unknown> } | undefined
): string {
  const uid = cleanId(auth?.uid);
  if (!uid) throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  if (auth?.token?.['email_verified'] !== true) {
    throw new HttpsError('failed-precondition', 'Verifique seu e-mail para continuar.');
  }
  return uid;
}

export const getCommunityFeedItems = onCall<CommunityFeedItemsRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<CommunityFeedPageResponse> => {
    assertCommunityCallableAppCheck(request.app);
    assertRuntime();
    const uid = assertAuthenticatedUid(request.auth);
    const communityId = cleanId(request.data?.communityId);
    const view: CommunityFeedView = request.data?.view === 'photos'
      ? 'photos'
      : 'feed';
    const postIds = normalizePostIds(request.data?.postIds);

    if (!communityId) {
      throw new HttpsError('invalid-argument', 'Comunidade inválida.');
    }

    const context = await getCommunityViewerContext(uid, communityId);
    const feedContentAccess = resolveCommunityFeedContentAccess(
      context.memberContentAccess,
      context.authenticatedPreviewAccess
    );
    const now = Date.now();

    if (postIds.length === 0) {
      return { items: [], nextCursor: null, generatedAt: now };
    }

    const snapshots = await db.getAll(...postIds.map((postId) => db
      .collection('community_public_feed')
      .doc(communityId)
      .collection('items')
      .doc(postId)));
    const projections: SanitizedCommunityFeedProjection[] = [];

    for (const snapshot of snapshots) {
      if (!snapshot.exists) continue;
      const projection = sanitizeCommunityFeedProjection(
        snapshot.id,
        snapshot.data(),
        now
      );
      if (
        projection
        && canViewerReadCommunityFeedProjection(
          projection,
          view,
          feedContentAccess
        )
      ) {
        projections.push(projection);
      }
    }

    const items = await hydrateCommunityFeedItemsForViewer({
      communityId,
      uid,
      projections,
      context,
      now,
    });

    return {
      items: items.sort((left, right) => right.publishedAt - left.publishedAt),
      nextCursor: null,
      generatedAt: now,
    };
  }
);
