import { createHash } from 'node:crypto';

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import {
  assertInteractionAccess,
} from '../../account_lifecycle/interaction-access.policy';
import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, FieldValue } from '../../firebaseApp';
import { consumeBackendRateLimitQuota } from './backend-rate-limit.service';
import {
  buildMediaReportSafetyState,
  shouldPreserveMediaEvidence,
  shouldQuarantineMediaAfterReport,
  type MediaReportSafetyReason,
} from './media-report-safety';
import {
  queueModerationEvidencePreservation,
} from './moderation-evidence-preservation.service';
import {
  assertPublicMediaCallableAppCheck,
  REQUIRE_PUBLIC_MEDIA_APP_CHECK,
} from './public-media-callable-security';
import { assertPublicMediaConsumptionAccess } from './public-media-consumption-access.policy';

export type PhotoReportReason = MediaReportSafetyReason;

interface ReportPhotoContentRequest {
  ownerUid?: string;
  photoId?: string;
  reason?: PhotoReportReason;
  details?: string | null;
  route?: string | null;
}

interface PublicPhotoDocument {
  ownerUid?: string;
  visibility?: string;
  moderationStatus?: string;
  reportsCount?: number;
  openReportsCount?: number;
  confirmedReportsCount?: number;
  safetyScore?: number;
}

interface PhotoPublicationDocument {
  isPublished?: boolean;
  publishedStoragePath?: string;
}

interface ReportPhotoTransactionResult {
  publishedStoragePath: string | null;
  quarantine: boolean;
  evidenceRequired: boolean;
}

const ALLOWED_REASONS = new Set<PhotoReportReason>([
  'spam',
  'fake_profile',
  'harassment',
  'hate_or_abuse',
  'sexual_boundary',
  'illegal_content',
  'privacy',
  'minor_safety',
  'other',
]);
const REPORT_BURST_WINDOW_MS = 60 * 1000;
const REPORT_BURST_MAX = 12;
const REPORT_SUSTAINED_WINDOW_MS = 10 * 60 * 1000;
const REPORT_SUSTAINED_MAX = 48;
const QUARANTINE_REASON =
  'Conteúdo temporariamente indisponível durante análise de segurança.';

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function cleanReason(value: unknown): PhotoReportReason | null {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase() as PhotoReportReason;

  return ALLOWED_REASONS.has(normalized) ? normalized : null;
}

function cleanText(value: unknown, maxLength: number): string | null {
  const normalized = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);

  return normalized || null;
}

function buildReportId(
  reporterUid: string,
  ownerUid: string,
  photoId: string
): string {
  return createHash('sha256')
    .update([reporterUid, 'photo', ownerUid, photoId].join('|'))
    .digest('hex')
    .slice(0, 48);
}

