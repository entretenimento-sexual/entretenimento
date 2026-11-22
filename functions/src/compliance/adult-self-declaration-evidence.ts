import { Timestamp, type Transaction } from 'firebase-admin/firestore';
import { db, FieldValue } from '../firebaseApp';
import {
  ADULT_SELF_DECLARATION_TEXT_PT_BR,
  ADULT_SELF_DECLARATION_VERSION,
} from './platform-legal.constants';

// Older readers only restore schema v1. Signup evidence must stay inactive
// until the authenticated e-mail and the current admission policy are checked.
export const SIGNUP_ADULT_DECLARATION_SCHEMA_VERSION = 2;

export function writeAdultSelfDeclarationEvidence(
  transaction: Transaction,
  input: {
    uid: string;
    declaredAtMs: number;
    origin: 'LIVE_DECLARATION' | 'MIGRATED_EXISTING_AUDIT' | 'SIGNUP_FORM';
    legalSnapshotCapturedAtDeclaration?: boolean;
    legal: {
      termsAcceptanceVersion: string;
      termsDocumentVersion: string;
      privacyNoticeVersion: string;
      termsAcceptedAtMs: number | null;
      termsAcceptanceContext: string | null;
    };
  },
): void {
  const { uid, declaredAtMs, origin, legal } = input;
  const migrated = origin === 'MIGRATED_EXISTING_AUDIT';
  const schemaVersion = origin === 'SIGNUP_FORM' ? SIGNUP_ADULT_DECLARATION_SCHEMA_VERSION : 1;
  const declarationRef = db.collection('adult_self_declarations').doc(uid);
  const auditRef = db.collection('compliance_audit').doc(`age_self_declaration_${uid}`);
  const declaration = {
    declaration: '18_PLUS',
    voluntary: true,
    explicitConfirmation: true,
  };
  const declarationTextVersion = migrated ? 'legacy-audit' : ADULT_SELF_DECLARATION_VERSION;
  const recordedAt = FieldValue.serverTimestamp();

  transaction.create(declarationRef, {
    ...declaration,
    schemaVersion,
    uid,
    type: 'adult_self_declaration',
    immutable: true,
    declaredAtMs,
    declaredAt: Timestamp.fromMillis(declaredAtMs),
    recordedAt,
    source: 'web',
    evidenceOrigin: origin,
    declarationTextVersion,
    declarationText: migrated ? null : ADULT_SELF_DECLARATION_TEXT_PT_BR,
    exactDeclarationTextCaptured: !migrated,
    legalSnapshotCapturedAtDeclaration: input.legalSnapshotCapturedAtDeclaration ?? !migrated,
    ...legal,
  });
  transaction.create(auditRef, {
    ...declaration,
    uid,
    type: 'age_eligibility.self_declared_adult_evidence_created',
    eventAtMs: declaredAtMs,
    declarationEvidencePath: declarationRef.path,
    declarationEvidenceSchemaVersion: schemaVersion,
    evidenceOrigin: origin,
    declarationTextVersion,
    termsAcceptanceVersion: legal.termsAcceptanceVersion,
    termsDocumentVersion: legal.termsDocumentVersion,
    privacyNoticeVersion: legal.privacyNoticeVersion,
    recordedAt,
  });
}
