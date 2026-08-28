// functions/src/account_lifecycle/account-financial-retention.firestore.ts
// -----------------------------------------------------------------------------
// FIRESTORE ADAPTER FOR FINANCIAL RETENTION
// -----------------------------------------------------------------------------
// Mantém registros necessários à conciliação em coleções de auditoria, remove
// checkouts operacionais e arquiva entitlements antes de apagá-los.
// -----------------------------------------------------------------------------
import { createHash } from 'node:crypto';

import { db, FieldValue } from '../firebaseApp';
import type {
  AccountFinancialRetentionAdapter,
  FinancialPartyField,
  FinancialRetentionPageSummary,
} from './account-financial-retention.executor';

interface CheckoutSessionDocument {
  id?: unknown;
  buyerUid?: unknown;
  sellerUid?: unknown;
  scope?: unknown;
  planId?: unknown;
  planKey?: unknown;
  planSnapshot?: unknown;
  amountCents?: unknown;
  currency?: unknown;
  provider?: unknown;
  providerSessionId?: unknown;
  status?: unknown;
  statusHistory?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

interface FinancialPartyDocument {
  buyerUid?: unknown;
  sellerUid?: unknown;
}

interface EntitlementDocument extends FinancialPartyDocument {
  id?: unknown;
  scope?: unknown;
  planId?: unknown;
  planKey?: unknown;
  grantedRole?: unknown;
  active?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  sourceCheckoutSessionId?: unknown;
  sourcePaymentTransactionId?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

interface BillingAuditDocument extends FinancialPartyDocument {
  entitlementId?: unknown;
}

const FINANCIAL_RETENTION_POLICY_VERSION = 1;
const MAX_BATCH_WRITES = 400;
const MAX_ARCHIVE_DOCUMENTS_PER_BATCH = Math.floor(MAX_BATCH_WRITES / 2);
const CANCELLABLE_CHECKOUT_STATUSES = new Set([
  'pending',
  'provider_created',
  'processing',
]);

export class FirestoreAccountFinancialRetentionAdapter
implements AccountFinancialRetentionAdapter
{
  async retainCheckoutSessionsPage(
    uid: string,
    field: FinancialPartyField,
    limit: number
  ): Promise<FinancialRetentionPageSummary> {
    const safeUid = requireUid(uid);
    const snapshot = await db
      .collection('checkout_sessions')
      .where(field, '==', safeUid)
      .limit(normalizeLimit(limit))
      .get();
    let pendingCheckoutsCanceled = 0;

    for (
      let offset = 0;
      offset < snapshot.docs.length;
      offset += MAX_ARCHIVE_DOCUMENTS_PER_BATCH
    ) {
      const batch = db.batch();
      const chunk = snapshot.docs.slice(
        offset,
        offset + MAX_ARCHIVE_DOCUMENTS_PER_BATCH
      );

      chunk.forEach((document) => {
        assertTopLevelDocumentPath(document.ref.path, 'checkout_sessions');
        const data = document.data() as CheckoutSessionDocument;
        assertPartyMatches(data, field, safeUid);
        const status = normalizeText(data.status, 40).toLowerCase();
        const canceled = CANCELLABLE_CHECKOUT_STATUSES.has(status);
        const archiveId = buildCheckoutArchiveDocumentId(document.ref.path);
        const archiveRef = db
          .collection('financial_checkout_audit')
          .doc(archiveId);

        pendingCheckoutsCanceled += canceled ? 1 : 0;
        batch.set(
          archiveRef,
          buildArchivedCheckout(data, safeUid, archiveId, document.ref.path),
          { merge: true }
        );
        batch.delete(document.ref);
      });

      await batch.commit();
    }

    return {
      processed: snapshot.size,
      pendingCheckoutsCanceled,
    };
  }

  async retainPaymentTransactionsPage(
    uid: string,
    field: FinancialPartyField,
    limit: number
  ): Promise<FinancialRetentionPageSummary> {
    const safeUid = requireUid(uid);
    const snapshot = await db
      .collection('payment_transactions')
      .where(field, '==', safeUid)
      .limit(normalizeLimit(limit))
      .get();

    await updatePartyDocuments(
      snapshot.docs,
      'payment_transactions',
      field,
      safeUid,
      'financial-transaction'
    );

    return { processed: snapshot.size };
  }

  async archiveEntitlementsPage(
    uid: string,
    field: FinancialPartyField,
    limit: number
  ): Promise<FinancialRetentionPageSummary> {
    const safeUid = requireUid(uid);
    const snapshot = await db
      .collection('entitlements')
      .where(field, '==', safeUid)
      .limit(normalizeLimit(limit))
      .get();

    for (
      let offset = 0;
      offset < snapshot.docs.length;
      offset += MAX_ARCHIVE_DOCUMENTS_PER_BATCH
    ) {
      const batch = db.batch();
      const chunk = snapshot.docs.slice(
        offset,
        offset + MAX_ARCHIVE_DOCUMENTS_PER_BATCH
      );

      chunk.forEach((document) => {
        assertTopLevelDocumentPath(document.ref.path, 'entitlements');
        const data = document.data() as EntitlementDocument;
        assertPartyMatches(data, field, safeUid);
        const archiveId = buildEntitlementArchiveDocumentId(document.ref.path);
        const archiveRef = db
          .collection('financial_entitlement_audit')
          .doc(archiveId);

        batch.set(
          archiveRef,
          buildArchivedEntitlement(data, safeUid, archiveId, document.ref.path),
          { merge: true }
        );
        batch.delete(document.ref);
      });

      await batch.commit();
    }

    return {
      processed: snapshot.size,
      entitlementsArchived: snapshot.size,
      entitlementsRevoked: snapshot.size,
    };
  }

  async retainBillingAuditPage(
    uid: string,
    field: FinancialPartyField,
    limit: number
  ): Promise<FinancialRetentionPageSummary> {
    const safeUid = requireUid(uid);
    const snapshot = await db
      .collection('billing_audit')
      .where(field, '==', safeUid)
      .limit(normalizeLimit(limit))
      .get();

    for (let offset = 0; offset < snapshot.docs.length; offset += MAX_BATCH_WRITES) {
      const batch = db.batch();
      const chunk = snapshot.docs.slice(offset, offset + MAX_BATCH_WRITES);

      chunk.forEach((document) => {
        assertTopLevelDocumentPath(document.ref.path, 'billing_audit');
        const data = document.data() as BillingAuditDocument;
        assertPartyMatches(data, field, safeUid);
        batch.update(
          document.ref,
          buildBillingAuditPatch(data, field, safeUid)
        );
      });

      await batch.commit();
    }

    return { processed: snapshot.size };
  }
}

function buildArchivedCheckout(
  data: CheckoutSessionDocument,
  deletedUid: string,
  archiveId: string,
  sourcePath: string
): FirebaseFirestore.DocumentData {
  const now = Date.now();
  const previousStatus = normalizeText(data.status, 40).toLowerCase();
  const canceled = CANCELLABLE_CHECKOUT_STATUSES.has(previousStatus);
  const history = normalizeStatusHistory(data.statusHistory);
  const sourceCheckoutSessionId =
    normalizeNullableText(data.id, 180) ??
    normalizeNullableText(sourcePath.split('/')[1], 180);

  return {
    id: archiveId,
    sourceCheckoutSessionId,
    sourceCheckoutSessionIdHash: hashValue(
      String(sourceCheckoutSessionId ?? sourcePath)
    ),
    buyerUid: pseudonymizeParty(data.buyerUid, deletedUid),
    sellerUid: pseudonymizeNullableParty(data.sellerUid, deletedUid),
    scope: normalizeText(data.scope, 80),
    planId: normalizeNullableText(data.planId, 180),
    planKey: normalizeNullableText(data.planKey, 80),
    planSnapshot: sanitizePlanSnapshot(data.planSnapshot),
    amountCents: normalizeNullableNumber(data.amountCents),
    currency: normalizeNullableText(data.currency, 20),
    provider: normalizeNullableText(data.provider, 40),
    providerSessionId: normalizeNullableText(data.providerSessionId, 240),
    status: canceled ? 'canceled' : previousStatus || 'unknown',
    previousStatus: previousStatus || null,
    statusHistory: canceled
      ? [
        ...history,
        {
          status: 'canceled',
          at: now,
          source: 'system',
          eventId: null,
          reason: 'account-deletion',
        },
      ]
      : history,
    sourceCreatedAt: normalizeNullableNumber(data.createdAt),
    sourceUpdatedAt: normalizeNullableNumber(data.updatedAt),
    canceledForAccountDeletionAt: canceled ? now : null,
    financialRetentionCategory: 'checkout-audit',
    financialRetentionPolicyVersion: FINANCIAL_RETENTION_POLICY_VERSION,
    identityState: 'deleted-user-pseudonymized',
    archivedAt: FieldValue.serverTimestamp(),
  };
}

async function updatePartyDocuments(
  documents: readonly FirebaseFirestore.QueryDocumentSnapshot[],
  expectedCollection: string,
  field: FinancialPartyField,
  uid: string,
  retentionCategory: string
): Promise<void> {
  for (let offset = 0; offset < documents.length; offset += MAX_BATCH_WRITES) {
    const batch = db.batch();
    const chunk = documents.slice(offset, offset + MAX_BATCH_WRITES);

    chunk.forEach((document) => {
      assertTopLevelDocumentPath(document.ref.path, expectedCollection);
      const data = document.data() as FinancialPartyDocument;
      assertPartyMatches(data, field, uid);
      batch.update(document.ref, {
        [field]: deletedUserReference(uid),
        [partyIdentityStateField(field)]:
          'pseudonymized_after_account_deletion',
        financialRetentionCategory: retentionCategory,
        financialRetentionPolicyVersion: FINANCIAL_RETENTION_POLICY_VERSION,
        identityUpdatedAt: FieldValue.serverTimestamp(),
      });
    });

    await batch.commit();
  }
}

function buildArchivedEntitlement(
  data: EntitlementDocument,
  deletedUid: string,
  archiveId: string,
  sourcePath: string
): FirebaseFirestore.DocumentData {
  const now = Date.now();

  return {
    id: archiveId,
    sourceEntitlementIdHash: hashValue(String(data.id ?? sourcePath)),
    buyerUid: pseudonymizeParty(data.buyerUid, deletedUid),
    sellerUid: pseudonymizeNullableParty(data.sellerUid, deletedUid),
    scope: normalizeText(data.scope, 80),
    planId: normalizeNullableText(data.planId, 180),
    planKey: normalizeNullableText(data.planKey, 80),
    grantedRole: normalizeNullableText(data.grantedRole, 80),
    active: false,
    previousActive: data.active === true,
    startsAt: normalizeNullableNumber(data.startsAt),
    endsAt: now,
    previousEndsAt: normalizeNullableNumber(data.endsAt),
    sourceCheckoutSessionId: normalizeNullableText(
      data.sourceCheckoutSessionId,
      180
    ),
    sourcePaymentTransactionId: normalizeNullableText(
      data.sourcePaymentTransactionId,
      180
    ),
    sourceCreatedAt: normalizeNullableNumber(data.createdAt),
    sourceUpdatedAt: normalizeNullableNumber(data.updatedAt),
    revokedAt: now,
    revokedReason: 'account-deletion',
    financialRetentionCategory: 'entitlement-audit',
    financialRetentionPolicyVersion: FINANCIAL_RETENTION_POLICY_VERSION,
    identityState: 'deleted-user-pseudonymized',
    archivedAt: FieldValue.serverTimestamp(),
  };
}

function buildBillingAuditPatch(
  data: BillingAuditDocument,
  field: FinancialPartyField,
  uid: string
): FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> {
  const patch: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> = {
    [field]: deletedUserReference(uid),
    [partyIdentityStateField(field)]:
      'pseudonymized_after_account_deletion',
    financialRetentionCategory: 'billing-audit',
    financialRetentionPolicyVersion: FINANCIAL_RETENTION_POLICY_VERSION,
    identityUpdatedAt: FieldValue.serverTimestamp(),
  };
  const entitlementId = String(data.entitlementId ?? '').trim();

  if (entitlementId && entitlementId.includes(uid)) {
    patch['entitlementIdHash'] = hashValue(entitlementId);
    patch['entitlementId'] = FieldValue.delete();
  }

  return patch;
}

function sanitizePlanSnapshot(value: unknown): Record<string, unknown> | null {
  const record = normalizeRecord(value);
  if (!Object.keys(record).length) return null;

  return {
    id: normalizeNullableText(record['id'], 180),
    key: normalizeNullableText(record['key'], 80),
    scope: normalizeNullableText(record['scope'], 80),
    title: normalizeNullableText(record['title'], 160),
    description: normalizeNullableText(record['description'], 500),
    amountCents: normalizeNullableNumber(record['amountCents']),
    currency: normalizeNullableText(record['currency'], 20),
    interval: normalizeNullableText(record['interval'], 40),
    active: record['active'] === true,
    grantedRole: normalizeNullableText(record['grantedRole'], 80),
    catalogVersion: normalizeNullableNumber(record['catalogVersion']),
    snapshotAt: normalizeNullableNumber(record['snapshotAt']),
  };
}

function normalizeStatusHistory(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-200).map((entry) => {
    const record = normalizeRecord(entry);
    return {
      status: normalizeNullableText(record['status'], 40),
      at: normalizeNullableNumber(record['at']),
      source: normalizeNullableText(record['source'], 40),
      eventId: normalizeNullableText(record['eventId'], 240),
    };
  });
}

function assertPartyMatches(
  data: FinancialPartyDocument,
  field: FinancialPartyField,
  uid: string
): void {
  if (normalizeId(data[field]) !== uid) {
    throw new Error('inconsistent-financial-party-identity');
  }
}

function partyIdentityStateField(field: FinancialPartyField): string {
  return field === 'buyerUid'
    ? 'buyerIdentityState'
    : 'sellerIdentityState';
}

function pseudonymizeParty(value: unknown, deletedUid: string): string {
  const uid = normalizeId(value);
  if (!uid) throw new Error('invalid-financial-buyer-identity');
  return uid === deletedUid ? deletedUserReference(deletedUid) : uid;
}

function pseudonymizeNullableParty(
  value: unknown,
  deletedUid: string
): string | null {
  if (value === null || value === undefined || value === '') return null;
  const uid = normalizeId(value);
  if (!uid) throw new Error('invalid-financial-seller-identity');
  return uid === deletedUid ? deletedUserReference(deletedUid) : uid;
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

  if (!valid) throw new Error(`unexpected-${expectedCollection}-path`);
}

function normalizeLimit(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 200) : 100;
}

function normalizeText(value: unknown, maxLength: number): string {
  return String(value ?? '').trim().slice(0, maxLength);
}

function normalizeNullableText(
  value: unknown,
  maxLength: number
): string | null {
  const normalized = normalizeText(value, maxLength);
  return normalized || null;
}

function normalizeNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
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
  if (!uid) throw new Error('UID inválido para retenção financeira.');
  return uid;
}

function deletedUserReference(uid: string): string {
  return `deleted:${hashValue(uid).slice(0, 24)}`;
}

function buildCheckoutArchiveDocumentId(sourcePath: string): string {
  return `financial_checkout_${hashValue(sourcePath).slice(0, 40)}`;
}

function buildEntitlementArchiveDocumentId(sourcePath: string): string {
  return `financial_entitlement_${hashValue(sourcePath).slice(0, 40)}`;
}

function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
