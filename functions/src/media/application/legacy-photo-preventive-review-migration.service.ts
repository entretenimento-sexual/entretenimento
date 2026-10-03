import { db, FieldValue } from '../../firebaseApp';

export type LegacyPhotoModerationMigrationState =
  | 'normalized'
  | 'not_found'
  | 'not_legacy_preventive_review'
  | 'real_moderation_present';

interface PhotoPublicationDocument {
  isPublished?: unknown;
  moderationStatus?: unknown;
  moderationReason?: unknown;
  preventiveReviewReportId?: unknown;
  reportsCount?: unknown;
  confirmedReportsCount?: unknown;
}

interface PublicPhotoDocument {
  moderationStatus?: unknown;
  moderationReason?: unknown;
  preventiveReviewReportId?: unknown;
  reportsCount?: unknown;
  confirmedReportsCount?: unknown;
}

interface ModerationReportDocument {
  reporterUid?: unknown;
  targetType?: unknown;
  targetId?: unknown;
  targetOwnerUid?: unknown;
  reason?: unknown;
  source?: unknown;
  status?: unknown;
}

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function cleanCount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

/**
 * Remove somente a quarentena sintética criada pelo antigo fluxo de
 * pré-moderação. Denúncias reais, flags e qualquer estado restrito não
 * originado por preventive_media_review permanecem intocados.
 */
export async function normalizeLegacyPhotoPreventiveReview(
  ownerUid: string,
  photoId: string
): Promise<LegacyPhotoModerationMigrationState> {
  const publicationRef = db.doc(
    `users/${ownerUid}/photo_publications/${photoId}`
  );
  const publicPhotoRef = db.doc(
    `public_profiles/${ownerUid}/public_photos/${photoId}`
  );

  return db.runTransaction(async (transaction) => {
    const [publicationSnap, publicPhotoSnap] = await Promise.all([
      transaction.get(publicationRef),
      transaction.get(publicPhotoRef),
    ]);

    if (!publicationSnap.exists || !publicPhotoSnap.exists) {
      return 'not_found';
    }

    const publication = publicationSnap.data() as PhotoPublicationDocument;
    const publicPhoto = publicPhotoSnap.data() as PublicPhotoDocument;

    if (
      publication.isPublished !== true ||
      cleanText(publication.moderationStatus).toUpperCase() !== 'PENDING_REVIEW' ||
      cleanText(publicPhoto.moderationStatus).toUpperCase() !== 'PENDING_REVIEW'
    ) {
      return 'not_legacy_preventive_review';
    }

    if (
      cleanCount(publication.reportsCount) > 0 ||
      cleanCount(publication.confirmedReportsCount) > 0 ||
      cleanCount(publicPhoto.reportsCount) > 0 ||
      cleanCount(publicPhoto.confirmedReportsCount) > 0
    ) {
      return 'real_moderation_present';
    }

    const reportId = cleanText(
      publication.preventiveReviewReportId ??
      publicPhoto.preventiveReviewReportId
    );

    if (!reportId) {
      return 'not_legacy_preventive_review';
    }

    const reportRef = db.collection('moderation_reports').doc(reportId);
    const reportSnap = await transaction.get(reportRef);

    if (!reportSnap.exists) {
      return 'not_legacy_preventive_review';
    }

    const report = reportSnap.data() as ModerationReportDocument;
    const isSyntheticLegacyReview =
      cleanText(report.reporterUid) === 'system' &&
      cleanText(report.targetType).toLowerCase() === 'photo' &&
      cleanText(report.targetId) === photoId &&
      cleanText(report.targetOwnerUid) === ownerUid &&
      cleanText(report.reason) === 'preventive_media_review' &&
      cleanText(report.source) === 'system';

    if (!isSyntheticLegacyReview) {
      return 'real_moderation_present';
    }

    const timestamp = FieldValue.serverTimestamp();

    transaction.set(
      publicationRef,
      {
        moderationStatus: 'APPROVED',
        moderationReason: null,
        preventiveReviewReportId: FieldValue.delete(),
        reviewEvidenceRetention: FieldValue.delete(),
        moderatedBy: FieldValue.delete(),
        lastModeratedAt: FieldValue.delete(),
        updatedAt: timestamp,
      },
      { merge: true }
    );

    transaction.set(
      publicPhotoRef,
      {
        moderationStatus: 'APPROVED',
        moderationReason: null,
        preventiveReviewReportId: FieldValue.delete(),
        updatedAt: timestamp,
      },
      { merge: true }
    );

    transaction.set(
      reportRef,
      {
        status: 'closed',
        contentQuarantined: false,
        moderationAction: 'LEGACY_PREVENTIVE_REVIEW_RELEASED',
        updatedAt: timestamp,
      },
      { merge: true }
    );

    return 'normalized';
  });
}
