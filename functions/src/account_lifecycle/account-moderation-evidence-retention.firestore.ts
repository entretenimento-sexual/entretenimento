// functions/src/account_lifecycle/account-moderation-evidence-retention.firestore.ts
// -----------------------------------------------------------------------------
// FIRESTORE ADAPTER FOR MODERATION REPORTS AND EVIDENCE RETENTION
// -----------------------------------------------------------------------------
// Denúncias e auditorias permanecem como evidência interna restrita. Somente as
// referências diretas à conta excluída são pseudonimizadas; índices operacionais
// de deduplicação e backups temporários de perfil são removidos.
// -----------------------------------------------------------------------------
import { createHash } from 'node:crypto';

import { db, FieldValue } from '../firebaseApp';
import type {
  AccountModerationEvidenceRetentionAdapter,
  AdminLogIdentityField,
  AgeReverificationIdentityField,
  ComplianceAuditIdentityField,
  ModerationDedupIdentityField,
  ModerationReportIdentityField,
} from './account-moderation-evidence-retention.executor';

const MODERATION_EVIDENCE_RETENTION_POLICY_VERSION = 1;
const MAX_BATCH_WRITES = 400;

export class FirestoreAccountModerationEvidenceRetentionAdapter
implements AccountModerationEvidenceRetentionAdapter
{
  async anonymizeModerationReportsPage(
    uid: string,
    field: ModerationReportIdentityField,
    limit: number
  ): Promise<number> {
    const safeUid = requireUid(uid);
    const safeLimit = normalizeLimit(limit);
    let query: FirebaseFirestore.Query = db
      .collection('moderation_reports')
      .where(field, '==', safeUid);

    if (field === 'targetId') {
      query = query.where('targetType', '==', 'profile');
    }

    const snapshot = await query.limit(safeLimit).get();
    await updateDocuments(
      snapshot.docs,
      'moderation_reports',
      (document) => buildReportPatch(document.data(), field, safeUid)
    );
    return snapshot.size;
  }

  async deleteModerationDedupPage(
    uid: string,
    field: ModerationDedupIdentityField,
    limit: number
  ): Promise<number> {
    const safeUid = requireUid(uid);
    const snapshot = await db
      .collection('moderation_report_dedup')
      .where(field, '==', safeUid)
      .limit(normalizeLimit(limit))
      .get();

    await deleteDocuments(snapshot.docs, 'moderation_report_dedup');
    return snapshot.size;
  }

  async anonymizeAgeReverificationCasesPage(
    uid: string,
    field: AgeReverificationIdentityField,
    limit: number
  ): Promise<number> {
    const safeUid = requireUid(uid);
    const snapshot = await db
      .collection('age_reverification_cases')
      .where(field, '==', safeUid)
      .limit(normalizeLimit(limit))
      .get();

    await updateDocuments(
      snapshot.docs,
      'age_reverification_cases',
      (document) => buildAgeCasePatch(document.data(), field, safeUid)
    );
    return snapshot.size;
  }

  async anonymizeComplianceAuditPage(
    uid: string,
    field: ComplianceAuditIdentityField,
    limit: number
  ): Promise<number> {
    const safeUid = requireUid(uid);
    const snapshot = await db
      .collection('compliance_audit')
      .where(field, '==', safeUid)
      .limit(normalizeLimit(limit))
      .get();

    await updateDocuments(
      snapshot.docs,
      'compliance_audit',
      () => buildAuditPatch(field, safeUid)
    );
    return snapshot.size;
  }

  async anonymizeAdminLogsPage(
    uid: string,
    field: AdminLogIdentityField,
    limit: number
  ): Promise<number> {
    const safeUid = requireUid(uid);
    const snapshot = await db
      .collection('admin_logs')
      .where(field, '==', safeUid)
      .limit(normalizeLimit(limit))
      .get();

    await updateDocuments(
      snapshot.docs,
      'admin_logs',
      () => buildAdminLogPatch(field, safeUid)
    );
    return snapshot.size;
  }
}

function buildReportPatch(
  data: FirebaseFirestore.DocumentData,
  field: ModerationReportIdentityField,
  uid: string
): FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> {
  if (normalizeId(data[field]) !== uid) {
    throw new Error('inconsistent-moderation-report-identity');
  }

  return {
    [field]: deletedUserReference(uid),
    [reportIdentityStateField(field)]:
      'pseudonymized_after_account_deletion',
    evidenceRetentionCategory: 'platform-safety',
    evidenceRetentionPolicyVersion:
      MODERATION_EVIDENCE_RETENTION_POLICY_VERSION,
    identityUpdatedAt: FieldValue.serverTimestamp(),
  };
}

