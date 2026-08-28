// functions/src/community/community-purge-readiness.service.ts
// -----------------------------------------------------------------------------
// COMMUNITY PURGE READINESS SERVICE
// -----------------------------------------------------------------------------
// Coleta somente as provas mínimas necessárias para a política de purge.
// Nenhuma consulta deste serviço apaga ou altera dados.
//
// Falhas de leitura são convertidas em estado desconhecido para que a política
// `evaluateCommunityPurgeReadiness` bloqueie a exclusão (fail closed).
// -----------------------------------------------------------------------------

import { db } from '../firebaseApp';
import type { CommunityPurgeEvidenceProbe } from './community-purge.policy';

export type CommunityPurgeProbeName =
  | 'memberships'
  | 'feed_posts'
  | 'topics'
  | 'moderation_parent'
  | 'moderation_container';

export interface CommunityPurgeEvidenceReadResult {
  evidence: CommunityPurgeEvidenceProbe;
  failedProbes: readonly CommunityPurgeProbeName[];
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function normalizeCommunityId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function isRejected(
  result: PromiseSettledResult<FirebaseFirestore.QuerySnapshot>
): result is PromiseRejectedResult {
  return result.status === 'rejected';
}

export async function readCommunityPurgeEvidence(
  communityIdRaw: unknown
): Promise<CommunityPurgeEvidenceReadResult> {
  const communityId = normalizeCommunityId(communityIdRaw);

  if (!communityId) {
    return {
      evidence: {
        hasLiveMemberships: null,
        hasRetainedContent: null,
        hasModerationEvidence: null,
      },
      failedProbes: [
        'memberships',
        'feed_posts',
        'topics',
        'moderation_parent',
        'moderation_container',
      ],
    };
  }

  const communityRef = db.collection('communities').doc(communityId);
  const membershipQuery = communityRef
    .collection('members')
    .where('status', 'in', ['active', 'pending', 'blocked'])
    .limit(1);
  const feedPostQuery = db
    .collection('community_feed_posts')
    .doc(communityId)
    .collection('items')
    .limit(1);
  const topicQuery = db
    .collection('community_topics')
    .doc(communityId)
    .collection('items')
    .limit(1);
  const moderationParentQuery = db
    .collection('moderation_reports')
    .where('parentTargetId', '==', communityId)
    .limit(1);
  const moderationContainerQuery = db
    .collection('moderation_reports')
    .where('containerTargetId', '==', communityId)
    .limit(1);

  const [
    memberships,
    feedPosts,
    topics,
    moderationParent,
    moderationContainer,
  ] = await Promise.allSettled([
    membershipQuery.get(),
    feedPostQuery.get(),
    topicQuery.get(),
    moderationParentQuery.get(),
    moderationContainerQuery.get(),
  ]);

  const failedProbes: CommunityPurgeProbeName[] = [];
  if (isRejected(memberships)) failedProbes.push('memberships');
  if (isRejected(feedPosts)) failedProbes.push('feed_posts');
  if (isRejected(topics)) failedProbes.push('topics');
  if (isRejected(moderationParent)) failedProbes.push('moderation_parent');
  if (isRejected(moderationContainer)) {
    failedProbes.push('moderation_container');
  }

  const hasLiveMemberships = isRejected(memberships)
    ? null
    : !memberships.value.empty;
  const hasRetainedContent = isRejected(feedPosts) || isRejected(topics)
    ? null
    : !feedPosts.value.empty || !topics.value.empty;
  const hasModerationEvidence =
    isRejected(moderationParent) || isRejected(moderationContainer)
      ? null
      : !moderationParent.value.empty || !moderationContainer.value.empty;

  return {
    evidence: {
      hasLiveMemberships,
      hasRetainedContent,
      hasModerationEvidence,
    },
    failedProbes,
  };
}
