import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  consumeBackendRateLimitQuota,
} from '../shared/security/backend-rate-limit.service';
import {
  assertComplianceAuthenticatedUid,
  cleanComplianceId,
  cleanComplianceText,
  normalizeAgeReverificationStatus,
} from './profile-age-reverification.shared';

const PROFILE_AGE_APPEAL_RATE_LIMIT = Object.freeze({
  burstWindowMs: 24 * 60 * 60 * 1_000,
  burstMax: 1,
  sustainedWindowMs: 30 * 24 * 60 * 60 * 1_000,
  sustainedMax: 3,
});

const ENFORCE_APP_CHECK = process.env.FUNCTIONS_EMULATOR !== 'true';

interface AppealProfileAgeReverificationRequest {
  statement?: string | null;
}

export const appealProfileAgeReverification = onCall<
  AppealProfileAgeReverificationRequest
>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: ENFORCE_APP_CHECK,
  },
  async (request): Promise<{
    caseId: string;
    reportId: string;
    status: 'UNDER_REVIEW';
  }> => {
    const uid = assertComplianceAuthenticatedUid(request.auth);
    const statement = cleanComplianceText(request.data?.statement, 4000);

    if (statement.length < 20) {
      throw new HttpsError(
        'invalid-argument',
        'Explique em pelo menos 20 caracteres por que a decisão deve ser revista.'
      );
    }

    await consumeBackendRateLimitQuota({
      action: 'compliance:appeal-profile-age-reverification',
      subject: uid,
      config: PROFILE_AGE_APPEAL_RATE_LIMIT,
      message:
        'Um pedido de revisão já foi enviado recentemente. Aguarde antes de tentar novamente.',
    });

    const userRef = db.collection('users').doc(uid);
    const appealRef = db.collection('compliance_cases').doc();
    const auditRef = db.collection('compliance_audit').doc();
    const nowMs = Date.now();

    const result = await db.runTransaction(async (transaction) => {
      const userSnapshot = await transaction.get(userRef);

      if (!userSnapshot.exists) {
        throw new HttpsError('not-found', 'Conta não encontrada.');
      }

      const user = userSnapshot.data() ?? {};
      const ageReverification =
        (user['ageReverification'] ?? {}) as Record<string, unknown>;
      const currentStatus = normalizeAgeReverificationStatus(
        ageReverification['status']
      );
      const caseId = cleanComplianceId(ageReverification['caseId']);
      const reportId = cleanComplianceId(ageReverification['reportId']);

      if (currentStatus !== 'REJECTED' || !caseId || !reportId) {
        throw new HttpsError(
          'failed-precondition',
          'Não há uma decisão de reverificação de idade elegível para contestação.'
        );
      }

      const caseRef = db.collection('age_reverification_cases').doc(caseId);
      const reportRef = db.collection('moderation_reports').doc(reportId);
      const [caseSnapshot, reportSnapshot] = await Promise.all([
        transaction.get(caseRef),
        transaction.get(reportRef),
      ]);

      if (!caseSnapshot.exists || !reportSnapshot.exists) {
        throw new HttpsError(
          'failed-precondition',
          'O caso original de reverificação não está disponível.'
        );
      }

      const existingAppealId = cleanComplianceId(
        caseSnapshot.data()?.['activeAppealCaseId']
      );

      if (existingAppealId) {
        throw new HttpsError(
          'already-exists',
          'Já existe uma contestação em análise para esta decisão.'
        );
      }

      const timestamp = FieldValue.serverTimestamp();

      transaction.set(
        userRef,
        {
          ageReverification: {
            ...ageReverification,
            status: 'UNDER_REVIEW',
            appealRequestedAt: nowMs,
            appealCaseId: appealRef.id,
          },
          // A contestação não restaura acesso antes de nova decisão confiável.
          publicVisibility: 'hidden',
          interactionBlocked: true,
          updatedAt: timestamp,
        },
        { merge: true }
      );

      transaction.set(
        caseRef,
        {
          status: 'UNDER_REVIEW',
          activeAppealCaseId: appealRef.id,
          appealRequestedAt: nowMs,
          updatedAt: timestamp,
        },
        { merge: true }
      );

      transaction.set(
        reportRef,
        {
          status: 'reviewing',
          ageReverificationStatus: 'UNDER_REVIEW',
          appealCaseId: appealRef.id,
          appealRequestedAt: nowMs,
          updatedAt: timestamp,
        },
        { merge: true }
      );

      transaction.create(appealRef, {
        caseId: appealRef.id,
        targetUid: uid,
        openedBy: uid,
        category: 'AGE_OR_IDENTITY',
        summary: 'Contestação de decisão de reverificação de maioridade.',
        policySection: 'age_verification',
        preventiveMeasure:
          'Acesso adulto permanece restrito durante a nova análise.',
        status: 'USER_RESPONDED',
        presumption: 'ACTION_APPLIED_APPEALABLE',
        sourceReportId: reportId,
        sourceAgeReverificationCaseId: caseId,
        responseDueAt: null,
        userResponse: statement,
        userRespondedAt: timestamp,
        resolution: null,
        resolvedAt: null,
        resolvedBy: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      transaction.create(auditRef, {
        uid,
        actorUid: uid,
        type: 'age_reverification.appeal_requested',
        reportId,
        caseId,
        appealCaseId: appealRef.id,
        source: 'web',
        createdAt: timestamp,
        createdAtMs: nowMs,
      });

      transaction.set(
        db.collection('notifications')
          .doc(`age_reverification_appeal_${uid}_${appealRef.id}`),
        {
          userId: uid,
          type: 'compliance.violation.response_received',
          title: 'Contestação recebida',
          body:
            'Sua contestação foi registrada. As restrições permanecem enquanto uma nova análise é realizada.',
          route: `/conta/conformidade?caseId=${encodeURIComponent(appealRef.id)}`,
          caseId: appealRef.id,
          actionRequired: false,
          readAt: null,
          createdAt: nowMs,
          updatedAt: nowMs,
        },
        { merge: true }
      );

      return { caseId, reportId };
    });

    return {
      ...result,
      status: 'UNDER_REVIEW',
    };
  }
);
