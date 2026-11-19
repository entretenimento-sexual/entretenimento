import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  assertRegistrationPasswordDefined,
  emailLinkSignupEvidenceRef,
} from '../registration/email-link-preview.handler';
import { assertCallableAppCheck } from '../shared/security/callable-app-check';
import { writeAdultSelfDeclarationEvidence } from './adult-self-declaration-evidence';
import {
  ADULT_SELF_DECLARATION_VERSION,
  PRIVACY_NOTICE_VERSION,
  TERMS_ACCEPTANCE_VERSION,
  TERMS_DOCUMENT_VERSION,
} from './platform-legal.constants';

interface AcceptPlatformTermsRequest {
  expectedUid?: unknown;
  acceptedTerms: true;
  acknowledgedPrivacyNotice: true;
  signupAdultDeclarationVersion?: unknown;
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
    signupAdultDeclarationRecorded?: true;
  }> => {
    const uid = request.auth?.uid?.trim();

    if (!uid) {
      throw new HttpsError(
        'unauthenticated',
        'Faça login para aceitar os termos da plataforma.'
      );
    }

    if (request.data?.expectedUid !== undefined && request.data.expectedUid !== uid) {
      throw new HttpsError('permission-denied', 'A conta ativa mudou durante o aceite dos termos.');
    }
    await assertRegistrationPasswordDefined(uid);

    if (
      request.data?.acceptedTerms !== true ||
      request.data?.acknowledgedPrivacyNotice !== true
    ) {
      throw new HttpsError(
        'invalid-argument',
        'Confirme o aceite dos Termos de Uso e a ciência da Política de Privacidade.'
      );
    }

    const signupVersion = request.data?.signupAdultDeclarationVersion;
    const signupDeclarationRequested = signupVersion !== undefined;
    if (signupDeclarationRequested) {
      assertCallableAppCheck(request.app);
      if (request.data?.expectedUid !== uid) {
        throw new HttpsError('permission-denied', 'A conta ativa mudou durante o cadastro.');
      }
      if (signupVersion !== ADULT_SELF_DECLARATION_VERSION) {
        throw new HttpsError('invalid-argument', 'Revise a declaração de maioridade vigente.');
      }
    }

    const nowMs = Date.now();
    const userRef = db.collection('users').doc(uid);
    const auditRef = db
      .collection('compliance_audit')
      .doc(`terms_acceptance_${uid}_${nowMs}`);
    const pendingNotificationRef = db
      .collection('notifications')
      .doc(`terms_update_required_${uid}_${TERMS_ACCEPTANCE_VERSION}`);

    const acceptance = await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);

      if (!userSnap.exists) {
        throw new HttpsError(
          'failed-precondition',
          'Conclua a criação da conta antes de aceitar os termos.',
          { reason: 'registration/seed-pending' },
        );
      }

      const userData = userSnap.data() ?? {};
      const emailLinkEvidence = emailLinkSignupEvidenceRef(uid);
      const preparedDeclaration = emailLinkEvidence && userData.profileCompleted !== true &&
        request.auth?.token?.email_verified === true
        ? (await tx.get(emailLinkEvidence)).data() : undefined;
      const preparedAtMs = preparedDeclaration?.adultDeclaredAtMs;
      const usePreparedDeclaration = preparedDeclaration?.adultDeclarationVersion === ADULT_SELF_DECLARATION_VERSION &&
        typeof preparedAtMs === 'number' && preparedAtMs > 0 && preparedAtMs <= nowMs;
      const recordSignupDeclaration = signupDeclarationRequested || usePreparedDeclaration;
      const previous = (userData.acceptedTerms ?? {}) as Record<string, unknown>;
      const normalizedPreviousVersion = String(previous.version ?? '').trim();
      const priorDate = previous.acceptedAt ?? previous.date;
      const previouslyAcceptedAtMs = recordSignupDeclaration &&
        previous.accepted === true &&
        normalizedPreviousVersion === TERMS_ACCEPTANCE_VERSION &&
        previous.acknowledgedPrivacyNotice === true &&
        previous.termsDocumentVersion === TERMS_DOCUMENT_VERSION &&
        previous.privacyNoticeVersion === PRIVACY_NOTICE_VERSION &&
        priorDate instanceof Timestamp
        ? priorDate.toMillis()
        : null;
      const previousVersion = previouslyAcceptedAtMs !== null
        ? (typeof previous.previousVersion === 'string' ? previous.previousVersion : null)
        : normalizedPreviousVersion || null;
      const acceptanceContext: 'initial' | 'material_update' = previouslyAcceptedAtMs !== null
        ? (previous.acceptanceContext === 'material_update' ? 'material_update' : 'initial')
        : previous.accepted === true && previousVersion
          ? 'material_update'
          : 'initial';

      if (recordSignupDeclaration) {
        if (userData.profileCompleted === true || userData.accountStatus !== 'active' ||
            userData.accountLocked === true || userData.suspended === true ||
            userData.loginAllowed === false || userData.deletionRequestedAt != null) {
          throw new HttpsError('failed-precondition', 'A conta não está disponível para concluir o cadastro.');
        }
        const evidence = await tx.get(db.collection('adult_self_declarations').doc(uid));
        if (!evidence.exists) {
          writeAdultSelfDeclarationEvidence(tx, {
            uid,
            declaredAtMs: usePreparedDeclaration ? preparedAtMs : nowMs,
            origin: 'SIGNUP_FORM',
            legalSnapshotCapturedAtDeclaration: !usePreparedDeclaration,
            legal: {
              termsAcceptanceVersion: TERMS_ACCEPTANCE_VERSION,
              termsDocumentVersion: TERMS_DOCUMENT_VERSION,
              privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
              termsAcceptedAtMs: previouslyAcceptedAtMs ?? nowMs,
              termsAcceptanceContext: acceptanceContext,
            },
          });
        }
        if (previouslyAcceptedAtMs !== null) {
          return { acceptedAtMs: previouslyAcceptedAtMs, previousVersion, acceptanceContext, recordSignupDeclaration };
        }
      }

      const now = FieldValue.serverTimestamp();
      const acceptedAt = recordSignupDeclaration ? Timestamp.fromMillis(nowMs) : now;

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
            date: acceptedAt,
            acceptedAt,
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
       * A autodeclaração coletada no cadastro é evidência privada. A decisão
       * 18+ é reconciliada em outra etapa, após a verificação do e-mail.
       */
      tx.delete(pendingNotificationRef);
      return { acceptedAtMs: nowMs, previousVersion, acceptanceContext, recordSignupDeclaration };
    });

    const { recordSignupDeclaration, ...result } = acceptance;
    return {
      ok: true,
      version: TERMS_ACCEPTANCE_VERSION,
      termsDocumentVersion: TERMS_DOCUMENT_VERSION,
      privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
      ...result,
      ...(recordSignupDeclaration ? { signupAdultDeclarationRecorded: true as const } : {}),
    };
  }
);
