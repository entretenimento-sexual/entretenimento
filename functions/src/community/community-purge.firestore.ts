// functions/src/community/community-purge.firestore.ts
// -----------------------------------------------------------------------------
// COMMUNITY PURGE FIRESTORE/STORAGE ADAPTER
// -----------------------------------------------------------------------------
// Remove conteúdo e projeções de uma Comunidade elegível em etapas idempotentes.
// O documento canônico `communities/{communityId}` NÃO é apagado aqui: ele deve
// permanecer até a última revalidação do scheduler para permitir retry seguro.
// -----------------------------------------------------------------------------

import { FieldPath } from 'firebase-admin/firestore';

import { db } from '../firebaseApp';
import { deletePublishedPhotoAssetOrQueue } from '../media/application/published-photo-asset.service';

const PAGE_SIZE = 200;
const STORAGE_DELETE_CONCURRENCY = 10;

const COMMUNITY_SCOPED_CONTAINERS = [
  'community_discovery_index',
  'community_feed_posts',
  'community_public_feed',
  'community_feed_realtime',
  'community_topics',
  'community_public_topics',
] as const;

const COMMUNITY_OPERATIONAL_COLLECTIONS = [
  'community_creation_requests',
  'community_feed_requests',
  'community_topic_requests',
  'community_settings_requests',
  'community_lifecycle_requests',
  'invites',
  'notifications',
] as const;

const COMMUNITY_USER_POINTER_ROOTS = new Set([
  'community_user_index',
  'community_feed_user_posts',
  'community_feed_user_actions',
  'community_feed_user_reactions',
  'community_feed_user_comments',
  'community_feed_user_replies',
]);

const TERMINAL_MODERATION_REPORT_STATUSES = new Set([
  'resolved',
  'rejected',
  'closed',
  'dismissed',
]);

export interface CommunityPurgeCleanupSummary {
  publishedPhotoAssetsProcessed: number;
  publishedPhotoAssetsQueued: number;
  operationalDocumentsDeleted: number;
  userPointersDeleted: number;
  scopedContainersDeleted: number;
  rootSubcollectionsDeleted: number;
}

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9:_-]{1,160}$/.test(normalized) ? normalized : '';
}

async function deleteRefs(
  refs: readonly FirebaseFirestore.DocumentReference[]
): Promise<number> {
  let deleted = 0;

  for (let offset = 0; offset < refs.length; offset += PAGE_SIZE) {
    const batch = db.batch();
    const page = refs.slice(offset, offset + PAGE_SIZE);
    page.forEach((ref) => batch.delete(ref));
    await batch.commit();
    deleted += page.length;
  }

  return deleted;
}

async function deleteDocumentsByCommunityId(
  collectionName: string,
  communityId: string
): Promise<number> {
  let deleted = 0;

  while (true) {
    const snapshot = await db
      .collection(collectionName)
      .where('communityId', '==', communityId)
      .limit(PAGE_SIZE)
      .get();

    if (snapshot.empty) break;
    deleted += await deleteRefs(snapshot.docs.map((document) => document.ref));

    if (snapshot.size < PAGE_SIZE) break;
  }

  return deleted;
}

function isCommunityUserPointerPath(path: string): boolean {
  const segments = path.split('/');
  return segments.length === 4
    && COMMUNITY_USER_POINTER_ROOTS.has(segments[0] ?? '')
    && segments[2] === 'items';
}

async function deleteCommunityUserPointers(communityId: string): Promise<number> {
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  let deleted = 0;

  while (true) {
    let query = db
      .collectionGroup('items')
      .where('communityId', '==', communityId)
      .limit(PAGE_SIZE);

    if (cursor) query = query.startAfter(cursor);

    const snapshot = await query.get();
    if (snapshot.empty) break;

    const refs = snapshot.docs
      .filter((document) => isCommunityUserPointerPath(document.ref.path))
      .map((document) => document.ref);

    deleted += await deleteRefs(refs);
    cursor = snapshot.docs[snapshot.docs.length - 1] ?? null;

    if (snapshot.size < PAGE_SIZE || !cursor) break;
  }

  return deleted;
}

async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  for (let offset = 0; offset < items.length; offset += concurrency) {
    await Promise.all(
      items.slice(offset, offset + concurrency).map((item) => worker(item))
    );
  }
}

