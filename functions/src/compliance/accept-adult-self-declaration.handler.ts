// functions/src/compliance/accept-adult-self-declaration.handler.ts
// -----------------------------------------------------------------------------
// PROVISIONAL ADULT SELF-DECLARATION
// -----------------------------------------------------------------------------
// Operational mode used while no trusted age provider is contracted.
//
// Important:
// - SELF_DECLARED_ADULT is not VERIFIED_ADULT;
// - the browser cannot write the canonical age record directly;
// - stronger states (REVIEW_REQUIRED / DENIED_UNDERAGE) cannot be overridden;
// - future provider/KYC integration can replace this admission basis without
//   changing the canonical age domain.
// -----------------------------------------------------------------------------

import { FieldPath, Timestamp } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  evaluateCanonicalAgeEligibility,
} from './age-eligibility.policy';
import {
  projectionFromCanonicalAgeDecision,
  writeCanonicalAgeEligibilityInTransaction,
  type AgeEligibilityProjection,
} from './age-eligibility.service';
import {
  isAgeReverificationAssuranceUnresolved,
} from './profile-age-reverification.policy';
import {
  ADULT_SELF_DECLARATION_TEXT_PT_BR,
  ADULT_SELF_DECLARATION_VERSION,
  PRIVACY_NOTICE_VERSION,
  TERMS_ACCEPTANCE_VERSION,
  TERMS_DOCUMENT_VERSION,
} from './platform-legal.constants';

const ENFORCE_APP_CHECK = process.env.FUNCTIONS_EMULATOR !== 'true';

const AGE_ADMISSION_MODE =
  String(process.env.AGE_ADMISSION_MODE ?? 'SELF_DECLARATION')
    .trim()
    .toUpperCase() === 'VERIFIED_REQUIRED'
    ? 'VERIFIED_REQUIRED'
    : 'SELF_DECLARATION';

interface AcceptAdultSelfDeclarationRequest {
  confirmsAdult?: boolean;
}

function hasAcceptedCurrentTerms(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;

  const record = value as Record<string, unknown>;

  return (
    record['accepted'] === true &&
    String(record['version'] ?? '').trim() === TERMS_ACCEPTANCE_VERSION &&
    record['acknowledgedPrivacyNotice'] === true
  );
}

function positiveEpochMs(value: unknown): number | null {
  if (
    value &&
    typeof value === 'object' &&
    typeof (value as {toMillis?: unknown}).toMillis === 'function'
  ) {
    const millis = (value as {toMillis: () => number}).toMillis();
    return Number.isFinite(millis) && millis > 0
      ? Math.trunc(millis)
      : null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.trunc(parsed)
    : null;
}

function legalSnapshot(value: unknown) {
  const record = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};

  return {
    termsAcceptanceVersion:
      String(record['version'] ?? '').trim() || TERMS_ACCEPTANCE_VERSION,
    termsDocumentVersion:
      String(record['termsDocumentVersion'] ?? '').trim()
      || TERMS_DOCUMENT_VERSION,
    privacyNoticeVersion:
      String(record['privacyNoticeVersion'] ?? '').trim()
      || PRIVACY_NOTICE_VERSION,
    termsAcceptedAtMs:
      positiveEpochMs(record['acceptedAt'])
      ?? positiveEpochMs(record['date']),
    termsAcceptanceContext:
      String(record['acceptanceContext'] ?? '').trim() || null,
  };
}

async function findFirstLegacySelfDeclarationAtMs(
  uid: string
): Promise<number | null> {
  const prefix = `age_self_declaration_${uid}_`;
  const snapshot = await db
    .collection('compliance_audit')
    .orderBy(FieldPath.documentId())
    .startAt(prefix)
    .endAt(`${prefix}\uf8ff`)
    .limit(1)
    .get();

  if (snapshot.empty) return null;

  const data = snapshot.docs[0]?.data() ?? {};
  return positiveEpochMs(data['createdAtMs'])
    ?? positiveEpochMs(data['createdAt']);
}

