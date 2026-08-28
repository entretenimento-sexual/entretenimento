// functions/src/account_lifecycle/account-relationship-edge-retention.firestore.ts
// -----------------------------------------------------------------------------
// FIRESTORE ADAPTER FOR RELATIONSHIP EDGE RETENTION
// -----------------------------------------------------------------------------
// Preserva bloqueios em auditoria interna pseudonimizada e remove os documentos
// operacionais, inclusive a subcoleção imutável de eventos.
// -----------------------------------------------------------------------------
import { createHash } from 'node:crypto';

import { db, FieldValue } from '../firebaseApp';
import type {
  AccountRelationshipEdgeRetentionAdapter,
  BlockReferencePageSummary,
} from './account-relationship-edge-retention.executor';

interface BlockStateDocument {
  uid?: unknown;
  isBlocked?: unknown;
  blockedAt?: unknown;
  unblockedAt?: unknown;
  reason?: unknown;
  actorUid?: unknown;
  updatedAt?: unknown;
}

interface BlockEventDocument {
  type?: unknown;
  targetUid?: unknown;
  actorUid?: unknown;
  reason?: unknown;
  createdAt?: unknown;
}

interface BlockReferencePath {
  ownerUid: string;
  targetUid: string;
}

const BLOCK_SECURITY_RETENTION_POLICY_VERSION = 1;
const MAX_BATCH_WRITES = 400;

export class FirestoreAccountRelationshipEdgeRetentionAdapter
implements AccountRelationshipEdgeRetentionAdapter
{
  async archiveOwnedBlockReferencePage(
    uid: string,
    eventLimit: number
  ): Promise<BlockReferencePageSummary> {
    const safeUid = requireUid(uid);
    const snapshot = await db
      .collection('users')
      .doc(safeUid)
      .collection('blocks')
      .limit(1)
      .get();

    if (snapshot.empty) return emptyPage();

    const result = await archiveBlockReference(
      safeUid,
      snapshot.docs[0]!,
      eventLimit
    );
    const remaining = result.remaining || !(await db
      .collection('users')
      .doc(safeUid)
      .collection('blocks')
      .limit(1)
      .get()).empty;

    return { ...result, remaining };
  }

  async archiveInboundBlockReferencePage(
    uid: string,
    eventLimit: number
  ): Promise<BlockReferencePageSummary> {
    const safeUid = requireUid(uid);
    const snapshot = await db
      .collectionGroup('blocks')
      .where('uid', '==', safeUid)
      .limit(1)
      .get();

    if (snapshot.empty) return emptyPage();

    const result = await archiveBlockReference(
      safeUid,
      snapshot.docs[0]!,
      eventLimit
    );
    const remaining = result.remaining || !(await db
      .collectionGroup('blocks')
      .where('uid', '==', safeUid)
      .limit(1)
      .get()).empty;

    return { ...result, remaining };
  }
}

async function archiveBlockReference(
  deletedUid: string,
  blockSnapshot: FirebaseFirestore.QueryDocumentSnapshot,
  eventLimit: number
): Promise<BlockReferencePageSummary> {
  const path = resolveBlockReferencePath(blockSnapshot.ref.path);
  assertDeletedUserParticipates(path, deletedUid);
  const safeEventLimit = normalizeLimit(eventLimit);
  const eventsSnapshot = await blockSnapshot.ref
    .collection('events')
    .limit(safeEventLimit)
    .get();

  await archiveEventDocuments(deletedUid, path, eventsSnapshot.docs);

  const remainingEvents = await blockSnapshot.ref
    .collection('events')
    .limit(1)
    .get();

  if (!remainingEvents.empty) {
    return {
      processed: eventsSnapshot.size,
      eventsArchived: eventsSnapshot.size,
      statesArchived: 0,
      remaining: true,
    };
  }

  const stateArchived = await archiveStateDocument(
    deletedUid,
    path,
    blockSnapshot.ref
  );

  return {
    processed: eventsSnapshot.size + stateArchived,
    eventsArchived: eventsSnapshot.size,
    statesArchived: stateArchived,
    remaining: false,
  };
}

async function archiveEventDocuments(
  deletedUid: string,
  path: BlockReferencePath,
  documents: readonly FirebaseFirestore.QueryDocumentSnapshot[]
): Promise<void> {
  for (let offset = 0; offset < documents.length; offset += MAX_BATCH_WRITES / 2) {
    const batch = db.batch();
    const chunk = documents.slice(offset, offset + MAX_BATCH_WRITES / 2);

    chunk.forEach((snapshot) => {
      resolveBlockEventPath(snapshot.ref.path, path);
      const event = snapshot.data() as BlockEventDocument;
      const auditRef = db
        .collection('block_security_audit')
        .doc(buildAuditDocumentId('event', snapshot.ref.path));

      batch.set(
        auditRef,
        buildEventAuditPayload(deletedUid, path, event),
        { merge: true }
      );
      batch.delete(snapshot.ref);
    });

    await batch.commit();
  }
}

async function archiveStateDocument(
  deletedUid: string,
  path: BlockReferencePath,
  blockRef: FirebaseFirestore.DocumentReference
): Promise<number> {
  return db.runTransaction(async (transaction) => {
    const currentSnapshot = await transaction.get(blockRef);
    if (!currentSnapshot.exists) return 0;

    const current = currentSnapshot.data() as BlockStateDocument;
    const storedTargetUid = normalizeId(current.uid);
    const storedActorUid = normalizeId(current.actorUid);

    if (storedTargetUid && storedTargetUid !== path.targetUid) {
      throw new Error('inconsistent-block-target');
    }

    if (storedActorUid && storedActorUid !== path.ownerUid) {
      throw new Error('inconsistent-block-actor');
    }

    const auditRef = db
      .collection('block_security_audit')
      .doc(buildAuditDocumentId('state', blockRef.path));

    transaction.set(
      auditRef,
      buildStateAuditPayload(deletedUid, path, current),
      { merge: true }
    );
    transaction.delete(blockRef);
    return 1;
  });
}

