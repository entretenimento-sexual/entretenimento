import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, FieldValue } from '../../firebaseApp';
import { deleteProfilePhotoResources } from './delete-profile-photo.handler';
import {
  buildMediaReportSafetyState,
  shouldPreserveMediaEvidence,
  type MediaReportSafetyReason,
} from './media-report-safety';
import {
  queueModerationEvidencePreservation,
  releaseModerationEvidence,
} from './moderation-evidence-preservation.service';
import {
  assertPublicMediaCallableAppCheck,
  REQUIRE_PUBLIC_MEDIA_APP_CHECK,
} from './public-media-callable-security';

export type PhotoContentReportDecision = 'KEEP' | 'REMOVE';

interface ReviewPhotoContentReportRequest {
  reportId?: string;
  decision?: PhotoContentReportDecision;
  resolution?: string | null;
}

interface ModerationReportDocument {
  targetType?: string;
  targetId?: string;
  targetOwnerUid?: string;
  reason?: string;
  status?: string;
  contentQuarantined?: boolean;
  evidencePreservationStatus?: string;
}

interface PublicPhotoDocument {
  ownerUid?: string;
  reportsCount?: number;
  openReportsCount?: number;
  confirmedReportsCount?: number;
  safetyScore?: number;
}

interface PhotoPublicationDocument {
  publishedStoragePath?: string;
}

interface TransactionResult {
  ownerUid: string;
  photoId: string;
  contentAvailableAtReview: boolean;
  reason: MediaReportSafetyReason | null;
  evidenceRequired: boolean;
  evidencePreservationStatus: string;
  publishedStoragePath: string | null;
}

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function cleanDecision(value: unknown): PhotoContentReportDecision | null {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized === 'KEEP' || normalized === 'REMOVE'
    ? normalized
    : null;
}

function cleanResolution(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 900);
}

function cleanReason(value: unknown): MediaReportSafetyReason | null {
  const normalized = String(value ?? '').trim().toLowerCase();

  return [
    'spam',
    'fake_profile',
    'harassment',
    'hate_or_abuse',
    'sexual_boundary',
    'illegal_content',
    'privacy',
    'minor_safety',
    'other',
  ].includes(normalized)
    ? normalized as MediaReportSafetyReason
    : null;
}

function assertAdmin(requestAuth: unknown): string {
  const authData = requestAuth as {
    uid?: unknown;
    token?: unknown;
  } | null | undefined;
  const adminUid = cleanId(authData?.uid);
  const token = typeof authData?.token === 'object' && authData.token !== null
    ? authData.token as Record<string, unknown>
    : {};
  const roles = Array.isArray(token['roles']) ? token['roles'] : [];
  const allowed = token['admin'] === true ||
    token['role'] === 'admin' ||
    roles.includes('admin');

  if (!adminUid) {
    throw new HttpsError('unauthenticated', 'Administrador não autenticado.');
  }

  if (!allowed) {
    throw new HttpsError(
      'permission-denied',
      'Apenas administradores podem revisar denúncias de foto.'
    );
  }

  return adminUid;
}

