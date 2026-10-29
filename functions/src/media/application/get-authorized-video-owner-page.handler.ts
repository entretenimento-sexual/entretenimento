import { FieldPath } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import { resolveSocialConnectionAccess } from '../../friendship/application/social-connection-access.policy';
import { consumeBackendRateLimitQuota } from './backend-rate-limit.service';
import {
  assertPublicMediaCallableAppCheck,
  REQUIRE_PUBLIC_MEDIA_APP_CHECK,
} from './public-media-callable-security';
import { assertPublicMediaConsumptionAccess } from './public-media-consumption-access.policy';
import {
  isCurrentPublicMediaProjectionExposure,
  isCurrentPublicMediaAssetExposure,
} from './public-media-exposure.policy';
import { resolvePublicMediaOwnerExposure } from './public-media-owner-exposure.service';

type Visibility = 'PUBLIC' | 'FRIENDS';

interface Cursor {
  orderIndex: number;
  publishedAt: number;
  documentId: string;
}

interface AuthorizedVideoOwnerPageRequest {
  ownerUid?: unknown;
  pageSize?: unknown;
  cursor?: Partial<Cursor> | null;
}

interface VideoDocument {
  id: string;
  ownerUid: string;
  orderIndex: number;
  publishedAt: number;
  data: FirebaseFirestore.DocumentData;
}

const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 24;
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

function cleanId(value: unknown): string {
  const id = String(value ?? '').trim();
  return SAFE_ID.test(id) ? id : '';
}

function pageSize(value: unknown): number {
  const number = Number(value ?? DEFAULT_PAGE_SIZE);
  return Number.isFinite(number) && number > 0
    ? Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(number)))
    : DEFAULT_PAGE_SIZE;
}

function normalizeCursor(value: Partial<Cursor> | null | undefined): Cursor | null {
  if (!value) return null;
  const documentId = cleanId(value.documentId);
  const orderIndex = Number(value.orderIndex);
  const publishedAt = Number(value.publishedAt);
  if (!documentId || !Number.isFinite(orderIndex) || orderIndex < 0 ||
    !Number.isFinite(publishedAt) || publishedAt < 0) {
    throw new HttpsError('invalid-argument', 'Cursor de vídeos inválido.');
  }
  return { documentId, orderIndex: Math.floor(orderIndex),
    publishedAt: Math.floor(publishedAt) };
}

