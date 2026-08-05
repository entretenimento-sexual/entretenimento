import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import {
  resolveCanonicalPhotoAudienceTarget,
} from './photo-audience-access.policy';
import {
  createVideoAudienceAccessEvaluator,
} from './video-audience-access.policy';

type PhotoRankingMode = 'latest' | 'top' | 'boosted';

interface RankingRequest {
  readonly mode?: unknown;
  readonly pageSize?: unknown;
  readonly nowMs?: unknown;
}

interface ProfileRequest {
  readonly ownerUid?: unknown;
  readonly pageSize?: unknown;
}

interface RawPhotoDocument {
  readonly id: string;
  readonly path: string;
  readonly data: Record<string, unknown>;
}

interface RankingResponse {
  readonly documents: RawPhotoDocument[];
}

interface ProfileResponse {
  readonly documents: RawPhotoDocument[];
}

interface CanonicalPhotoPublication {
  readonly ownerUid?: unknown;
  readonly photoId?: unknown;
  readonly isPublished?: unknown;
  readonly visibility?: unknown;
  readonly moderationStatus?: unknown;
}

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 32;
const MAX_RANKING_SCAN_ITEMS = 120;
const MAX_PROFILE_SCAN_ITEMS = 64;

function cleanId(value: unknown): string {
  const text = String(value ?? '').trim();
  return text && text.length <= 128 && !text.includes('/') ? text : '';
}

function normalizeMode(value: unknown): PhotoRankingMode {
  const mode = String(value ?? '').trim().toLowerCase();

  if (mode === 'top' || mode === 'boosted') {
    return mode;
  }

  return 'latest';
}

function normalizePageSize(value: unknown): number {
  const numberValue = Number(value ?? DEFAULT_PAGE_SIZE);

  return Number.isFinite(numberValue)
    ? Math.max(1, Math.min(MAX_PAGE_SIZE, Math.trunc(numberValue)))
    : DEFAULT_PAGE_SIZE;
}

function normalizeNow(value: unknown): number {
  const numberValue = Number(value ?? Date.now());
  return Number.isFinite(numberValue) && numberValue > 0
    ? Math.trunc(numberValue)
    : Date.now();
}

function rankingQuery(
  mode: PhotoRankingMode,
  pageSize: number,
  nowMs: number
) {
  let ranking = db
    .collectionGroup('public_photos')
    .where('visibility', '==', 'PUBLIC')
    .where('moderationStatus', '==', 'APPROVED');

  if (mode === 'top') {
    ranking = ranking
      .orderBy('score', 'desc')
      .orderBy('publishedAt', 'desc');
  } else if (mode === 'boosted') {
    ranking = ranking
      .where('boostActive', '==', true)
      .where('boostedUntil', '>', nowMs)
      .orderBy('boostedUntil', 'desc');
  } else {
    ranking = ranking.orderBy('publishedAt', 'desc');
  }

  return ranking.limit(Math.min(MAX_RANKING_SCAN_ITEMS, pageSize * 5));
}

function normalizeProjection(
  document: {
    readonly id: string;
    readonly ref: { readonly path: string };
    data(): Record<string, unknown>;
  }
): RawPhotoDocument | null {
  const data = document.data();
  const ownerUid = cleanId(data['ownerUid']);
  const photoId = cleanId(data['id'] ?? document.id);
  const expectedPath = `public_profiles/${ownerUid}/public_photos/${photoId}`;

  if (
    !ownerUid ||
    !photoId ||
    document.id !== photoId ||
    document.ref.path !== expectedPath
  ) {
    return null;
  }

  return {
    id: photoId,
    path: document.ref.path,
    data,
  };
}

async function authorizeProjection(params: {
  readonly projection: RawPhotoDocument;
  readonly audience: Awaited<
    ReturnType<typeof createVideoAudienceAccessEvaluator>
  >;
  readonly profileCache: Map<string, Promise<boolean>>;
}): Promise<boolean> {
  const ownerUid = cleanId(params.projection.data['ownerUid']);
  const photoId = params.projection.id;

  if (!ownerUid || !photoId) {
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
    db.doc(`users/${ownerUid}/photo_publications/${photoId}`).get(),
  ]);

  if (!exists || !publicationSnapshot.exists) {
    return false;
  }

  const target = resolveCanonicalPhotoAudienceTarget({
    ownerUid,
    photoId,
    action: 'LIST',
    publicPhoto: params.projection.data,
    publication:
      publicationSnapshot.data() as CanonicalPhotoPublication,
  });

  if (!target) {
    return false;
  }

  return (await params.audience.evaluate(target)).allowed;
}

export const listAuthorizedPublicPhotos = onCall<RankingRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<RankingResponse> => {
    const viewerUid = cleanId(request.auth?.uid);

    if (!viewerUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    const mode = normalizeMode(request.data?.mode);
    const pageSize = normalizePageSize(request.data?.pageSize);
    const nowMs = normalizeNow(request.data?.nowMs);
    const audience = await createVideoAudienceAccessEvaluator(
      viewerUid,
      request.auth?.token?.email_verified === true
    );
    const profileCache = new Map<string, Promise<boolean>>();

    try {
      const snapshot = await rankingQuery(mode, pageSize, nowMs).get();
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
      logger.error('[listAuthorizedPublicPhotos] Falha ao montar feed.', {
        viewerUid,
        mode,
        error: error instanceof Error ? error.message : String(error ?? ''),
      });
      throw new HttpsError(
        'internal',
        'Não foi possível carregar as fotos públicas.'
      );
    }
  }
);

export const listAuthorizedProfilePhotos = onCall<ProfileRequest>(
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

    const pageSize = normalizePageSize(request.data?.pageSize);
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
        .collection(`public_profiles/${ownerUid}/public_photos`)
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
      logger.error('[listAuthorizedProfilePhotos] Falha ao carregar perfil.', {
        viewerUid,
        ownerUid,
        error: error instanceof Error ? error.message : String(error ?? ''),
      });
      throw new HttpsError(
        'internal',
        'Não foi possível carregar as fotos deste perfil.'
      );
    }
  }
);
