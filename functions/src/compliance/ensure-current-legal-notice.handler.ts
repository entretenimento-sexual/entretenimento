import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  PLATFORM_LEGAL_CHANGE_SUMMARY,
  PRIVACY_NOTICE_VERSION,
  TERMS_ACCEPTANCE_VERSION,
  TERMS_DOCUMENT_VERSION,
} from './platform-legal.constants';

export interface LegalAcceptanceState {
  current: boolean;
  hasPriorAcceptance: boolean;
  previousVersion: string | null;
}

export function resolveLegalAcceptanceState(
  value: unknown
): LegalAcceptanceState {
  if (!value || typeof value !== 'object') {
    return {
      current: false,
      hasPriorAcceptance: false,
      previousVersion: null,
    };
  }

  const record = value as Record<string, unknown>;
  const accepted = record['accepted'] === true;
  const previousVersion = String(record['version'] ?? '').trim() || null;
  const acknowledgedPrivacyNotice =
    record['acknowledgedPrivacyNotice'] === true;

  return {
    current:
      accepted &&
      previousVersion === TERMS_ACCEPTANCE_VERSION &&
      acknowledgedPrivacyNotice,
    hasPriorAcceptance: accepted && previousVersion !== null,
    previousVersion,
  };
}

function buildPendingLegalNoticeBody(): string {
  const changes = PLATFORM_LEGAL_CHANGE_SUMMARY.join('; ');
  return [
    `Revise e aceite a versão ${TERMS_ACCEPTANCE_VERSION}`,
    'para continuar usando os recursos da plataforma.',
    `Principais mudanças: ${changes}.`,
  ].join(' ');
}

export const ensureCurrentLegalNotice = onCall(
  { region: FUNCTIONS_REGION },
  async (request): Promise<{
    required: boolean;
    noticeCreated: boolean;
    version: string;
  }> => {
    const uid = String(request.auth?.uid ?? '').trim();

    if (!uid) {
      throw new HttpsError(
        'unauthenticated',
        'Faça login para consultar atualizações dos documentos legais.'
      );
    }

    const userRef = db.collection('users').doc(uid);
    const notificationRef = db
      .collection('notifications')
      .doc(`terms_update_required_${uid}_${TERMS_ACCEPTANCE_VERSION}`);
    const auditRef = db
      .collection('compliance_audit')
      .doc(`terms_update_notice_${uid}_${TERMS_ACCEPTANCE_VERSION}`);

    let required = false;
    let noticeCreated = false;

    await db.runTransaction(async (tx) => {
      const [userSnap, notificationSnap] = await Promise.all([
        tx.get(userRef),
        tx.get(notificationRef),
      ]);

      if (!userSnap.exists) {
        throw new HttpsError(
          'failed-precondition',
          'Conclua a criação da conta antes de consultar os documentos legais.'
        );
      }

      const legalState = resolveLegalAcceptanceState(
        userSnap.data()?.['acceptedTerms']
      );
      required = !legalState.current;

      /**
       * Usuários novos já estão na etapa obrigatória do cadastro. Criar uma
       * notificação dizendo que os documentos foram "atualizados" seria
       * redundante e incorreto. O aviso é reservado a quem já aceitou uma versão
       * anterior e precisa de reaceite material.
       */
      if (
        !required ||
        !legalState.hasPriorAcceptance ||
        notificationSnap.exists
      ) {
        return;
      }

      const now = FieldValue.serverTimestamp();

      tx.create(notificationRef, {
        userId: uid,
        type: 'compliance.terms.update_required',
        title: 'Documentos legais atualizados',
        body: buildPendingLegalNoticeBody(),
        route: '/register/aceitar-termos?reason=material_terms_update_required',
        legalVersion: TERMS_ACCEPTANCE_VERSION,
        termsDocumentVersion: TERMS_DOCUMENT_VERSION,
        privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
        previousVersion: legalState.previousVersion,
        actionRequired: true,
        readAt: null,
        createdAt: now,
        updatedAt: now,
      });

      tx.set(
        auditRef,
        {
          uid,
          type: 'terms.update_notice_issued',
          version: TERMS_ACCEPTANCE_VERSION,
          previousVersion: legalState.previousVersion,
          termsDocumentVersion: TERMS_DOCUMENT_VERSION,
          privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
          createdAt: now,
        },
        { merge: true }
      );

      noticeCreated = true;
    });

    return {
      required,
      noticeCreated,
      version: TERMS_ACCEPTANCE_VERSION,
    };
  }
);
