import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  PLATFORM_LEGAL_CHANGE_SUMMARY,
  PRIVACY_NOTICE_VERSION,
  TERMS_ACCEPTANCE_VERSION,
  TERMS_DOCUMENT_VERSION,
} from './platform-legal.constants';

interface AcceptPlatformTermsRequest {
  acceptedTerms: true;
  acknowledgedPrivacyNotice: true;
  adultAccessAcknowledgement: true;
}

interface ExistingTermsAcceptance {
  accepted?: unknown;
  version?: unknown;
}

export const acceptPlatformTerms = onCall<AcceptPlatformTermsRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<{
    ok: true;
    version: string;
    termsDocumentVersion: string;
    privacyNoticeVersion: string;
    acceptanceContext: 'initial' | 'material_update';
    previousVersion: string | null;
    acceptedAtMs: number;
  }> => {
    const uid = request.auth?.uid?.trim();

    if (!uid) {
      throw new HttpsError(
        'unauthenticated',
        'Faça login para aceitar os termos da plataforma.'
      );
    }

    if (
      request.data?.acceptedTerms !== true ||
      request.data?.acknowledgedPrivacyNotice !== true ||
      request.data?.adultAccessAcknowledgement !== true
    ) {
      throw new HttpsError(
        'invalid-argument',
        'Confirme os Termos de Uso, a ciência da Política de Privacidade e a condição de acesso adulto.'
      );
    }

    const acceptedAtMs = Date.now();
    const userRef = db.collection('users').doc(uid);
    const auditRef = db
      .collection('compliance_audit')
      .doc(`terms_acceptance_${uid}_${acceptedAtMs}`);
    const notificationRef = db
      .collection('notifications')
      .doc(`terms_update_ack_${uid}_${TERMS_ACCEPTANCE_VERSION}`);

    let previousVersion: string | null = null;
    let acceptanceContext: 'initial' | 'material_update' = 'initial';

    await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);

      if (!userSnap.exists) {
        throw new HttpsError(
          'failed-precondition',
          'Conclua a criação da conta antes de aceitar os termos.'
        );
      }

      const userData = userSnap.data() ?? {};
      const previous = (userData.acceptedTerms ?? {}) as ExistingTermsAcceptance;
      const normalizedPreviousVersion = String(previous.version ?? '').trim();

      previousVersion = normalizedPreviousVersion || null;
      acceptanceContext = previous.accepted === true && previousVersion
        ? 'material_update'
        : 'initial';

      const now = FieldValue.serverTimestamp();

      tx.set(
        userRef,
        {
          uid,
          acceptedTerms: {
            accepted: true,
            version: TERMS_ACCEPTANCE_VERSION,
            termsDocumentVersion: TERMS_DOCUMENT_VERSION,
            privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
            acknowledgedPrivacyNotice: true,
            adultAccessAcknowledgement: true,
            acceptanceContext,
            previousVersion,
            date: now,
            acceptedAt: now,
            updatedAt: now,
            source: 'web',
          },
        },
        { merge: true }
      );

      tx.set(auditRef, {
        uid,
        type: 'terms.accepted',
        version: TERMS_ACCEPTANCE_VERSION,
        termsDocumentVersion: TERMS_DOCUMENT_VERSION,
        privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
        acknowledgedPrivacyNotice: true,
        adultAccessAcknowledgement: true,
        acceptanceContext,
        previousVersion,
        source: 'web',
        createdAt: now,
      });

      tx.set(
        notificationRef,
        {
          userId: uid,
          type: 'compliance.terms.updated',
          title: acceptanceContext === 'material_update'
            ? 'Termos atualizados e aceitos'
            : 'Termos de Uso aceitos',
          body: acceptanceContext === 'material_update'
            ? `Seu reaceite da versão ${TERMS_ACCEPTANCE_VERSION} foi registrado. Principais mudanças: ${PLATFORM_LEGAL_CHANGE_SUMMARY.join('; ')}.`
            : `Seu aceite da versão ${TERMS_ACCEPTANCE_VERSION} foi registrado.`,
          route: '/termos-e-condicoes',
          legalVersion: TERMS_ACCEPTANCE_VERSION,
          readAt: null,
          createdAt: now,
          updatedAt: now,
        },
        { merge: true }
      );
    });

    return {
      ok: true,
      version: TERMS_ACCEPTANCE_VERSION,
      termsDocumentVersion: TERMS_DOCUMENT_VERSION,
      privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
      acceptanceContext,
      previousVersion,
      acceptedAtMs,
    };
  }
);