function buildAgeCasePatch(
  data: FirebaseFirestore.DocumentData,
  field: AgeReverificationIdentityField,
  uid: string
): FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> {
  if (normalizeId(data[field]) !== uid) {
    throw new Error('inconsistent-age-case-identity');
  }

  const patch: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> = {
    [field]: deletedUserReference(uid),
    [ageCaseIdentityStateField(field)]:
      'pseudonymized_after_account_deletion',
    evidenceRetentionCategory: 'minor-safety-compliance',
    evidenceRetentionPolicyVersion:
      MODERATION_EVIDENCE_RETENTION_POLICY_VERSION,
    identityUpdatedAt: FieldValue.serverTimestamp(),
  };

  if (field === 'targetUid') {
    patch['publicProfileBackup'] = FieldValue.delete();
    patch['nicknameIndexBackup'] = FieldValue.delete();
    patch['nicknameIndexDocId'] = FieldValue.delete();
    patch['evidenceMinimizedAt'] = FieldValue.serverTimestamp();
    patch['evidenceMinimizationReason'] =
      'account-deletion-removed-operational-profile-backups';
  }

  return patch;
}

function buildAuditPatch(
  field: ComplianceAuditIdentityField,
  uid: string
): FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> {
  return {
    [field]: deletedUserReference(uid),
    [field === 'uid' ? 'subjectIdentityState' : 'actorIdentityState']:
      'pseudonymized_after_account_deletion',
    evidenceRetentionCategory: 'minor-safety-compliance',
    evidenceRetentionPolicyVersion:
      MODERATION_EVIDENCE_RETENTION_POLICY_VERSION,
    identityUpdatedAt: FieldValue.serverTimestamp(),
  };
}

function buildAdminLogPatch(
  field: AdminLogIdentityField,
  uid: string
): FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> {
  return {
    [field]: deletedUserReference(uid),
    [field === 'adminUid' ? 'adminIdentityState' : 'targetIdentityState']:
      'pseudonymized_after_account_deletion',
    evidenceRetentionCategory: 'administrative-security-audit',
    evidenceRetentionPolicyVersion:
      MODERATION_EVIDENCE_RETENTION_POLICY_VERSION,
    identityUpdatedAt: FieldValue.serverTimestamp(),
  };
}

function reportIdentityStateField(
  field: ModerationReportIdentityField
): string {
  const fields: Record<ModerationReportIdentityField, string> = {
    reporterUid: 'reporterIdentityState',
    targetOwnerUid: 'targetOwnerIdentityState',
    targetAuthorUid: 'targetAuthorIdentityState',
    targetId: 'targetIdentityState',
    reviewedBy: 'reviewerIdentityState',
  };

  return fields[field];
}

function ageCaseIdentityStateField(
  field: AgeReverificationIdentityField
): string {
  const fields: Record<AgeReverificationIdentityField, string> = {
    targetUid: 'targetIdentityState',
    requestedBy: 'requesterIdentityState',
    reviewedBy: 'reviewerIdentityState',
  };

  return fields[field];
}

async function updateDocuments(
  documents: readonly FirebaseFirestore.QueryDocumentSnapshot[],
  expectedCollection: string,
  patchFactory: (
    document: FirebaseFirestore.QueryDocumentSnapshot
  ) => FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>
): Promise<void> {
  for (let offset = 0; offset < documents.length; offset += MAX_BATCH_WRITES) {
    const batch = db.batch();
    const chunk = documents.slice(offset, offset + MAX_BATCH_WRITES);

    chunk.forEach((document) => {
      assertTopLevelDocumentPath(document.ref.path, expectedCollection);
      batch.update(document.ref, patchFactory(document));
    });

    await batch.commit();
  }
}

async function deleteDocuments(
  documents: readonly FirebaseFirestore.QueryDocumentSnapshot[],
  expectedCollection: string
): Promise<void> {
  for (let offset = 0; offset < documents.length; offset += MAX_BATCH_WRITES) {
    const batch = db.batch();
    const chunk = documents.slice(offset, offset + MAX_BATCH_WRITES);

    chunk.forEach((document) => {
      assertTopLevelDocumentPath(document.ref.path, expectedCollection);
      batch.delete(document.ref);
    });

    await batch.commit();
  }
}

function assertTopLevelDocumentPath(
  rawPath: string,
  expectedCollection: string
): void {
  const segments = String(rawPath ?? '').split('/');
  const valid =
    segments.length === 2 &&
    segments[0] === expectedCollection &&
    isSafeDocumentId(segments[1]);

  if (!valid) {
    throw new Error(`unexpected-${expectedCollection}-path`);
  }
}

function normalizeLimit(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 200) : 100;
}

function normalizeId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return isSafeUid(normalized) ? normalized : null;
}

function isSafeUid(value: unknown): boolean {
  return /^[A-Za-z0-9:_-]{1,128}$/.test(String(value ?? ''));
}

function isSafeDocumentId(value: unknown): boolean {
  const normalized = String(value ?? '').trim();
  return normalized.length > 0 &&
    normalized.length <= 180 &&
    !normalized.includes('/');
}

function requireUid(value: unknown): string {
  const uid = normalizeId(value);
  if (!uid) throw new Error('UID inválido para retenção de moderação.');
  return uid;
}

function deletedUserReference(uid: string): string {
  const key = createHash('sha256').update(uid).digest('hex').slice(0, 24);
  return `deleted:${key}`;
}
