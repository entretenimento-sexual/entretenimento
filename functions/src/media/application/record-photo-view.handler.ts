import type { CallableRequest } from 'firebase-functions/v2/https';
import { HttpsError } from 'firebase-functions/v2/https';

import { db, FieldValue } from '../../firebaseApp';
import {
  type PhotoPublicationAudienceDocument,
  type PublicPhotoAudienceDocument,
  resolveCanonicalPhotoAudienceTarget,
} from './photo-audience-access.policy';
import {
  buildNextPhotoQualificationMetrics,
  buildPhotoRankingUpdate,
  type PublicPhotoRankingDocument,
} from './photo-ranking-score';
import {
  PHOTO_VIEW_MIN_VISIBLE_MS,
  type PhotoViewEvidenceInput,
  normalizePhotoViewEvidence,
} from './photo-view-session.policy';
import {
  type PhotoViewSessionDocument,
  type PhotoViewSource,
  cleanPhotoViewSource,
  getPhotoViewSessionRef,
  hashPhotoViewSessionToken,
} from './photo-view-session.store';
import {
  PROFILE_VIEWER_INDEX_VERSION,
  PROFILE_VIEWERS_COLLECTION,
  calculatePublicProfileEngagementScore,
  ensurePublicProfileViewerIndex,
} from './public-profile-media-metrics';
import {
  createVideoAudienceAccessEvaluator,
} from './video-audience-access.policy';

export interface RecordPhotoViewRequest {
  ownerUid?: string;
  photoId?: string;
  source?: PhotoViewSource;
  evidence?: PhotoViewEvidenceInput;
}

export interface RecordPhotoViewResponse {
  ok: true;
  ownerUid: string;
  photoId: string;
  counted: boolean;
  uniqueViewer: boolean;
  retryAfterMs: number;
}

const VIEW_COUNT_INTERVAL_MS = 5 * 60 * 1000;
const VIEWER_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const QUALIFICATION_CLOCK_TOLERANCE_MS = 1_500;

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function cleanAppId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return normalized.length > 0 && normalized.length <= 256
    ? normalized
    : '';
}

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
}

function assertApprovedPhoto(
  exists: boolean,
  data: FirebaseFirestore.DocumentData | undefined
): void {
  if (!exists) {
    throw new HttpsError('not-found', 'Foto pública não encontrada.');
  }

  if (String(data?.moderationStatus ?? '').trim().toUpperCase() !== 'APPROVED') {
    throw new HttpsError(
      'failed-precondition',
      'Foto indisponível para visualização.'
    );
  }
}

function assertPhotoViewSession(input: {
  session: PhotoViewSessionDocument;
  viewerUid: string;
  ownerUid: string;
  photoId: string;
  source: PhotoViewSource;
  appId: string;
  visibleMs: number;
  qualifiedAt: number;
  now: number;
}): void {
  const sessionViewerUid = cleanId(input.session.viewerUid);
  const sessionOwnerUid = cleanId(input.session.ownerUid);
  const sessionPhotoId = cleanId(input.session.photoId);
  const sessionSource = cleanPhotoViewSource(input.session.source);
  const sessionAppId = cleanAppId(input.session.appId);
  const issuedAt = safeNumber(input.session.issuedAt);
  const expiresAt = safeNumber(input.session.expiresAt);
  const elapsedAtQualification = input.qualifiedAt - issuedAt;

  if (
    sessionViewerUid !== input.viewerUid ||
    sessionOwnerUid !== input.ownerUid ||
    sessionPhotoId !== input.photoId ||
    sessionSource !== input.source ||
    !issuedAt ||
    !expiresAt ||
    input.now > expiresAt ||
    input.qualifiedAt > input.now + QUALIFICATION_CLOCK_TOLERANCE_MS ||
    input.qualifiedAt < issuedAt + PHOTO_VIEW_MIN_VISIBLE_MS ||
    input.qualifiedAt > expiresAt ||
    input.visibleMs < PHOTO_VIEW_MIN_VISIBLE_MS ||
    input.visibleMs > elapsedAtQualification + QUALIFICATION_CLOCK_TOLERANCE_MS ||
    (sessionAppId && sessionAppId !== input.appId)
  ) {
    throw new HttpsError(
      'failed-precondition',
      'A sessão de visualização é inválida ou expirou.'
    );
  }
}