export const acceptAdultSelfDeclaration =
  onCall<AcceptAdultSelfDeclarationRequest>(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: ENFORCE_APP_CHECK,
    },
    async (request): Promise<{
      uid: string;
      status: 'SELF_DECLARED_ADULT' | 'VERIFIED_ADULT';
      declaredAtMs: number | null;
      ageEligibility: AgeEligibilityProjection;
    }> => {
      const uid = String(request.auth?.uid ?? '').trim();

      if (!uid) {
        throw new HttpsError(
          'unauthenticated',
          'Faça login para confirmar sua maioridade.'
        );
      }

      if (request.auth?.token?.email_verified !== true) {
        throw new HttpsError(
          'failed-precondition',
          'Confirme seu e-mail antes de continuar.'
        );
      }

      if (AGE_ADMISSION_MODE === 'VERIFIED_REQUIRED') {
        throw new HttpsError(
          'failed-precondition',
          'A política atual exige verificação de maioridade por uma fonte confiável.'
        );
      }

      if (request.data?.confirmsAdult !== true) {
        throw new HttpsError(
          'invalid-argument',
          'Confirme explicitamente que você tem 18 anos ou mais.'
        );
      }

      const nowMs = Date.now();
      const userRef = db.collection('users').doc(uid);
      const recordRef = db.collection('age_eligibility_records').doc(uid);
      const declarationRef = db
        .collection('adult_self_declarations')
        .doc(uid);
      const auditRef = db
        .collection('compliance_audit')
        .doc(`age_self_declaration_${uid}`);
      const legacyDeclaredAtMs =
        await findFirstLegacySelfDeclarationAtMs(uid);

      return db.runTransaction(async (transaction) => {
        const [
          userSnapshot,
          recordSnapshot,
          declarationSnapshot,
        ] = await Promise.all([
          transaction.get(userRef),
          transaction.get(recordRef),
          transaction.get(declarationRef),
        ]);

        if (!userSnapshot.exists) {
          throw new HttpsError(
            'failed-precondition',
            'Conclua a criação da conta antes de confirmar sua maioridade.'
          );
        }

        const user = userSnapshot.data() ?? {};

        if (!hasAcceptedCurrentTerms(user['acceptedTerms'])) {
          throw new HttpsError(
            'failed-precondition',
            'Aceite os termos vigentes antes de confirmar sua maioridade.'
          );
        }

        if (isAgeReverificationAssuranceUnresolved(
          (user['ageReverification'] as Record<string, unknown> | null)
            ?.['status']
        )) {
          throw new HttpsError(
            'failed-precondition',
            'Sua conta possui uma verificação de segurança em andamento.'
          );
        }

        const current = evaluateCanonicalAgeEligibility({
          uid,
          rawRecord: recordSnapshot.exists ? recordSnapshot.data() : null,
          nowMs,
        });

        if (current.status === 'DENIED_UNDERAGE') {
          throw new HttpsError(
            'permission-denied',
            'O acesso adulto não está disponível para esta conta.'
          );
        }

        const obsoleteInitialReview =
          current.status === 'REVIEW_REQUIRED' &&
          current.source === 'INITIAL_VERIFICATION' &&
          current.method === 'MANUAL_REVIEW';

        if (
          current.status === 'REVIEW_REQUIRED' &&
          !obsoleteInitialReview
        ) {
          throw new HttpsError(
            'failed-precondition',
            'Sua conta possui uma verificação de segurança em andamento.'
          );
        }

        const existingDeclaration = declarationSnapshot.exists
          ? declarationSnapshot.data() ?? {}
          : null;
        const existingDeclaredAtMs = existingDeclaration
          ? positiveEpochMs(existingDeclaration['declaredAtMs'])
            ?? positiveEpochMs(existingDeclaration['declaredAt'])
          : null;

        if (existingDeclaration && existingDeclaredAtMs === null) {
          throw new HttpsError(
            'internal',
            'O registro histórico de maioridade está inconsistente.'
          );
        }

        const declaredAtMs =
          existingDeclaredAtMs
          ?? legacyDeclaredAtMs
          ?? nowMs;
        const migratedFromLegacyAudit =
          !existingDeclaration && legacyDeclaredAtMs !== null;
        const legal = legalSnapshot(user['acceptedTerms']);

        if (!existingDeclaration) {
          const declarationEvidence = {
            schemaVersion: 1,
            uid,
            type: 'adult_self_declaration',
            declaration: '18_PLUS',
            voluntary: true,
            explicitConfirmation: true,
            immutable: true,
            declaredAtMs,
            declaredAt: Timestamp.fromMillis(declaredAtMs),
            recordedAt: FieldValue.serverTimestamp(),
            source: 'web',
            evidenceOrigin: migratedFromLegacyAudit
              ? 'MIGRATED_EXISTING_AUDIT'
              : 'LIVE_DECLARATION',
            declarationTextVersion: migratedFromLegacyAudit
              ? 'legacy-audit'
              : ADULT_SELF_DECLARATION_VERSION,
            declarationText: migratedFromLegacyAudit
              ? null
              : ADULT_SELF_DECLARATION_TEXT_PT_BR,
            exactDeclarationTextCaptured: !migratedFromLegacyAudit,
            legalSnapshotCapturedAtDeclaration: !migratedFromLegacyAudit,
            ...legal,
          };

          transaction.create(declarationRef, declarationEvidence);
          transaction.create(auditRef, {
            uid,
            type: 'age_eligibility.self_declared_adult_evidence_created',
            declaration: '18_PLUS',
            voluntary: true,
            explicitConfirmation: true,
            eventAtMs: declaredAtMs,
            declarationEvidencePath: declarationRef.path,
            declarationEvidenceSchemaVersion: 1,
            evidenceOrigin: declarationEvidence.evidenceOrigin,
            declarationTextVersion:
              declarationEvidence.declarationTextVersion,
            termsAcceptanceVersion: legal.termsAcceptanceVersion,
            termsDocumentVersion: legal.termsDocumentVersion,
            privacyNoticeVersion: legal.privacyNoticeVersion,
            recordedAt: FieldValue.serverTimestamp(),
          });
        }

        if (current.status === 'VERIFIED_ADULT' && current.allowed) {
          const projection = projectionFromCanonicalAgeDecision(
            current,
            nowMs
          );

          if (!projection) {
            throw new HttpsError(
              'internal',
              'A projeção canônica de maioridade não pôde ser reconstruída.'
            );
          }

          transaction.set(
            userRef,
            {
              ageEligibility: projection,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );

          return {
            uid,
            status: 'VERIFIED_ADULT' as const,
            declaredAtMs,
            ageEligibility: projection,
          };
        }

        if (current.status === 'SELF_DECLARED_ADULT' && current.allowed) {
          const projection = projectionFromCanonicalAgeDecision(
            current,
            nowMs
          );

          if (projection) {
            transaction.set(
              userRef,
              {
                ageEligibility: projection,
                updatedAt: FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
          }

          if (!projection) {
            throw new HttpsError(
              'internal',
              'A projeção canônica de maioridade não pôde ser reconstruída.'
            );
          }

          return {
            uid,
            status: 'SELF_DECLARED_ADULT' as const,
            declaredAtMs,
            ageEligibility: projection,
          };
        }

        const projection = writeCanonicalAgeEligibilityInTransaction(
          transaction,
          {
            uid,
            status: 'SELF_DECLARED_ADULT',
            source: 'SELF_DECLARATION',
            method: 'SELF_DECLARATION',
            caseId: null,
            verifiedAtMs: null,
            decidedAtMs: nowMs,
            expiresAtMs: null,
          }
        );

        const timestamp = FieldValue.serverTimestamp();

        transaction.set(
          userRef,
          {
            ageEligibility: projection,
            updatedAt: timestamp,
          },
          { merge: true }
        );

        if (obsoleteInitialReview && current.caseId) {
          transaction.set(
            db.collection('moderation_reports').doc(current.caseId),
            {
              status: 'resolved',
              moderationAction: 'KEEP',
              resolution:
                'Fluxo inicial substituído pela política provisória de autodeclaração 18+.',
              reviewedBy: 'system:age-policy',
              reviewedAt: timestamp,
              updatedAt: timestamp,
            },
            { merge: true }
          );
        }

        return {
          uid,
          status: 'SELF_DECLARED_ADULT' as const,
          declaredAtMs,
          ageEligibility: projection,
        };
      });
    }
  );
