// Issue #236: consolidated synthetic original-schema bridge (B2.9.3f).
// PURE Node policy, not a writer, reader, Cloud Function or authorization API.
// Only test documents named by the B2.9.3c disposable fixture convention.
// Fixture document naming is NOT a cryptographic association or production proof.
import { reconcileSyntheticReviewApprovals } from './discovery-legacy-approval-reconciliation.policy.mjs';

export const ORIGINAL_SCHEMA_RECONCILIATION_PHASE = 'B2_9_3F_ORIGINAL_SCHEMA_SYNTHETIC_ONLY';
const MAX = 64;
const APPROVAL_FIELDS = Object.freeze([
  'schemaVersion', 'operationId', 'purpose', 'projectId', 'targetCollection',
  'candidateCount', 'legacyEntryCount', 'requestedByUid', 'requestedAtMs',
  'approvedByUid', 'approvedAtMs', 'expiresAtMs', 'revokedAtMs',
  'consumedAtMs', 'expiredAtMs', 'status', 'revision',
]);
const AUDIT_FIELDS = Object.freeze(['schemaVersion', 'entries']);
const APPROVAL_PROJECTION_FIELDS = Object.freeze([
  'schemaVersion', 'status', 'revision', 'purpose', 'projectId',
  'targetCollection', 'candidateCount', 'legacyEntryCount', 'requestedAtMs',
  'approvedAtMs', 'expiresAtMs', 'consumedAtMs', 'revokedAtMs', 'expiredAtMs',
]);
const APPROVAL_ID = /^synthetic-b293c-([a-z0-9-]{1,64})-operation$/;
const AUDIT_ID = /^synthetic-b293c-([a-z0-9-]{1,64})-audit$/;
const U_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const INPUT_FIELDS = ['approvals','audits','nowMs'];
const RECORD_FIELDS = ['id','data'];

function plain(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) &&
    Object.getPrototypeOf(v) === Object.prototype;
}
function exact(v, fields) {
  return plain(v) && Object.keys(v).length === fields.length &&
    fields.every(x => Object.hasOwn(v,x));
}
function validSnapshotRow(row, re) {
  return exact(row, RECORD_FIELDS) && typeof row.id === 'string' &&
    re.test(row.id) && plain(row.data);
}
function key(id, re) {
  const suffix = id.match(re)[1];
  return `synthetic-b293d-b293f-${suffix}`;
}
function validPrincipalFields(d) {
  return typeof d.operationId === 'string' &&
    U_ID.test(d.requestedByUid) && U_ID.test(d.approvedByUid) &&
    d.requestedByUid !== d.approvedByUid;
}

/**
 * Input is an explicitly constructed set of disposable Firestore Emulator snapshots,
 * not a production access capability or cryptographic association proof.
 * The returned object never includes document IDs, UIDs, hash or freeform content.
 * Malformed records count as blockers and can never reconcile optimistically.
 */
export function reconcileOriginalB293cSyntheticDocuments(input) {
  if (!exact(input, INPUT_FIELDS) ||
      !Array.isArray(input.approvals) || !Array.isArray(input.audits) ||
      input.approvals.length > MAX || input.audits.length > MAX ||
      !Number.isSafeInteger(input.nowMs) ||
      input.nowMs < 1_700_000_000_000 || input.nowMs > 4_000_000_000_000 ||
      !input.approvals.every(x => validSnapshotRow(x, APPROVAL_ID)) ||
      !input.audits.every(x => validSnapshotRow(x, AUDIT_ID))) {
    throw new Error('B293F_INPUT_DENIED');
  }
  const seenApprovals = new Set();
  const seenAudits = new Set();
  let malformedApprovals = 0;
  let malformedAudits = 0;
  let duplicateDocumentIds = 0;
  const approvals = [];
  const audits = [];
  for (const row of input.approvals) {
    if (seenApprovals.has(row.id)) { duplicateDocumentIds++; continue; }
    seenApprovals.add(row.id);
    const d = row.data;
    if (!exact(d, APPROVAL_FIELDS) || d.operationId !== row.id ||
        !validPrincipalFields(d)) { malformedApprovals++; continue; }
    approvals.push({
      syntheticKey:key(row.id, APPROVAL_ID),
      ...Object.fromEntries(APPROVAL_PROJECTION_FIELDS.map(name => [name,d[name]])),
    });
  }
  for (const row of input.audits) {
    if (seenAudits.has(row.id)) { duplicateDocumentIds++; continue; }
    seenAudits.add(row.id);
    const d = row.data;
    if (!exact(d, AUDIT_FIELDS) || !Array.isArray(d.entries)) {
      malformedAudits++; continue;
    }
    audits.push({
      syntheticKey:key(row.id,AUDIT_ID),
      schemaVersion:d.schemaVersion, entries:d.entries,
    });
  }
  const report = reconcileSyntheticReviewApprovals({
    approvals, audits, nowMs:input.nowMs,
  });
  const malformedTotal = malformedApprovals + malformedAudits + duplicateDocumentIds;
  return Object.freeze({
    ...report,
    phase:ORIGINAL_SCHEMA_RECONCILIATION_PHASE,
    originalApprovalsInspected:input.approvals.length,
    originalAuditsInspected:input.audits.length,
    malformedApprovals, malformedAudits, duplicateDocumentIds,
    totalIssues:report.totalIssues + malformedTotal,
    shapeReconciled:report.shapeReconciled && malformedTotal === 0,
    originalB293cDocumentShapeConsumed:true,
    fixtureDocumentConventionChecked:true,
    cryptographicOperationBindingVerified:false,
    productionSourceVerified:false,
    liveOperatorPermissionsVerified:false,
    sourceIsTrusted:false,
    externalAnchorVerified:false,
    automatedRepairAllowed:false,
    privateRecoveryRead:false,
    privateRecoveryWritten:false,
    persistentWritesAllowed:false,
    publicVisibilityAllowed:false,
    decision:'BLOCKED',
  });
}

export function authorizeOriginalSchemaRepair() {
  throw new Error('B293F_REPAIR_NOT_AUTHORIZED');
}
