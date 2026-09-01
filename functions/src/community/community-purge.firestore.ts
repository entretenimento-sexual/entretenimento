// functions/src/community/community-purge.firestore.ts
// -----------------------------------------------------------------------------
// FIRESTORE COMMUNITY PURGE ADAPTER
// -----------------------------------------------------------------------------
// Implementa somente os namespaces autorizados pela política de purge. Auditoria,
// denúncias, admin logs e evidências de compliance nunca são alvos de exclusão.
// Associações oficiais são revogadas, não apagadas, preservando rastreabilidade.
// `community_purge_audit` recebe apenas o recibo mínimo da operação destrutiva.
// -----------------------------------------------------------------------------

import { db, FieldValue } from '../firebaseApp';
import {
  normalizeCommunityOfficialAssociationKey,
} from './community-official-association.model';
import type {
  CommunityPurgeExecutionAdapter,
  CommunityPurgeReferenceKind,
} from './community-purge.executor';
import {
  COMMUNITY_PURGE_FINAL_ROOT_COLLECTIONS,
  COMMUNITY_PURGE_MEMBER_SCOPED_COLLECTIONS,
  COMMUNITY_PURGE_PROJECTION_ROOT_COLLECTIONS,
  COMMUNITY_PURGE_REFERENCE_COLLECTIONS,
  assertCommunityPurgeMembershipsTerminal,
  isCommunityPurgeProtectedCollection,
} from './community-purge.firestore.policy';
import {
  evaluateCommunityPurgeReadiness,
  resolveCommunityPurgeGraceDays,
} from './community-purge.policy';
import { readCommunityPurgeEvidence } from './community-purge-readiness.service';

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const MAX_BATCH_WRITES = 450;
const MEMBER_SCOPED_PAGE_SIZE = 200;
const MEMBER_SCOPED_MAX_PAGES = 50;
const PURGE_AUDIT_COLLECTION = 'community_purge_audit';
const OFFICIAL_ASSOCIATION_AUDIT_COLLECTION =
  'community_official_association_audit';
const PURGE_POLICY_VERSION = 1;
const PURGE_SOURCE = 'community-purge-executor';

export class FirestoreCommunityPurgeAdapter
implements CommunityPurgeExecutionAdapter {
  async deleteReferencePage(
    communityIdRaw: string,
    kind: CommunityPurgeReferenceKind,
    limitRaw: number
  ): Promise<number> {
    const communityId = requireCommunityId(communityIdRaw);
    const limit = normalizeLimit(limitRaw);

    if (kind === 'member_scoped_refs') {
      return this.deleteMemberScopedReferencesPage(communityId, limit);
    }

    const collectionName = COMMUNITY_PURGE_REFERENCE_COLLECTIONS[kind];
    assertCollectionCanBePurged(collectionName);

    const snapshot = await db
      .collection(collectionName)
      .where('communityId', '==', communityId)
      .limit(limit)
      .get();

    await deleteDocumentRefs(snapshot.docs.map((document) => document.ref));
    return snapshot.size;
  }

  async confirmPurgeReadiness(communityIdRaw: string): Promise<boolean> {
    const communityId = requireCommunityId(communityIdRaw);
    const [communitySnapshot, configSnapshot] = await Promise.all([
      db.collection('communities').doc(communityId).get(),
      db.collection('platform_config').doc('community').get(),
    ]);

    if (!communitySnapshot.exists) return false;

    const evidence = await readCommunityPurgeEvidence(communityId);
    const graceDays = resolveCommunityPurgeGraceDays(
      configSnapshot.exists ? configSnapshot.data() : null
    );
    const decision = evaluateCommunityPurgeReadiness(
      communitySnapshot.data(),
      evidence.evidence,
      Date.now(),
      graceDays
    );

    return decision.eligible;
  }

  async deleteProjectionRoots(communityIdRaw: string): Promise<number> {
    const communityId = requireCommunityId(communityIdRaw);
    return deleteRootCollections(
      communityId,
      COMMUNITY_PURGE_PROJECTION_ROOT_COLLECTIONS
    );
  }

  async deleteCommunityRoots(communityIdRaw: string): Promise<number> {
    const communityId = requireCommunityId(communityIdRaw);
    const auditRef = db.collection(PURGE_AUDIT_COLLECTION).doc(communityId);
    const startedAt = Date.now();

    await db.runTransaction(async (transaction) => {
      const auditSnapshot = await transaction.get(auditRef);

      if (!auditSnapshot.exists) {
        transaction.create(auditRef, {
          communityId,
          status: 'deleting',
          attemptCount: 1,
          startedAt,
          completedAt: null,
          policyVersion: PURGE_POLICY_VERSION,
          source: PURGE_SOURCE,
          updatedAt: startedAt,
        });
        return;
      }

      transaction.set(
        auditRef,
        {
          status: 'deleting',
          attemptCount: FieldValue.increment(1),
          policyVersion: PURGE_POLICY_VERSION,
          source: PURGE_SOURCE,
          updatedAt: startedAt,
        },
        { merge: true }
      );
    });

    await revokeOfficialAssociationForPurgedCommunity(communityId);

    const rootsProcessed = await deleteRootCollections(
      communityId,
      COMMUNITY_PURGE_FINAL_ROOT_COLLECTIONS
    );
    const completedAt = Date.now();

    await auditRef.set(
      {
        status: 'completed',
        rootsProcessed,
        completedAt,
        updatedAt: completedAt,
      },
      { merge: true }
    );

    return rootsProcessed;
  }

  private async deleteMemberScopedReferencesPage(
    communityId: string,
    limit: number
  ): Promise<number> {
    const communityRef = db.collection('communities').doc(communityId);
    const snapshot = await communityRef
      .collection('members')
      .limit(limit)
      .get();

    if (snapshot.empty) return 0;

    assertCommunityPurgeMembershipsTerminal(
      snapshot.docs.map((document) => document.data())
    );

    for (const membership of snapshot.docs) {
      const uid = requireCommunityId(membership.id);

      for (const collectionName of COMMUNITY_PURGE_MEMBER_SCOPED_COLLECTIONS) {
        assertCollectionCanBePurged(collectionName);
        await deleteUserScopedCommunityItems(
          collectionName,
          uid,
          communityId
        );
      }

      const userIndexRef = db
        .collection('community_user_index')
        .doc(uid)
        .collection('items')
        .doc(communityId);

      await deleteDocumentRefs([userIndexRef, membership.ref]);
    }

    return snapshot.size;
  }
}

