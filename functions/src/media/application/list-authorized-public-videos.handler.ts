import { FieldPath } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import {
  createVideoAudienceAccessEvaluator,
  resolveCanonicalVideoAudienceTarget,
} from './video-audience-access.policy';

type RankingMode = 'top' | 'latest';

interface RankingCursor {
  readonly mode: RankingMode;
  readonly score: number;
  readonly uniqueViewersCount: number;
  readonly viewsCount: number;
  readonly publishedAt: number;
  readonly documentPath: string;
}

interface RankingRequest {
  readonly mode?: unknown;
  readonly pageSize?: unknown;
  readonly cursor?: Partial<RankingCursor> | null;
}

interface ProfileRequest {
  readonly ownerUid?: unknown;
  readonly pageSize?: unknown;
}

interface RawVideoDocument {
  readonly id: string;
  readonly path: string;
  readonly data: Record<string, unknown>;
}

interface RankingResponse {
  readonly documents: RawVideoDocument[];
  readonly nextCursor: RankingCursor | null;
  readonly hasMore: boolean;
}

interface ProfileResponse {
  readonly documents: RawVideoDocument[];
}

interface CanonicalPublication {
  readonly ownerUid?: unknown;
  readonly videoId?: unknown;
  readonly isPublished?: unknown;
  readonly visibility?: unknown;
  readonly moderationStatus?: unknown;
}

const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 16;
const RANKING_BATCH_SIZE = 24;
const MAX_RANKING_SCAN_ITEMS = 120;
const MAX_PROFILE_PAGE_SIZE = 32;
const MAX_PROFILE_SCAN_ITEMS = 64;

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

function normalizePageSize(
  value: unknown,
  defaultValue: number,
  maxValue: number
): number {
  const numberValue = Number(value ?? defaultValue);

  return Number.isFinite(numberValue)
    ? Math.max(1, Math.min(maxValue, Math.trunc(numberValue)))
    : defaultValue;
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
  document: {
    readonly ref: { readonly path: string };
    data(): Record<string, unknown>;
  }
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
  let ranking = db
    .collectionGroup('public_videos')
    .where('visibility', '==', 'PUBLIC')
    .where('moderationStatus', '==', 'APPROVED');

  if (mode === 'top') {
    ranking = ranking
      .orderBy('score', 'desc')
      .orderBy('uniqueViewersCount', 'desc')
      .orderBy('viewsCount', 'desc')
      .orderBy('publishedAt', 'desc')
      .orderBy(FieldPath.documentId(), 'desc');

    if (cursor) {
      ranking = ranking.startAfter(
        cursor.score,
        cursor.uniqueViewersCount,
        cursor.viewsCount,
        cursor.publishedAt,
        cursor.documentPath
      );
    }
  } else {
    ranking = ranking
      .orderBy('publishedAt', 'desc')
      .orderBy(FieldPath.documentId(), 'desc');

    if (cursor) {
      ranking = ranking.startAfter(
        cursor.publishedAt,
        cursor.documentPath
      );
    }
  }

  return ranking.limit(RANKING_BATCH_SIZE);
}