async function cleanupPublishedPhotoAssets(communityId: string): Promise<{
  processed: number;
  queued: number;
}> {
  const posts = db
    .collection('community_feed_posts')
    .doc(communityId)
    .collection('items');
  let cursor: string | null = null;
  let processed = 0;
  let queued = 0;

  while (true) {
    let query = posts.orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);

    const snapshot = await query.get();
    if (snapshot.empty) break;

    const assets = snapshot.docs.flatMap((document) => {
      const post = document.data() ?? {};
      const image = (post['image'] ?? {}) as Record<string, unknown>;
      const storagePath = String(image['storagePath'] ?? '').trim();
      if (!storagePath) return [];

      const ownerUid = cleanId(post['actorUid']);
      if (!ownerUid) {
        throw new Error('community-purge-photo-owner-missing');
      }

      return [{
        ownerUid,
        photoId: document.id,
        storagePath,
      }];
    });

    await runWithConcurrency(
      assets,
      STORAGE_DELETE_CONCURRENCY,
      async (asset) => {
        const deleted = await deletePublishedPhotoAssetOrQueue({
          ownerUid: asset.ownerUid,
          photoId: asset.photoId,
          storagePath: asset.storagePath,
          reason: 'community-physical-purge',
        });
        processed += 1;
        if (!deleted) queued += 1;
      }
    );

    cursor = snapshot.docs[snapshot.docs.length - 1]?.id ?? null;
    if (snapshot.size < PAGE_SIZE || !cursor) break;
  }

  return { processed, queued };
}

async function deleteCommunityOperationalDocuments(
  communityId: string
): Promise<number> {
  let deleted = 0;

  for (const collectionName of COMMUNITY_OPERATIONAL_COLLECTIONS) {
    deleted += await deleteDocumentsByCommunityId(collectionName, communityId);
  }

  return deleted;
}

async function deleteCommunityScopedContainers(
  communityId: string
): Promise<number> {
  let deleted = 0;

  for (const collectionName of COMMUNITY_SCOPED_CONTAINERS) {
    const ref = db.collection(collectionName).doc(communityId);
    await db.recursiveDelete(ref);
    deleted += 1;
  }

  return deleted;
}

async function deleteCommunityRootSubcollections(
  communityId: string
): Promise<number> {
  const communityRef = db.collection('communities').doc(communityId);
  const childCollections = await communityRef.listCollections();

  for (const collection of childCollections) {
    await db.recursiveDelete(collection);
  }

  return childCollections.length;
}

export async function hasBlockingCommunityModerationReference(
  communityId: string
): Promise<boolean> {
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;

  while (true) {
    let query = db
      .collection('moderation_reports')
      .where('parentTargetId', '==', communityId)
      .limit(PAGE_SIZE);

    if (cursor) query = query.startAfter(cursor);

    const snapshot = await query.get();
    if (snapshot.empty) return false;

    for (const document of snapshot.docs) {
      const status = String(document.data()?.['status'] ?? '')
        .trim()
        .toLowerCase();

      if (!TERMINAL_MODERATION_REPORT_STATUSES.has(status)) {
        return true;
      }
    }

    cursor = snapshot.docs[snapshot.docs.length - 1] ?? null;
    if (snapshot.size < PAGE_SIZE || !cursor) return false;
  }
}

export async function executeCommunityPurgeCleanup(
  communityId: string
): Promise<CommunityPurgeCleanupSummary> {
  const photoCleanup = await cleanupPublishedPhotoAssets(communityId);
  const operationalDocumentsDeleted =
    await deleteCommunityOperationalDocuments(communityId);
  const userPointersDeleted = await deleteCommunityUserPointers(communityId);
  const scopedContainersDeleted =
    await deleteCommunityScopedContainers(communityId);
  const rootSubcollectionsDeleted =
    await deleteCommunityRootSubcollections(communityId);

  return {
    publishedPhotoAssetsProcessed: photoCleanup.processed,
    publishedPhotoAssetsQueued: photoCleanup.queued,
    operationalDocumentsDeleted,
    userPointersDeleted,
    scopedContainersDeleted,
    rootSubcollectionsDeleted,
  };
}