export const reportPhotoContent = onCall<ReportPhotoContentRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_PUBLIC_MEDIA_APP_CHECK,
  },
  async (request) => {
    assertPublicMediaCallableAppCheck(request.app);

    const reporterUid = cleanId(request.auth?.uid);
    const ownerUid = cleanId(request.data?.ownerUid);
    const photoId = cleanId(request.data?.photoId);
    const reason = cleanReason(request.data?.reason);
    const details = cleanText(request.data?.details, 1200);
    const route = cleanText(request.data?.route, 300);

    if (!reporterUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (!ownerUid || !photoId || !reason) {
      throw new HttpsError('invalid-argument', 'Denúncia de foto inválida.');
    }

    if (reporterUid === ownerUid) {
      throw new HttpsError(
        'failed-precondition',
        'Você não pode denunciar a própria foto.'
      );
    }

    await consumeBackendRateLimitQuota({
      action: 'reportPhotoContent',
      subject: reporterUid,
      cost: 1,
      config: {
        burstWindowMs: REPORT_BURST_WINDOW_MS,
        burstMax: REPORT_BURST_MAX,
        sustainedWindowMs: REPORT_SUSTAINED_WINDOW_MS,
        sustainedMax: REPORT_SUSTAINED_MAX,
      },
      message: 'Muitas denúncias foram enviadas em pouco tempo.',
    });
    await assertInteractionAccess(reporterUid);
    await assertPublicMediaConsumptionAccess(reporterUid);

    const publicPhotoRef = db.doc(
      `public_profiles/${ownerUid}/public_photos/${photoId}`
    );
    const publicationRef = db.doc(
      `users/${ownerUid}/photo_publications/${photoId}`
    );
    const reportId = buildReportId(reporterUid, ownerUid, photoId);
    const reportRef = db.collection('moderation_reports').doc(reportId);

    const result = await db.runTransaction<ReportPhotoTransactionResult>(
      async (transaction) => {
        const [photoSnap, publicationSnap, reportSnap] = await Promise.all([
          transaction.get(publicPhotoRef),
          transaction.get(publicationRef),
          transaction.get(reportRef),
        ]);

        if (!photoSnap.exists || !publicationSnap.exists) {
          throw new HttpsError('not-found', 'Foto pública não encontrada.');
        }

        if (reportSnap.exists) {
          throw new HttpsError(
            'already-exists',
            'Você já denunciou este conteúdo.'
          );
        }

        const photo = photoSnap.data() as PublicPhotoDocument;
        const publication = publicationSnap.data() as PhotoPublicationDocument;

        if (
          photo.ownerUid !== ownerUid ||
          photo.visibility !== 'PUBLIC' ||
          photo.moderationStatus !== 'APPROVED' ||
          publication.isPublished !== true
        ) {
          throw new HttpsError(
            'failed-precondition',
            'Este conteúdo não está disponível para denúncia pública.'
          );
        }

        const safetyState = buildMediaReportSafetyState(photo, 'OPEN');
        const quarantine = shouldQuarantineMediaAfterReport(
          reason,
          safetyState.openReportsCount
        );
        const evidenceRequired = shouldPreserveMediaEvidence(reason);
        const timestamp = FieldValue.serverTimestamp();

        transaction.create(reportRef, {
          reporterUid,
          targetType: 'photo',
          targetId: photoId,
          parentTargetId: null,
          targetOwnerUid: ownerUid,
          targetAuthorUid: ownerUid,
          reason,
          details,
          route,
          status: 'open',
          moderationAction: null,
          contentQuarantined: quarantine,
          evidencePreservationStatus: evidenceRequired
            ? 'PENDING'
            : 'NOT_REQUIRED',
          source: 'web',
          createdAt: timestamp,
          updatedAt: timestamp,
        });

        transaction.update(publicPhotoRef, {
          reportsCount: safetyState.reportsCount,
          openReportsCount: safetyState.openReportsCount,
          confirmedReportsCount: safetyState.confirmedReportsCount,
          safetyScore: safetyState.safetyScore,
          ...(quarantine
            ? {
              moderationStatus: 'HIDDEN',
              moderationReason: QUARANTINE_REASON,
            }
            : {}),
          updatedAt: Date.now(),
        });

        if (quarantine) {
          transaction.set(
            publicationRef,
            {
              isPublished: true,
              visibility: 'PUBLIC',
              moderationStatus: 'FLAGGED',
              moderationReason: QUARANTINE_REASON,
              updatedAt: Date.now(),
            },
            { merge: true }
          );
        }

        return {
          publishedStoragePath:
            String(publication.publishedStoragePath ?? '').trim() || null,
          quarantine,
          evidenceRequired,
        };
      }
    );

    if (result.evidenceRequired) {
      await queueModerationEvidencePreservation({
        reportId,
        mediaType: 'PHOTO',
        ownerUid,
        mediaId: photoId,
        reason,
        sourceStoragePath: result.publishedStoragePath,
      });
    }

    return {
      reportId,
      contentQuarantined: result.quarantine,
      evidencePreservationRequired: result.evidenceRequired,
    };
  }
);