export async function recordPhotoViewCore(
  request: CallableRequest<RecordPhotoViewRequest>
): Promise<RecordPhotoViewResponse> {
  const viewerUid = cleanId(request.auth?.uid);
  const ownerUid = cleanId(request.data?.ownerUid);
  const photoId = cleanId(request.data?.photoId);
  const source = cleanPhotoViewSource(request.data?.source);
  const evidence = normalizePhotoViewEvidence(request.data?.evidence);
  const appId = cleanAppId(request.app?.appId);

  if (!viewerUid) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  if (!ownerUid || !photoId) {
    throw new HttpsError('invalid-argument', 'Foto inválida.');
  }

  if (viewerUid === ownerUid) {
    return {
      ok: true,
      ownerUid,
      photoId,
      counted: false,
      uniqueViewer: false,
      retryAfterMs: 0,
    };
  }

  if (!evidence) {
    throw new HttpsError(
      'failed-precondition',
      'A foto ainda não permaneceu visível pelo tempo mínimo.'
    );
  }

  const publicProfileRef = db.doc(`public_profiles/${ownerUid}`);
  const publicPhotoRef = db.doc(
    `public_profiles/${ownerUid}/public_photos/${photoId}`
  );
  const publicationRef = db.doc(
    `users/${ownerUid}/photo_publications/${photoId}`
  );
  const sessionRef = getPhotoViewSessionRef(evidence.sessionId);
  const preflightPhotoSnapshot = await publicPhotoRef.get();

  assertApprovedPhoto(
    preflightPhotoSnapshot.exists,
    preflightPhotoSnapshot.data()
  );

  const audience = await createVideoAudienceAccessEvaluator(viewerUid);
  await ensurePublicProfileViewerIndex(ownerUid);

  const now = Date.now();
  const photoViewerRef = publicPhotoRef.collection('views').doc(viewerUid);
  const profileViewerRef = publicProfileRef
    .collection(PROFILE_VIEWERS_COLLECTION)
    .doc(viewerUid);

  const outcome = await db.runTransaction(async (transaction) => {
    const [
      publicProfileSnap,
      publicPhotoSnap,
      publicationSnap,
      photoViewerSnap,
      profileViewerSnap,
      sessionSnap,
    ] = await Promise.all([
      transaction.get(publicProfileRef),
      transaction.get(publicPhotoRef),
      transaction.get(publicationRef),
      transaction.get(photoViewerRef),
      transaction.get(profileViewerRef),
      transaction.get(sessionRef),
    ]);

    if (!publicProfileSnap.exists) {
      throw new HttpsError('not-found', 'Perfil público não encontrado.');
    }

    assertApprovedPhoto(publicPhotoSnap.exists, publicPhotoSnap.data());

    if (!publicationSnap.exists) {
      throw new HttpsError('not-found', 'Publicação da foto não encontrada.');
    }

    if (!sessionSnap.exists) {
      throw new HttpsError(
        'failed-precondition',
        'A sessão de visualização já foi utilizada ou expirou.'
      );
    }

    const publicProfile = publicProfileSnap.data() ?? {};
    const publicPhoto = publicPhotoSnap.data() ?? {};
    const publication =
      publicationSnap.data() as PhotoPublicationAudienceDocument;
    const photoViewerData = photoViewerSnap.data() ?? {};
    const profileViewerData = profileViewerSnap.data() ?? {};
    const target = resolveCanonicalPhotoAudienceTarget({
      ownerUid,
      photoId,
      publicPhoto: publicPhoto as PublicPhotoAudienceDocument,
      publication,
    });

    if (!target) {
      throw new HttpsError(
        'failed-precondition',
        'A foto possui dados de publicação inconsistentes.'
      );
    }

    await audience.assertInTransaction(transaction, target);
    assertPhotoViewSession({
      session: sessionSnap.data() as PhotoViewSessionDocument,
      viewerUid,
      ownerUid,
      photoId,
      source,
      appId,
      visibleMs: evidence.visibleMs,
      qualifiedAt: evidence.qualifiedAt,
      now,
    });

    const isUniquePhotoViewer = !photoViewerSnap.exists;
    const isUniqueProfileViewer = !profileViewerSnap.exists;
    const lastCountedAt = safeNumber(
      photoViewerData.lastCountedAt ?? photoViewerData.lastViewedAt
    );
    const canCountView =
      isUniquePhotoViewer || now - lastCountedAt >= VIEW_COUNT_INTERVAL_MS;
    const retryAfterMs = canCountView
      ? 0
      : Math.max(0, VIEW_COUNT_INTERVAL_MS - (now - lastCountedAt));
    const sessionHash = hashPhotoViewSessionToken(evidence.sessionId);

    const currentPhotoViewsCount = safeNumber(publicPhoto.viewsCount);
    const currentPhotoUniqueViewersCount = safeNumber(
      publicPhoto.uniqueViewersCount
    );
    const currentPhotoViewScore = safeNumber(publicPhoto.viewScore);
    const nextPhotoViewsCount = canCountView
      ? currentPhotoViewsCount + 1
      : currentPhotoViewsCount;
    const nextPhotoUniqueViewersCount = isUniquePhotoViewer
      ? currentPhotoUniqueViewersCount + 1
      : currentPhotoUniqueViewersCount;
    const qualification = buildNextPhotoQualificationMetrics({
      currentQualifiedViewsCount: publicPhoto.qualifiedViewsCount,
      currentTotalQualifiedVisibleMs: publicPhoto.totalQualifiedVisibleMs,
      currentTotalQualifiedTargetMs: publicPhoto.totalQualifiedTargetMs,
      visibleMs: evidence.visibleMs,
      counted: canCountView,
    });
    const nextPhotoRanking = buildPhotoRankingUpdate(
      publicPhoto as PublicPhotoRankingDocument,
      now,
      {
        viewsCount: nextPhotoViewsCount,
        uniqueViewersCount: nextPhotoUniqueViewersCount,
        qualifiedViewsCount: qualification.qualifiedViewsCount,
        totalQualifiedVisibleMs: qualification.totalQualifiedVisibleMs,
        totalQualifiedTargetMs: qualification.totalQualifiedTargetMs,
      }
    );

    const currentProfileViewsCount = safeNumber(
      publicProfile.profileViewsCount ?? publicProfile.viewsCount
    );
    const currentProfileUniqueViewersCount = safeNumber(
      publicProfile.profileUniqueViewersCount ??
        publicProfile.uniqueViewersCount
    );
    const currentMediaUniqueViewersCount = safeNumber(
      publicProfile.mediaUniqueViewersCount
    );
    const currentProfileViewScore = safeNumber(publicProfile.viewScore);
    const nextProfileViewsCount = canCountView
      ? currentProfileViewsCount + 1
      : currentProfileViewsCount;
    const nextProfileUniqueViewersCount = isUniqueProfileViewer
      ? currentProfileUniqueViewersCount + 1
      : currentProfileUniqueViewersCount;
    const nextMediaUniqueViewersCount = isUniquePhotoViewer
      ? currentMediaUniqueViewersCount + 1
      : currentMediaUniqueViewersCount;
    const nextProfileViewScore = canCountView
      ? Math.max(
        0,
        currentProfileViewScore -
          currentPhotoViewScore +
          nextPhotoRanking.viewScore
      )
      : currentProfileViewScore;

    const engagementScore = calculatePublicProfileEngagementScore({
      mediaCount: safeNumber(
        publicProfile.mediaCount ?? publicProfile.publicMediaCount
      ),
      photosCount: safeNumber(
        publicProfile.photosCount ?? publicProfile.publicPhotosCount
      ),
      videosCount: safeNumber(
        publicProfile.videosCount ?? publicProfile.publicVideosCount
      ),
      viewsCount: nextProfileViewsCount,
      uniqueViewersCount: nextProfileUniqueViewersCount,
      reactionsCount: safeNumber(
        publicProfile.reactionsCount ??
          publicProfile.likesCount ??
          publicProfile.publicLikesCount
      ),
    });

    const shouldTouchPhotoViewer =
      canCountView ||
      now - safeNumber(photoViewerData.lastViewedAt) >=
        VIEWER_TOUCH_INTERVAL_MS;
    const shouldTouchProfileViewer =
      canCountView ||
      isUniqueProfileViewer ||
      now - safeNumber(profileViewerData.lastViewedAt) >=
        VIEWER_TOUCH_INTERVAL_MS;

    transaction.delete(sessionRef);

    if (shouldTouchPhotoViewer) {
      transaction.set(
        photoViewerRef,
        {
          ownerUid,
          photoId,
          viewerUid,
          source,
          firstViewedAt: isUniquePhotoViewer
            ? now
            : photoViewerData.firstViewedAt ?? now,
          lastViewedAt: now,
          lastQualifiedVisibleMs: evidence.visibleMs,
          ...(canCountView
            ? {
              lastCountedAt: now,
              lastCountedSessionHash: sessionHash,
              viewsCount: FieldValue.increment(1),
            }
            : {}),
        },
        { merge: true }
      );
    }

    if (shouldTouchProfileViewer) {
      transaction.set(
        profileViewerRef,
        {
          ownerUid,
          viewerUid,
          firstViewedAt: isUniqueProfileViewer
            ? now
            : profileViewerData.firstViewedAt ??
              profileViewerData.historicalFirstViewedAt ??
              now,
          lastViewedAt: now,
          lastSource: source,
          indexVersion: PROFILE_VIEWER_INDEX_VERSION,
          ...(canCountView
            ? {
              lastCountedAt: now,
              viewsCount: FieldValue.increment(1),
            }
            : {}),
        },
        { merge: true }
      );
    }

    if (canCountView) {
      transaction.set(
        publicPhotoRef,
        {
          viewsCount: nextPhotoViewsCount,
          uniqueViewersCount: nextPhotoUniqueViewersCount,
          qualifiedViewsCount: qualification.qualifiedViewsCount,
          totalQualifiedVisibleMs: qualification.totalQualifiedVisibleMs,
          totalQualifiedTargetMs: qualification.totalQualifiedTargetMs,
          averageQualifiedVisibleMs: qualification.averageQualifiedVisibleMs,
          lastViewedAt: now,
          score: nextPhotoRanking.score,
          engagementScore: nextPhotoRanking.engagementScore,
          viewScore: nextPhotoRanking.viewScore,
          retentionScore: nextPhotoRanking.retentionScore,
          freshnessScore: nextPhotoRanking.freshnessScore,
          scoreBreakdown: nextPhotoRanking.scoreBreakdown,
          rankingVersion: nextPhotoRanking.rankingVersion,
          rankingUpdatedAt: nextPhotoRanking.rankingUpdatedAt,
          updatedAt: now,
        },
        { merge: true }
      );
    }

    if (canCountView || isUniqueProfileViewer) {
      transaction.set(
        publicProfileRef,
        {
          viewsCount: nextProfileViewsCount,
          profileViewsCount: nextProfileViewsCount,
          uniqueViewersCount: nextProfileUniqueViewersCount,
          profileUniqueViewersCount: nextProfileUniqueViewersCount,
          mediaUniqueViewersCount: nextMediaUniqueViewersCount,
          viewScore: nextProfileViewScore,
          engagementScore,
          lastViewedAt: now,
          profileViewerIndexVersion: PROFILE_VIEWER_INDEX_VERSION,
          mediaMetricsUpdatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    return {
      counted: canCountView,
      uniqueViewer: isUniquePhotoViewer,
      retryAfterMs,
    };
  });

  return {
    ok: true,
    ownerUid,
    photoId,
    ...outcome,
  };
}
