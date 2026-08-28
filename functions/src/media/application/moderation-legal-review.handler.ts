import * as logger from 'firebase-functions/logger';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, FieldValue } from '../../firebaseApp';
import {
  shouldPreserveMediaEvidence,
  type MediaReportSafetyReason,
} from './media-report-safety';

export const MODERATION_LEGAL_REVIEW_COLLECTION =
  'moderation_legal_review_cases';

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,180}$/.test(normalized) ? normalized : '';
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

function isSupportedTargetType(value: unknown): boolean {
  return ['photo', 'video', 'video_comment'].includes(
    String(value ?? '').trim().toLowerCase()
  );
}

/**
 * Abre uma etapa jurídico/compliance somente depois de a moderação confirmar
 * REMOVE em categoria de alto risco.
 *
 * IMPORTANTE:
 * - uma denúncia de usuário, sozinha, nunca dispara comunicação a autoridade;
 * - este caso não conclui que houve crime;
 * - evidence/content não é exposto ao cliente;
 * - eventual encaminhamento deve ocorrer por fluxo legal específico, auditado
 *   e compatível com a base jurídica/procedimento aplicável.
 */
export const queueHighRiskModerationLegalReview = onDocumentUpdated(
  {
    document: 'moderation_reports/{reportId}',
    region: FUNCTIONS_REGION,
    retry: true,
  },
  async (event): Promise<void> => {
    const reportId = cleanId(event.params.reportId);
    const after = event.data?.after.data();

    if (!reportId || !after) {
      return;
    }

    const status = String(after.status ?? '').trim().toLowerCase();
    const moderationAction = String(after.moderationAction ?? '')
      .trim()
      .toUpperCase();
    const targetType = String(after.targetType ?? '').trim().toLowerCase();
    const reason = cleanReason(after.reason);

    if (
      status !== 'resolved' ||
      moderationAction !== 'REMOVE' ||
      !isSupportedTargetType(targetType) ||
      !reason ||
      !shouldPreserveMediaEvidence(reason)
    ) {
      return;
    }

    const caseRef = db.collection(MODERATION_LEGAL_REVIEW_COLLECTION).doc(reportId);
    const reportRef = db.collection('moderation_reports').doc(reportId);
    const existingCaseSnap = await caseRef.get();
    const targetOwnerUid = cleanId(after.targetOwnerUid);
    const targetId = cleanId(after.targetId);
    const parentTargetId = cleanId(after.parentTargetId) || null;
    const evidencePreservationStatus = String(
      after.evidencePreservationStatus ?? 'PENDING'
    )
      .trim()
      .toUpperCase();
    const timestamp = FieldValue.serverTimestamp();

    await caseRef.set(
      {
        reportId,
        targetType,
        targetId,
        parentTargetId,
        targetOwnerUid,
        reason,
        moderationDecision: 'REMOVE',
        moderationResolution: String(after.resolution ?? '')
          .trim()
          .slice(0, 900) || null,
        evidencePreservationStatus,
        contentQuarantined: after.contentQuarantined === true,
        status: 'PENDING_LEGAL_REVIEW',
        legalReviewReason: 'HIGH_RISK_CONFIRMED_MODERATION',
        authorityDisclosureStatus: 'NOT_EVALUATED',
        automaticDisclosure: false,
        accessPolicy: 'BACKEND_ONLY',
        ...(!existingCaseSnap.exists ? { createdAt: timestamp } : {}),
        updatedAt: timestamp,
      },
      { merge: true }
    );

    if (
      String(after.legalReviewStatus ?? '').trim().toUpperCase() !==
      'PENDING_LEGAL_REVIEW'
    ) {
      try {
        await reportRef.set(
          {
            legalReviewStatus: 'PENDING_LEGAL_REVIEW',
            legalReviewUpdatedAt: timestamp,
          },
          { merge: true }
        );
      } catch (error) {
        logger.error('[queueHighRiskModerationLegalReview] Falha ao marcar report.', {
          reportId,
          error: error instanceof Error
            ? error.message.slice(0, 500)
            : String(error ?? '').slice(0, 500),
        });
        throw error;
      }
    }
  }
);