/** Same ordering as the existing PROFILE video discovery query. */
export function compareAuthorizedVideoDocuments(
  a: Pick<VideoDocument, 'orderIndex' | 'publishedAt' | 'id'>,
  b: Pick<VideoDocument, 'orderIndex' | 'publishedAt' | 'id'>
): number {
  if (a.orderIndex !== b.orderIndex) return a.orderIndex - b.orderIndex;
  if (a.publishedAt !== b.publishedAt) return b.publishedAt - a.publishedAt;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

async function loadVisibilityPage(input: {
  ownerUid: string;
  visibility: Visibility;
  size: number;
  cursor: Cursor | null;
  nowMs: number;
}): Promise<VideoDocument[]> {
  let query = db.collection('public_profiles')
    .doc(input.ownerUid).collection('public_videos')
    .where('visibility', '==', input.visibility)
    .where('moderationStatus', '==', 'APPROVED')
    .orderBy('orderIndex', 'asc')
    .orderBy('publishedAt', 'desc')
    .orderBy(FieldPath.documentId(), 'desc');

  if (input.cursor) {
    query = query.startAfter(input.cursor.orderIndex,
      input.cursor.publishedAt, input.cursor.documentId);
  }

  const snapshot = await query.limit(input.size + 1).get();
  return snapshot.docs.flatMap((document) => {
    const data = document.data();
    const ownerUid = cleanId(data['ownerUid']);
    const orderIndex = Number(data['orderIndex']);
    const publishedAt = Number(data['publishedAt']);
    if (ownerUid !== input.ownerUid ||
      !Number.isFinite(orderIndex) || orderIndex < 0 ||
      !Number.isFinite(publishedAt) || publishedAt < 0 ||
      !isCurrentPublicMediaProjectionExposure(
        data as Record<string, unknown>, input.nowMs, [input.visibility]
      )) return [];

    return [{
      id: document.id, ownerUid,
      orderIndex: Math.floor(orderIndex),
      publishedAt: Math.floor(publishedAt), data,
    }];
  });
}

/**
 * Backend-only profile gallery. The GLOBAL discovery callable remains PUBLIC.
 * FRIENDS projections are not emitted to unauthorized viewers, even before URL
 * signing. The signer independently revalidates social access per request.
 */
export const getAuthorizedVideoOwnerPage = onCall<AuthorizedVideoOwnerPageRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_PUBLIC_MEDIA_APP_CHECK,
  },
  async (request) => {
    assertPublicMediaCallableAppCheck(request.app);
    const viewerUid = cleanId(request.auth?.uid);
    if (!viewerUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    const ownerUid = cleanId(request.data?.ownerUid);
    if (!ownerUid) {
      throw new HttpsError('invalid-argument', 'Proprietário inválido.');
    }
    const size = pageSize(request.data?.pageSize);
    const cursor = normalizeCursor(request.data?.cursor);
    const nowMs = Date.now();
    await consumeBackendRateLimitQuota({
      action: 'getAuthorizedVideoOwnerPage',
      subject: viewerUid,
      cost: size,
      config: {
        burstWindowMs: 60_000, burstMax: 120,
        sustainedWindowMs: 600_000, sustainedMax: 600,
      },
      message: 'Muitas páginas de vídeo foram solicitadas.',
    });
    await assertPublicMediaConsumptionAccess(viewerUid);

    try {
      const social = await resolveSocialConnectionAccess(viewerUid, [ownerUid]);
      const exposure = await resolvePublicMediaOwnerExposure(
        [ownerUid], social.blockedTargetUids, nowMs
      );
      if (exposure.get(ownerUid)?.allowed !== true) {
        return { items: [], nextCursor: null, hasMore: false };
      }
      const canReadFriends =
        viewerUid === ownerUid || social.friendTargetUids.has(ownerUid);
      const [publicItems, friendsItems] = await Promise.all([
        loadVisibilityPage({
          ownerUid, visibility: 'PUBLIC', size, cursor, nowMs,
        }),
        canReadFriends ? loadVisibilityPage({
          ownerUid, visibility: 'FRIENDS', size, cursor, nowMs,
        }) : Promise.resolve([]),
      ]);
      const merged = [...new Map([...publicItems, ...friendsItems].map(
        (item) => [item.id, item]
      )).values()].sort(compareAuthorizedVideoDocuments);

      const hasMore = merged.length > size;
      const scannedItems = merged.slice(0, size);
      const last = scannedItems.at(-1) ?? null;

      // A projeção é um índice de leitura, não a autoridade da publicação.
      // Mesmo que esteja desatualizada, não revelar metadados de mídia retirada.
      const publicationSnapshots = scannedItems.length
        ? await db.getAll(...scannedItems.map((item) =>
          db.doc(`users/${ownerUid}/video_publications/${item.id}`)
        )) : [];
      const authorizedItems = scannedItems.filter((item, index) => {
        const publication = publicationSnapshots[index];
        return isCurrentPublicMediaAssetExposure({
          publicMedia: item.data as Record<string, unknown>,
          publication: publication?.exists
            ? publication.data() as Record<string, unknown>
            : null,
          ownerExposureAllowed: true,
          nowMs,
          allowedVisibilities: [String(item.data['visibility'])],
        });
      });
      return {
        items: authorizedItems.map((item) => ({
          ...item.data,
          id: item.id,
          ownerUid: item.ownerUid,
        })),
        nextCursor: hasMore && last
          ? { orderIndex: last.orderIndex,
            publishedAt: last.publishedAt, documentId: last.id }
          : null,
        hasMore,
      };
    } catch (error) {
      logger.warn('[getAuthorizedVideoOwnerPage] Falha ao ler galeria autorizada.', {
        ownerUid, viewerUid,
        reason: error instanceof Error ? error.message : String(error ?? ''),
      });
      throw new HttpsError('internal', 'Não foi possível carregar os vídeos do perfil.');
    }
  }
);
