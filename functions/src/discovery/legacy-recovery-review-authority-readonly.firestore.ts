// Issue #236 / B2.9.2a — backend-only, isolated, observational authority bridge.
// Never authorize migration, preservation writes, deletion, consumption or visibility.
// Independent sequential reads CANNOT establish transactional authorization.
import {
  inspectLegacyRecoveryAdminReadOnly,
  LEGACY_RECOVERY_APPROVAL_COLLECTION,
  LEGACY_RECOVERY_READONLY_PROJECT,
  type LegacyRecoveryReadOnlyBackend,
  type LegacyRecoveryReadOnlyRequest,
} from './legacy-recovery-admin-readonly.firestore';

const PURPOSE = 'PRIVATE_LEGACY_DISCOVERY_PRESERVATION_REVIEW';
const WINDOW_MS = 15 * 60_000;
const UID = /^[A-Za-z0-9_-]{1,128}$/;
const OP_ID = /^[A-Za-z0-9_-]{12,128}$/;
const KEYS = [
  'schemaVersion', 'operationId', 'purpose', 'projectId', 'targetCollection',
  'candidateCount', 'legacyEntryCount', 'requestedByUid', 'requestedAtMs',
  'approvedByUid', 'approvedAtMs', 'expiresAtMs', 'revokedAtMs',
  'consumedAtMs', 'expiredAtMs', 'status', 'revision',
] as const;

export interface LegacyRecoveryReviewAuthorityReadOnlyReport {
  phase: 'B2_9_2A_BACKEND_READ_ONLY';
  decision: 'BLOCKED';
  b27EvidenceCompatible: boolean;
  lifecycleSchemaCompatible: boolean;
  lifecycleRevisionCurrent: boolean;
  principalsRechecked: boolean;
  reviewEvidenceConsistent: boolean;
  sequentialReadsOnly: true;
  transactionAtomicityProven: false;
  approvalWriterIntegrated: false;
  approvalConsumed: false;
  auditPersisted: false;
  privateRecoveryRead: false;
  privateRecoveryWritten: false;
  persistentWritesAllowed: false;
  sourceDeletionAllowed: false;
  publicVisibilityAllowed: false;
}

function report(fields: Partial<Pick<LegacyRecoveryReviewAuthorityReadOnlyReport,
  'b27EvidenceCompatible' | 'lifecycleSchemaCompatible' |
  'lifecycleRevisionCurrent' | 'principalsRechecked' |
  'reviewEvidenceConsistent'>> = {}
): LegacyRecoveryReviewAuthorityReadOnlyReport {
  return Object.freeze({
    phase: 'B2_9_2A_BACKEND_READ_ONLY', decision: 'BLOCKED',
    b27EvidenceCompatible: fields.b27EvidenceCompatible === true,
    lifecycleSchemaCompatible: fields.lifecycleSchemaCompatible === true,
    lifecycleRevisionCurrent: fields.lifecycleRevisionCurrent === true,
    principalsRechecked: fields.principalsRechecked === true,
    reviewEvidenceConsistent: fields.reviewEvidenceConsistent === true,
    sequentialReadsOnly: true, transactionAtomicityProven: false,
    approvalWriterIntegrated: false, approvalConsumed: false,
    auditPersisted: false, privateRecoveryRead: false,
    privateRecoveryWritten: false, persistentWritesAllowed: false,
    sourceDeletionAllowed: false, publicVisibilityAllowed: false,
  });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) &&
    Object.getPrototypeOf(v) === Object.prototype;
}
function validTime(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) &&
    v >= 1_700_000_000_000 && v <= 4_000_000_000_000;
}
function isolated(): boolean {
  const env = process.env;
  return env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:28080' &&
    env.FIREBASE_AUTH_EMULATOR_HOST === '127.0.0.1:29099' &&
    env.GCLOUD_PROJECT === LEGACY_RECOVERY_READONLY_PROJECT &&
    env.FUNCTIONS_EMULATOR === 'true' &&
    !env.GOOGLE_APPLICATION_CREDENTIALS &&
    !env.GOOGLE_CLOUD_PROJECT && !env.GCP_PROJECT;
}
function currentAdmin(v: unknown,
  capability: 'privateRecoveryOperator' | 'privateRecoveryReviewer'
): boolean {
  if (!isRecord(v)) return false;
  const forbidden = [
    'deletionRequestedAt', 'deletedAt', 'purgeAfter', 'purgeStartedAt',
    'purgeLeaseOwner', 'purgeLeaseUntil', 'adminPrivilegeRevokedAt',
  ];
  return v['role'] === 'admin' && v['accountStatus'] === 'active' &&
    v[capability] === true && v['suspended'] !== true &&
    v['interactionBlocked'] !== true && v['accountLocked'] !== true &&
    v['loginAllowed'] !== false && v['legalHold'] !== true &&
    v['billingHold'] !== true && forbidden.every(k => v[k] == null);
}

