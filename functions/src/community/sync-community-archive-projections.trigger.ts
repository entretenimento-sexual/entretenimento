// functions/src/community/sync-community-archive-projections.trigger.ts
// -----------------------------------------------------------------------------
// SYNC COMMUNITY ARCHIVE PROJECTIONS
// -----------------------------------------------------------------------------
// Quando uma Comunidade entra em archived, remove somente projeções de navegação:
// - community_discovery_index;
// - community_user_index de todos os vínculos conhecidos.
//
// Memberships, mural, tópicos, mídia e auditoria permanecem preservados para
// leitura histórica, moderação e retenção. Exclusões são idempotentes e paginadas.
// -----------------------------------------------------------------------------

import { FieldPath } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import { shouldCleanupCommunityArchiveProjections } from './community-archive-projection.policy';

const MEMBER_PAGE_SIZE = 300;

async function deleteCommunityUserIndexes(communityId: string): Promise<number> {
  const membersCollection = db
    .collection('communities')
    .doc(communityId)
    .collection('members');
  let cursor: string | null = null;
  let deleted = 0;

  while (true) {
    let query = membersCollection
      .orderBy(FieldPath.documentId())
      .limit(MEMBER_PAGE_SIZE);

    if (cursor) query = query.startAfter(cursor);

    const snapshot = await query.get();
    if (snapshot.empty) break;

    const batch = db.batch();
    for (const membership of snapshot.docs) {
      const indexRef = db
        .collection('community_user_index')
        .doc(membership.id)
        .collection('items')
        .doc(communityId);
      batch.delete(indexRef);
    }

    await batch.commit();
    deleted += snapshot.size;
    cursor = snapshot.docs[snapshot.docs.length - 1]?.id ?? null;

    if (snapshot.size < MEMBER_PAGE_SIZE || !cursor) break;
  }

  return deleted;
}

export const syncCommunityArchiveProjections = onDocumentUpdated(
  {
    document: 'communities/{communityId}',
    region: FUNCTIONS_REGION,
    retry: true,
    timeoutSeconds: 300,
  },
  async (event) => {
    const before = event.data?.before.exists
      ? event.data.before.data()
      : null;
    const after = event.data?.after.exists
      ? event.data.after.data()
      : null;

    if (!shouldCleanupCommunityArchiveProjections(before, after)) return;

    const communityId = String(event.params['communityId'] ?? '').trim();
    if (!communityId) return;

    await db.collection('community_discovery_index').doc(communityId).delete();
    const deletedUserIndexes = await deleteCommunityUserIndexes(communityId);

    logger.info('community_archive_projections_cleaned', {
      communityId,
      deletedUserIndexes,
    });
  }
);