function normalizeProjection(
  document: {
    readonly id: string;
    readonly ref: { readonly path: string };
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

  return {
    id: videoId,
    path: document.ref.path,
    data,
  };
}

async function authorizeProjection(params: {
  readonly projection: RawVideoDocument;
  readonly audience: Awaited<
    ReturnType<typeof createVideoAudienceAccessEvaluator>
  >;
  readonly profileCache: Map<string, Promise<boolean>>;
}): Promise<boolean> {
  const ownerUid = cleanId(params.projection.data['ownerUid']);
  const videoId = params.projection.id;

  if (!ownerUid || !videoId) {
    return false;
  }

  let profileExists = params.profileCache.get(ownerUid);

  if (!profileExists) {
    profileExists = db.doc(`public_profiles/${ownerUid}`).get()
      .then((profile) => profile.exists);
    params.profileCache.set(ownerUid, profileExists);
  }

  const [exists, publicationSnapshot] = await Promise.all([
    profileExists,
    db.doc(`users/${ownerUid}/video_publications/${videoId}`).get(),
  ]);

  if (!exists || !publicationSnapshot.exists) {
    return false;
  }

  const target = resolveCanonicalVideoAudienceTarget({
    ownerUid,
    videoId,
    action: 'LIST',
    publicVideo: params.projection.data,
    publication: publicationSnapshot.data() as CanonicalPublication,
  });

  if (!target) {
    return false;
  }

  return (await params.audience.evaluate(target)).allowed;
}

export const listAuthorizedPublicVideos = onCall<RankingRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<RankingResponse> => {
    const viewerUid = cleanId(request.auth?.uid);

    if (!viewerUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    const mode = normalizeMode(request.data?.mode);
    const pageSize = normalizePageSize(
      request.data?.pageSize,
      DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE
    );
    let scanCursor = normalizeCursor(request.data?.cursor, mode);
    const audience = await createVideoAudienceAccessEvaluator(
      viewerUid,
      request.auth?.token?.email_verified === true
    );
    const profileCache = new Map<string, Promise<boolean>>();
    const documents: RawVideoDocument[] = [];
    let scannedItems = 0;
    let hasMore = false;

    try {
      while (
        documents.length < pageSize &&
        scannedItems < MAX_RANKING_SCAN_ITEMS
      ) {
        const snapshot = await rankingQuery(mode, scanCursor).get();

        if (snapshot.empty) {
          hasMore = false;
          break;
        }

        const candidates = await Promise.all(snapshot.docs.map(async (doc) => {
          const projection = normalizeProjection(doc);
          const allowed = projection
            ? await authorizeProjection({
              projection,
              audience,
              profileCache,
            })
            : false;

          return { doc, projection, allowed };
        }));
        let consumed = 0;

        for (const candidate of candidates) {
          consumed += 1;
          scannedItems += 1;
          scanCursor = cursorFromDocument(mode, candidate.doc);

          if (candidate.allowed && candidate.projection) {
            documents.push(candidate.projection);
          }

          if (
            documents.length >= pageSize ||
            scannedItems >= MAX_RANKING_SCAN_ITEMS
          ) {
            hasMore = consumed < candidates.length ||
              snapshot.size === RANKING_BATCH_SIZE;
            break;
          }
        }

        if (
          documents.length >= pageSize ||
          scannedItems >= MAX_RANKING_SCAN_ITEMS
        ) {
          break;
        }

        if (snapshot.size < RANKING_BATCH_SIZE) {
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

export const listAuthorizedProfileVideos = onCall<ProfileRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<ProfileResponse> => {
    const viewerUid = cleanId(request.auth?.uid);
    const ownerUid = cleanId(request.data?.ownerUid);

    if (!viewerUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (!ownerUid) {
      throw new HttpsError('invalid-argument', 'Perfil inválido.');
    }

    const pageSize = normalizePageSize(
      request.data?.pageSize,
      MAX_PROFILE_PAGE_SIZE,
      MAX_PROFILE_PAGE_SIZE
    );
    const audience = await createVideoAudienceAccessEvaluator(
      viewerUid,
      request.auth?.token?.email_verified === true
    );
    const profileCache = new Map<string, Promise<boolean>>();

    try {
      const profileSnapshot = await db.doc(`public_profiles/${ownerUid}`).get();

      if (!profileSnapshot.exists) {
        return { documents: [] };
      }

      const snapshot = await db
        .collection(`public_profiles/${ownerUid}/public_videos`)
        .where('visibility', '==', 'PUBLIC')
        .where('moderationStatus', '==', 'APPROVED')
        .orderBy('orderIndex', 'asc')
        .orderBy('publishedAt', 'desc')
        .limit(MAX_PROFILE_SCAN_ITEMS)
        .get();
      const candidates = await Promise.all(snapshot.docs.map(async (doc) => {
        const projection = normalizeProjection(doc);
        const allowed = projection
          ? await authorizeProjection({
            projection,
            audience,
            profileCache,
          })
          : false;

        return allowed && projection ? projection : null;
      }));

      return {
        documents: candidates.flatMap((candidate) =>
          candidate ? [candidate] : []
        ).slice(0, pageSize),
      };
    } catch (error) {
      logger.error('[listAuthorizedProfileVideos] Falha ao carregar perfil.', {
        viewerUid,
        ownerUid,
        error: error instanceof Error ? error.message : String(error ?? ''),
      });
      throw new HttpsError(
        'internal',
        'Não foi possível carregar os vídeos deste perfil.'
      );
    }
  }
);
