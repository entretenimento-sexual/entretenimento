import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  PRIVACY_NOTICE_VERSION,
  TERMS_ACCEPTANCE_VERSION,
  TERMS_DOCUMENT_VERSION,
} from './platform-legal.constants';

interface AcceptPlatformTermsRequest {
  acceptedTerms: true;
  acknowledgedPrivacyNotice: true;
}

interface ExistingTermsAcceptance {
  accepted?: unknown;
  version?: unknown;
}

export const acceptPlatformTerms = onCall<AcceptPlatformTermsRequest>(
  {
    region: FUNCTIONS_REGION,
    cors: true,
    invoker: 'public',
  },
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
      request.data?.acknowledgedPrivacyNotice !== true
    ) {
      throw new HttpsError(
        'invalid-argument',
        'Confirme o aceite dos Termos de Uso e a ciência da Política de Privacidade.'
      );
    }

    const acceptedAtMs = Date.now();
    const userRef = db.collection('users').doc(uid);
    const auditRef = db
      .collection('compliance_audit')
      .doc(`terms_acceptance_${uid}_${acceptedAtMs}`);
    const pendingNotificationRef = db
      .collection('notifications')
      .doc(`terms_update_required_${uid}_${TERMS_ACCEPTANCE_VERSION}`);

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
        acceptanceContext,
        previousVersion,
        source: 'web',
        createdAt: now,
      });

      /**
       * SUPRESSÕES EXPLÍCITAS:
       * - não criamos uma nova notificação de "aceite concluído", pois o usuário
       *   acabou de executar a ação e o registro auditável já existe;
       * - removemos o aviso pendente da versão aceita para não manter uma ação
       *   obsoleta na central de notificações;
       * - a confirmação de maioridade permanece no fluxo separado de acesso
       *   adulto e não é duplicada neste contrato.
       */
      tx.delete(pendingNotificationRef);
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