async function revokeOfficialAssociationForPurgedCommunity(
  communityId: string
): Promise<void> {
  const communitySnapshot = await db
    .collection('communities')
    .doc(communityId)
    .get();

  if (!communitySnapshot.exists) return;

  const community = communitySnapshot.data() ?? {};
  const associationKey = normalizeCommunityOfficialAssociationKey(
    community['officialAssociationKey']
  );

  if (!associationKey) return;

  const associationRef = db
    .collection('community_official_associations')
    .doc(associationKey);
  const associationAuditRef = db
    .collection(OFFICIAL_ASSOCIATION_AUDIT_COLLECTION)
    .doc(`purge-${communityId}`);
  const revokedAt = Date.now();

  await db.runTransaction(async (transaction) => {
    const associationSnapshot = await transaction.get(associationRef);
    if (!associationSnapshot.exists) return;

    const association = associationSnapshot.data() ?? {};
    if (association['communityId'] !== communityId) return;
    if (association['status'] === 'revoked') return;

    if (association['status'] !== 'verified') {
      const error = new Error(
        'Purge bloqueado: associação oficial possui estado inconsistente.'
      ) as Error & { code?: string };
      error.code = 'community-purge-official-association-invalid-status';
      throw error;
    }

    transaction.set(
      associationRef,
      {
        status: 'revoked',
        revokedAt,
        updatedAt: revokedAt,
      },
      { merge: true }
    );

    transaction.set(associationAuditRef, {
      action: 'official_association_revoked_by_community_purge',
      associationKey,
      communityId,
      target: association['target'] ?? null,
      actor: 'system',
      previousStatus: 'verified',
      nextStatus: 'revoked',
      createdAt: revokedAt,
    });
  });
}

async function deleteUserScopedCommunityItems(
  collectionName: string,
  uid: string,
  communityId: string
): Promise<void> {
  for (let page = 1; page <= MEMBER_SCOPED_MAX_PAGES; page += 1) {
    const snapshot = await db
      .collection(collectionName)
      .doc(uid)
      .collection('items')
      .where('communityId', '==', communityId)
      .limit(MEMBER_SCOPED_PAGE_SIZE)
      .get();

    await deleteDocumentRefs(snapshot.docs.map((document) => document.ref));

    if (snapshot.size < MEMBER_SCOPED_PAGE_SIZE) return;
  }

  const error = new Error(
    'Purge bloqueado: resíduos privados excederam o limite de paginação.'
  ) as Error & { code?: string };
  error.code = 'community-purge-member-scoped-pagination-limit';
  throw error;
}

async function deleteRootCollections(
  communityId: string,
  collectionNames: readonly string[]
): Promise<number> {
  for (const collectionName of collectionNames) {
    assertCollectionCanBePurged(collectionName);
    await db.recursiveDelete(
      db.collection(collectionName).doc(communityId)
    );
  }

  return collectionNames.length;
}

async function deleteDocumentRefs(
  refs: readonly FirebaseFirestore.DocumentReference[]
): Promise<void> {
  for (let offset = 0; offset < refs.length; offset += MAX_BATCH_WRITES) {
    const chunk = refs.slice(offset, offset + MAX_BATCH_WRITES);
    if (chunk.length === 0) continue;

    const batch = db.batch();
    chunk.forEach((reference) => batch.delete(reference));
    await batch.commit();
  }
}

function assertCollectionCanBePurged(collectionName: string): void {
  if (!collectionName || isCommunityPurgeProtectedCollection(collectionName)) {
    const error = new Error(
      `Namespace não autorizado para purge: ${collectionName || 'unknown'}.`
    ) as Error & { code?: string };
    error.code = 'community-purge-protected-namespace';
    throw error;
  }
}

function requireCommunityId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  if (SAFE_ID_PATTERN.test(normalized)) return normalized;

  const error = new Error('Community ID inválido para purge.') as Error & {
    code?: string;
  };
  error.code = 'community-purge-invalid-community-id';
  throw error;
}

function normalizeLimit(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, 1), 200)
    : 100;
}