function lifecycle(v: unknown, operationId: string, operatorUid: string,
  now: number): v is Record<string, unknown> {
  if (!isRecord(v) || Object.keys(v).length !== KEYS.length ||
      !KEYS.every(k => Object.hasOwn(v, k))) return false;
  const {requestedAtMs: requested, approvedAtMs: approved,
    expiresAtMs: expires} = v;
  return v['schemaVersion'] === 1 && v['revision'] === 1 &&
    v['status'] === 'APPROVED_FOR_REVIEW_ONLY' &&
    v['operationId'] === operationId && OP_ID.test(operationId) &&
    v['purpose'] === PURPOSE && v['projectId'] === 'entretenimento-sexual' &&
    v['targetCollection'] === 'legacy_discovery_preference_recovery' &&
    v['candidateCount'] === 2 && v['legacyEntryCount'] === 8 &&
    v['requestedByUid'] === operatorUid && UID.test(operatorUid) &&
    typeof v['approvedByUid'] === 'string' &&
    UID.test(v['approvedByUid']) && v['approvedByUid'] !== operatorUid &&
    validTime(requested) && validTime(approved) && validTime(expires) &&
    requested <= approved && approved < requested + WINDOW_MS &&
    approved <= now && now < expires && expires - approved === WINDOW_MS &&
    v['revokedAtMs'] === null && v['consumedAtMs'] === null &&
    v['expiredAtMs'] === null;
}

/**
 * Server-side snapshot observation, not an authorization API. B2.7 is
 * deliberately unmodified and executed first; extra checks bind the
 * B2.9.1 schema/revision to fresh Auth and Firestore reads. TOCTOU remains.
 */
export async function inspectLegacyRecoveryReviewAuthorityReadOnly(
  backend: LegacyRecoveryReadOnlyBackend,
  request: LegacyRecoveryReadOnlyRequest,
  now: number = Date.now()
): Promise<LegacyRecoveryReviewAuthorityReadOnlyReport> {
  if (!isolated() || !validTime(now) || !isRecord(request) ||
      Object.keys(request).length !== 2 ||
      !Object.hasOwn(request, 'operationId') ||
      !Object.hasOwn(request, 'operatorIdToken') ||
      typeof request.operationId !== 'string' ||
      !OP_ID.test(request.operationId) ||
      typeof request.operatorIdToken !== 'string' ||
      request.operatorIdToken.length < 20 ||
      request.operatorIdToken.length > 8192) return report();

  try {
    const b27 = await inspectLegacyRecoveryAdminReadOnly(backend, request, now);
    if (!b27.identityReadVerified || !b27.operatorPrivilegeCurrent ||
        !b27.reviewerPrivilegeCurrent || !b27.reviewerIndependent ||
        !b27.approvalRecordConsistent || b27.decision !== 'BLOCKED' ||
        b27.persistentWritesAllowed !== false) return report();
    const baseline = {b27EvidenceCompatible: true};

    // Never trust an operation ID or actor name from client-supplied records.
    const token = await backend.auth.verifyIdToken(request.operatorIdToken, true);
    if (typeof token.uid !== 'string' || !UID.test(token.uid) ||
        typeof token.auth_time !== 'number' ||
        !Number.isSafeInteger(token.auth_time) ||
        token.auth_time * 1000 > now ||
        now - token.auth_time * 1000 > WINDOW_MS) return report(baseline);
    const operatorAuth = await backend.auth.getUser(token.uid);
    if (operatorAuth.uid !== token.uid || operatorAuth.disabled ||
        !operatorAuth.emailVerified) return report(baseline);

    const snapshot = await backend.firestore
      .collection(LEGACY_RECOVERY_APPROVAL_COLLECTION)
      .doc(request.operationId).get();
    if (!snapshot.exists || !lifecycle(
      snapshot.data(), request.operationId, token.uid, now
    )) return report(baseline);
    const data = snapshot.data();
    if (!isRecord(data) || typeof data['approvedByUid'] !== 'string') {
      return report(baseline);
    }
    const reviewerUid = data['approvedByUid'];
    const shaped = {
      ...baseline, lifecycleSchemaCompatible: true,
      lifecycleRevisionCurrent: true,
    };

    const reviewerAuth = await backend.auth.getUser(reviewerUid);
    if (reviewerAuth.disabled || !reviewerAuth.emailVerified ||
        reviewerAuth.uid !== reviewerUid) return report(shaped);
    const operator = await backend.firestore.collection('users').doc(token.uid).get();
    const reviewer = await backend.firestore.collection('users').doc(reviewerUid).get();
    if (!operator.exists || !reviewer.exists ||
        !currentAdmin(operator.data(), 'privateRecoveryOperator') ||
        !currentAdmin(reviewer.data(), 'privateRecoveryReviewer')) {
      return report(shaped);
    }
    return report({
      ...shaped, principalsRechecked: true, reviewEvidenceConsistent: true,
    });
  } catch {
    // Fail closed; never report actor ID, token, paths, hash or raw error.
    return report();
  }
}
