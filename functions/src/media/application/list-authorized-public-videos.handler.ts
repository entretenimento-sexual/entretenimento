import { FieldPath } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import { createVideoAudienceAccessEvaluator } from './video-audience-access.policy';

type RankingMode = 'top' | 'latest';

interface RankingCursor {
  mode: RankingMode;
  score: number;
  uniqueViewersCount: number;
  viewsCount: number;
  publishedAt: number;
  documentPath: string;
}

interface RankingRequest {
  mode?: unknown;
  pageSize?: unknown;
  cursor?: Partial<RankingCursor> | null;
}

interface RawVideoDocument {
  id: string;
  path: string;
  data: Record<string, unknown>;
}

interface RankingResponse {
  documents: RawVideoDocument[];
  nextCursor: RankingCursor | null;
  hasMore: boolean;
}

const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 16;
const BATCH_SIZE = 24;
const MAX_SCAN_ITEMS = 120;

function cleanId(value: unknown): string {
  const text = String(value ?? '').trim();
  return text && text.length <= 128 && !text.includes('/') ? text : '';
}

function numberOrZero(value: unknown): number {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : 0;
}

function normalizeMode(value: unknown): RankingMode {
  return String(value ?? '').trim().toLowerCase() === 'top'
    ? 'top'
    : 'latest';
}

function normalizePageSize(value: unknown): number {
  const numberValue = Number(value ?? DEFAULT_PAGE_SIZE);
  return Number.isFinite(numberValue)
    ? Math.max(1, Math.min(MAX_PAGE_SIZE, Math.trunc(numberValue)))
    : DEFAULT_PAGE_SIZE;
}

function normalizeCursor(
  value: RankingRequest['cursor'],
  mode: RankingMode
): RankingCursor | null {
  const documentPath = String(value?.documentPath ?? '').trim();

  if (
    !value ||
    value.mode !== mode ||
    !/^public_profiles\/[^/]+\/public_videos\/[^/]+$/.test(documentPath)
  ) {
    return null;
  }

  return {
    mode,
    score: numberOrZero(value.score),
    uniqueViewersCount: numberOrZero(value.uniqueViewersCount),
    viewsCount: numberOrZero(value.viewsCount),
    publishedAt: numberOrZero(value.publishedAt),
    documentPath,
  };
}

function cursorFromDocument(
  mode: RankingMode,
  document: { ref: { path: string }; data(): Record<string, unknown> }
): RankingCursor {
  const data = document.data();

  return {
    mode,
    score: numberOrZero(data['score']),
    uniqueViewersCount: numberOrZero(data['uniqueViewersCount']),
    viewsCount: numberOrZero(data['viewsCount']),
    publishedAt: numberOrZero(data['publishedAt']),
    documentPath: document.ref.path,
  };
}

function rankingQuery(mode: RankingMode, cursor: RankingCursor | null) {
  let query = db
    .collectionGroup('public_videos')
    .where('visibility', '==', 'PUBLIC')
    .where('moderationStatus', '==', 'APPROVED');

  if (mode === 'top') {
    query = query
      .orderBy('score', 'desc')
      .orderBy('uniqueViewersCount', 'desc')
      .orderBy('viewsCount', 'desc')
      .orderBy('publishedAt', 'desc')
      .orderBy(FieldPath.documentId(), 'desc');

    if (cursor) {
      query = query.startAfter(
        cursor.score,
        cursor.uniqueViewersCount,
        cursor.viewsCount,
        cursor.publishedAt,
        cursor.documentPath
      );
    }
  } else {
    query = query
      .orderBy('publishedAt', 'desc')
      .orderBy(FieldPath.documentId(), 'desc');

    if (cursor) {
      query = query.startAfter(cursor.publishedAt, cursor.documentPath);
    }
  }

  return query.limit(BATCH_SIZE);
}

function normalizeProjection(
  document: {
    id: string;
    ref: { path: string };
    data(): Record<string, unknown>;
  }
): RawVideoDocument | null {
  const data = document.data();
  const ownerUid = cleanId(data['ownerUid']);
  const videoId = cleanId(data['id'] ?? document.id);
  const expectedPath = `public_profiles/${ownerUid}/public_videos/${videoId}`;

  if (
    !ownerUid ||
    !videoId ||
    document.id !== videoId ||
    document.ref.path !== expectedPath
  ) {
    return null;
  }

  return { id: videoId, path: document.ref.path, data };
}

export const listAuthorizedPublicVideos = onCall<RankingRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<RankingResponse> => {
    const viewerUid = cleanId(request.auth?.uid);

    if (!viewerUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    const mode = normalizeMode(request.data?.mode);
    const pageSize = normalizePageSize(request.data?.pageSize);
    let scanCursor = normalizeCursor(request.data?.cursor, mode);
    const audience = await createVideoAudienceAccessEvaluator(viewerUid);
    const profileCache = new Map<string, Promise<boolean>>();
    const documents: RawVideoDocument[] = [];
    let scannedItems = 0;
    let hasMore = false;

    try {
      while (documents.length < pageSize && scannedItems < MAX_SCAN_ITEMS) {
        const snapshot = await rankingQuery(mode, scanCursor).get();

        if (snapshot.empty) {
          hasMore = false;
          break;
        }

        const candidates = await Promise.all(snapshot.docs.map(async (doc) => {
          const projection = normalizeProjection(doc);

          if (!projection) {
            return { doc, projection, allowed: false };
          }

          const ownerUid = cleanId(projection.data['ownerUid']);
          let profileExists = profileCache.get(ownerUid);

          if (!profileExists) {
            profileExists = db.doc(`public_profiles/${ownerUid}`).get()
              .then((profile) => profile.exists);
            profileCache.set(ownerUid, profileExists);
          }

          const [exists, decision] = await Promise.all([
            profileExists,
            audience.evaluate({
              ownerUid,
              action: 'LIST',
              visibility: projection.data['visibility'],
              isPublished: true,
              moderationStatus: projection.data['moderationStatus'],
            }),
          ]);

          return { doc, projection, allowed: exists && decision.allowed };
        }));

        let consumed = 0;

        for (const candidate of candidates) {
          consumed += 1;
          scannedItems += 1;
          scanCursor = cursorFromDocument(mode, candidate.doc);

          if (candidate.allowed && candidate.projection) {
            documents.push(candidate.projection);
          }

          if (documents.length >= pageSize || scannedItems >= MAX_SCAN_ITEMS) {
            hasMore = consumed < candidates.length || snapshot.size === BATCH_SIZE;
            break;
          }
        }

        if (documents.length >= pageSize || scannedItems >= MAX_SCAN_ITEMS) {
          break;
        }

        if (snapshot.size < BATCH_SIZE) {
          hasMore = false;
          break;
        }

        hasMore = true;
      }
    } catch (error) {
      logger.error('[listAuthorizedPublicVideos] Falha ao montar feed.', {
        viewerUid,
        mode,
        scannedItems,
        error: error instanceof Error ? error.message : String(error ?? ''),
      });
      throw new HttpsError(
        'internal',
        'Não foi possível carregar os vídeos públicos.'
      );
    }

    return {
      documents,
      nextCursor: hasMore ? scanCursor : null,
      hasMore,
    };
  }
);
