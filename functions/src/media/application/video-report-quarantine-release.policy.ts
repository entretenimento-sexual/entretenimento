/**
 * Causal, document-local release authority for a video quarantine.
 * Consumes snapshots already read inside the moderator Firestore transaction:
 * no extra reads, query scans, or client decisions.
 */
export const VIDEO_REPORT_QUARANTINE_REASON =
  'Conteúdo temporariamente indisponível durante análise de segurança.';

interface QuarantineReport {
  reason?: unknown;
  contentQuarantined?: unknown;
  quarantinedAssetVersion?: unknown;
}

interface QuarantinePublicVideo {
  id?: unknown;
  ownerUid?: unknown;
  visibility?: unknown;
  moderationStatus?: unknown;
  moderationReason?: unknown;
  preventiveReviewReportId?: unknown;
  activeVideoQuarantineReportId?: unknown;
  assetVersion?: unknown;
}

interface QuarantinePublication {
  ownerUid?: unknown;
  videoId?: unknown;
  isPublished?: unknown;
  visibility?: unknown;
  moderationStatus?: unknown;
  moderationReason?: unknown;
  preventiveReviewReportId?: unknown;
  activeVideoQuarantineReportId?: unknown;
  assetVersion?: unknown;
}

export function canReleaseVideoReportQuarantine(input: {
  reportId: string;
  ownerUid: string;
  videoId: string;
  report: QuarantineReport;
  video: QuarantinePublicVideo | null;
  publication: QuarantinePublication | null;
}): boolean {
  const { reportId, ownerUid, videoId, report, video, publication } = input;
  if (!reportId || !ownerUid || !videoId ||
      report.contentQuarantined !== true || !video || !publication ||
      video.ownerUid !== ownerUid || video.id !== videoId ||
      publication.ownerUid !== ownerUid || publication.videoId !== videoId ||
      publication.isPublished !== true ||
      video.visibility !== 'PUBLIC' ||
      publication.visibility !== 'PUBLIC') {
    return false;
  }

  // New reports fence the exact published version. Existing preventive
  // review reports created before this field existed retain the ID fence.
  if (Object.prototype.hasOwnProperty.call(report, 'quarantinedAssetVersion')) {
    const version = report.quarantinedAssetVersion;
    if (typeof version !== 'number' ||
        !Number.isSafeInteger(version) || version <= 0 ||
        video.assetVersion !== version ||
        publication.assetVersion !== version) {
      return false;
    }
  }

  const preventive = String(report.reason ?? '').trim().toLowerCase() ===
    'preventive_media_review';
  if (preventive) {
    return video.preventiveReviewReportId === reportId &&
      publication.preventiveReviewReportId === reportId &&
      !video.activeVideoQuarantineReportId &&
      !publication.activeVideoQuarantineReportId &&
      video.moderationStatus === 'PENDING_REVIEW' &&
      publication.moderationStatus === 'PENDING_REVIEW' &&
      !video.moderationReason &&
      !publication.moderationReason;
  }

  // A user report can release only the restriction it installed. A missing
  // causal marker is an older/ambiguous report: fail closed, never guess.
  return video.activeVideoQuarantineReportId === reportId &&
    publication.activeVideoQuarantineReportId === reportId &&
    !video.preventiveReviewReportId &&
    !publication.preventiveReviewReportId &&
    video.moderationStatus === 'HIDDEN' &&
    publication.moderationStatus === 'FLAGGED' &&
    video.moderationReason === VIDEO_REPORT_QUARANTINE_REASON &&
    publication.moderationReason === VIDEO_REPORT_QUARANTINE_REASON;
}