function buildEventAuditPayload(
  deletedUid: string,
  path: BlockReferencePath,
  event: BlockEventDocument
): FirebaseFirestore.DocumentData {
  return {
    recordType: 'block_event',
    ownerUid: pseudonymizeDeletedUid(path.ownerUid, deletedUid),
    targetUid: pseudonymizeDeletedUid(path.targetUid, deletedUid),
    actorUid: pseudonymizeDeletedUid(
      normalizeId(event.actorUid) ?? path.ownerUid,
      deletedUid
    ),
    eventType: normalizeEventType(event.type),
    reason: normalizeReason(event.reason),
    sourceCreatedAt: event.createdAt ?? null,
    deletedUserReference: deletedUserReference(deletedUid),
    deletedUserRole: resolveDeletedUserRole(path, deletedUid),
    identityState: 'deleted-user-pseudonymized',
    retentionCategory: 'platform-safety',
    retentionPolicyVersion: BLOCK_SECURITY_RETENTION_POLICY_VERSION,
    archivedAt: FieldValue.serverTimestamp(),
  };
}

function buildStateAuditPayload(
  deletedUid: string,
  path: BlockReferencePath,
  state: BlockStateDocument
): FirebaseFirestore.DocumentData {
  return {
    recordType: 'block_state_snapshot',
    ownerUid: pseudonymizeDeletedUid(path.ownerUid, deletedUid),
    targetUid: pseudonymizeDeletedUid(path.targetUid, deletedUid),
    actorUid: pseudonymizeDeletedUid(
      normalizeId(state.actorUid) ?? path.ownerUid,
      deletedUid
    ),
    isBlocked: state.isBlocked === true,
    reason: normalizeReason(state.reason),
    sourceBlockedAt: state.blockedAt ?? null,
    sourceUnblockedAt: state.unblockedAt ?? null,
    sourceUpdatedAt: state.updatedAt ?? null,
    deletedUserReference: deletedUserReference(deletedUid),
    deletedUserRole: resolveDeletedUserRole(path, deletedUid),
    identityState: 'deleted-user-pseudonymized',
    retentionCategory: 'platform-safety',
    retentionPolicyVersion: BLOCK_SECURITY_RETENTION_POLICY_VERSION,
    archivedAt: FieldValue.serverTimestamp(),
  };
}

function resolveBlockReferencePath(rawPath: string): BlockReferencePath {
  const segments = String(rawPath ?? '').split('/');
  const valid =
    segments.length === 4 &&
    segments[0] === 'users' &&
    isSafeId(segments[1]) &&
    segments[2] === 'blocks' &&
    isSafeId(segments[3]);

  if (!valid) throw new Error('unexpected-block-reference-path');

  return {
    ownerUid: segments[1]!,
    targetUid: segments[3]!,
  };
}

function resolveBlockEventPath(
  rawPath: string,
  expected: BlockReferencePath
): void {
  const segments = String(rawPath ?? '').split('/');
  const valid =
    segments.length === 6 &&
    segments[0] === 'users' &&
    segments[1] === expected.ownerUid &&
    segments[2] === 'blocks' &&
    segments[3] === expected.targetUid &&
    segments[4] === 'events' &&
    isSafeId(segments[5]);

  if (!valid) throw new Error('unexpected-block-event-path');
}

function assertDeletedUserParticipates(
  path: BlockReferencePath,
  deletedUid: string
): void {
  if (path.ownerUid !== deletedUid && path.targetUid !== deletedUid) {
    throw new Error('deleted-user-not-in-block-reference');
  }
}

function resolveDeletedUserRole(
  path: BlockReferencePath,
  deletedUid: string
): 'owner' | 'target' {
  return path.ownerUid === deletedUid ? 'owner' : 'target';
}

function pseudonymizeDeletedUid(value: string, deletedUid: string): string {
  return value === deletedUid ? deletedUserReference(deletedUid) : value;
}

function normalizeEventType(value: unknown): 'block' | 'unblock' | 'unknown' {
  const normalized = String(value ?? '').trim();
  return normalized === 'block' || normalized === 'unblock'
    ? normalized
    : 'unknown';
}

function normalizeReason(value: unknown): string | null {
  const normalized = String(value ?? '').trim().replace(/\s+/g, ' ');
  return normalized ? normalized.slice(0, 500) : null;
}

function normalizeLimit(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 200) : 100;
}

function normalizeId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return isSafeId(normalized) ? normalized : null;
}

function isSafeId(value: unknown): boolean {
  return /^[A-Za-z0-9:_-]{1,128}$/.test(String(value ?? ''));
}

function requireUid(value: unknown): string {
  const uid = normalizeId(value);
  if (!uid) throw new Error('UID inválido para retenção de bloqueios.');
  return uid;
}

function deletedUserReference(uid: string): string {
  const key = createHash('sha256').update(uid).digest('hex').slice(0, 24);
  return `deleted:${key}`;
}

function buildAuditDocumentId(kind: 'event' | 'state', path: string): string {
  const key = createHash('sha256').update(path).digest('hex').slice(0, 40);
  return `${kind}_${key}`;
}

function emptyPage(): BlockReferencePageSummary {
  return {
    processed: 0,
    eventsArchived: 0,
    statesArchived: 0,
    remaining: false,
  };
}