export const reviewPhotoContentReport = onCall<ReviewPhotoContentReportRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_PUBLIC_MEDIA_APP_CHECK,
  },
  async (request) => {
    assertPublicMediaCallableAppCheck(request.app);

    const adminUid = assertAdmin(request.auth);
    const reportId = cleanId(request.data?.reportId);
    const decision = cleanDecision(request.data?.decision);
    const resolution = cleanResolution(request.data?.resolution);

    if (!reportId || !decision) {
      throw new HttpsError('invalid-argument', 'Decisão de denúncia inválida.');
    }

    if (resolution.length < 8) {
      throw new HttpsError(
        'invalid-argument',
        'Registre uma justificativa objetiva para a decisão.'
      );
    }

    const reportRef = db.collection('moderation_reports').doc(reportId);
    const adminLogRef = db.collection('admin_logs').doc();

    const result = await db.runTransaction<TransactionResult>(
      async (transaction) => {
        const reportSnap = await transaction.get(reportRef);

        if (!reportSnap.exists) {
          throw new HttpsError('not-found', 'Denúncia não encontrada.');
        }

        const report = reportSnap.data() as ModerationReportDocument;
        const targetType = String(report.targetType ?? '').trim().toLowerCase();
        const ownerUid = cleanId(report.targetOwnerUid);
        const photoId = cleanId(report.targetId);
        const status = String(report.status ?? '').trim().toLowerCase();
        const reason = cleanReason(report.reason);

        if (targetType !== 'photo' || !ownerUid || !photoId) {
          throw new HttpsError(
            'failed-precondition',
            'A denúncia não possui referências válidas de foto.'
          );
        }

        if (status !== 'open' && status !== 'reviewing') {
          throw new HttpsError(
            'failed-precondition',
            'Esta denúncia já foi encerrada.'
          );
        }

        const photoRef = db.doc(
          `public_profiles/${ownerUid}/public_photos/${photoId}`
        );
        const publicationRef = db.doc(
          `users/${ownerUid}/photo_publications/${photoId}`
        );
        const [photoSnap, publicationSnap] = await Promise.all([
          transaction.get(photoRef),
          transaction.get(publicationRef),
        ]);
        const contentAvailableAtReview = photoSnap.exists;
        const photo = photoSnap.exists
          ? photoSnap.data() as PublicPhotoDocument
          : null;
        const publication = publicationSnap.exists
          ? publicationSnap.data() as PhotoPublicationDocument
          : null;
        const safetyState = buildMediaReportSafetyState(
          photo ?? {},
          decision === 'KEEP' ? 'KEEP' : 'REMOVE'
        );
        const now = Date.now();

        if (decision === 'KEEP') {
          if (!photo) {
            throw new HttpsError('not-found', 'Foto denunciada não encontrada.');
          }

          transaction.update(photoRef, {
            ...safetyState,
            ...(report.contentQuarantined === true
              ? {
                moderationStatus: 'APPROVED',
                moderationReason: null,
              }
              : {}),
            updatedAt: now,
          });

          if (report.contentQuarantined === true && publicationSnap.exists) {
            transaction.set(
              publicationRef,
              {
                isPublished: true,
                visibility: 'PUBLIC',
                moderationStatus: 'APPROVED',
                moderationReason: null,
                lastModeratedAt: FieldValue.serverTimestamp(),
                moderatedBy: adminUid,
                updatedAt: FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
          }
        } else {
          if (photo) {
            transaction.update(photoRef, {
              ...safetyState,
              moderationStatus: 'HIDDEN',
              moderationReason: resolution,
              updatedAt: now,
            });
          }

          if (publicationSnap.exists) {
            transaction.set(
              publicationRef,
              {
                isPublished: true,
                visibility: 'PUBLIC',
                moderationStatus: 'FLAGGED',
                moderationReason: resolution,
                lastModeratedAt: FieldValue.serverTimestamp(),
                moderatedBy: adminUid,
                updatedAt: FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
          }
        }

        const timestamp = FieldValue.serverTimestamp();
        const reportStatus = decision === 'KEEP' ? 'rejected' : 'resolved';
        const evidenceRequired = !!reason && shouldPreserveMediaEvidence(reason);
        const evidencePreservationStatus = String(
          report.evidencePreservationStatus ??
          (evidenceRequired ? 'PENDING' : 'NOT_REQUIRED')
        ).trim().toUpperCase();

        transaction.update(reportRef, {
          status: reportStatus,
          moderationAction: decision,
          resolution,
          reviewedBy: adminUid,
          reviewedAt: timestamp,
          updatedAt: timestamp,
        });
        transaction.set(adminLogRef, {
          adminUid,
          action: 'moderationReportReview',
          targetUserUid: ownerUid,
          details: {
            reportId,
            previousStatus: status,
            nextStatus: reportStatus,
            reason: report.reason ?? null,
            targetType: 'photo',
            moderationAction: decision,
            resolution,
            contentQuarantined: report.contentQuarantined === true,
            contentAvailableAtReview,
            evidenceRequired,
            evidencePreservationStatus,
          },
          timestamp,
        });

        return {
          ownerUid,
          photoId,
          contentAvailableAtReview,
          reason,
          evidenceRequired,
          evidencePreservationStatus,
          publishedStoragePath:
            String(publication?.publishedStoragePath ?? '').trim() || null,
        };
      }
    );

    let cleanupPending = false;
    let evidenceReleasePending = false;
    let evidencePreservationPending = false;

    if (decision === 'KEEP' && result.evidenceRequired) {
      try {
        await releaseModerationEvidence(reportId, 'REPORT_REJECTED');
      } catch (error) {
        evidenceReleasePending = true;
        logger.error('[reviewPhotoContentReport] Liberação de evidência pendente.', {
          reportId,
          ownerUid: result.ownerUid,
          photoId: result.photoId,
          error: error instanceof Error
            ? error.message.slice(0, 500)
            : String(error ?? '').slice(0, 500),
        });
      }
    }

    if (decision === 'REMOVE') {
      let evidenceReady = !result.evidenceRequired ||
        result.evidencePreservationStatus === 'PRESERVED';

      if (
        result.evidenceRequired &&
        !evidenceReady &&
        result.reason
      ) {
        const preservation = await queueModerationEvidencePreservation({
          reportId,
          mediaType: 'PHOTO',
          ownerUid: result.ownerUid,
          mediaId: result.photoId,
          reason: result.reason,
          sourceStoragePath: result.publishedStoragePath,
        });
        evidenceReady = preservation.preserved;
        evidencePreservationPending = !preservation.preserved;
      }

      if (evidenceReady && result.contentAvailableAtReview) {
        try {
          const deletion = await deleteProfilePhotoResources(
            result.ownerUid,
            result.photoId,
            { allowQuarantined: true }
          );
          cleanupPending = deletion.cleanupPending;
        } catch (error) {
          cleanupPending = true;
          logger.error('[reviewPhotoContentReport] Exclusão total pendente.', {
            ownerUid: result.ownerUid,
            photoId: result.photoId,
            error: error instanceof Error
              ? error.message.slice(0, 500)
              : String(error ?? '').slice(0, 500),
          });
        }
      } else if (!evidenceReady) {
        cleanupPending = true;
      }
    }

    return {
      reportId,
      decision,
      targetType: 'photo',
      contentAvailableAtReview: result.contentAvailableAtReview,
      cleanupPending,
      evidencePreservationPending,
      evidenceReleasePending,
    };
  }
);
