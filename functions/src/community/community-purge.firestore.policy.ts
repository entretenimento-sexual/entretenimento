// functions/src/community/community-purge.firestore.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY PURGE FIRESTORE POLICY
// -----------------------------------------------------------------------------
// Define os namespaces que o adapter de purge pode excluir. A lista protegida é
// propositalmente separada para tornar revisões de segurança e compliance
// objetivas. Alterar estes conjuntos exige revisão explícita de retenção.
// -----------------------------------------------------------------------------

import type { CommunityPurgeReferenceKind } from './community-purge.executor';

export type CommunityPurgeTopLevelReferenceKind = Exclude<
  CommunityPurgeReferenceKind,
  'member_scoped_refs'
>;

export const COMMUNITY_PURGE_REFERENCE_COLLECTIONS: Readonly<
  Record<CommunityPurgeTopLevelReferenceKind, string>
> = Object.freeze({
  creation_requests: 'community_creation_requests',
  feed_requests: 'community_feed_requests',
  topic_requests: 'community_topic_requests',
  lifecycle_requests: 'community_lifecycle_requests',
  invites: 'invites',
  notifications: 'notifications',
});

export const COMMUNITY_PURGE_MEMBER_SCOPED_COLLECTIONS = Object.freeze([
  'community_feed_user_actions',
  'community_feed_user_reactions',
  'community_feed_user_comments',
  'community_feed_user_replies',
] as const);

export const COMMUNITY_PURGE_PROJECTION_ROOT_COLLECTIONS = Object.freeze([
  'community_discovery_index',
  'community_public_feed',
  'community_public_topics',
  'community_feed_realtime',
] as const);

export const COMMUNITY_PURGE_FINAL_ROOT_COLLECTIONS = Object.freeze([
  'community_feed_posts',
  'community_topics',
  'communities',
] as const);

export const COMMUNITY_PURGE_PROTECTED_COLLECTIONS = Object.freeze([
  'community_membership_audit',
  'community_feed_audit',
  'community_topic_audit',
  'community_lifecycle_audit',
  'community_purge_audit',
  'community_official_associations',
  'community_official_association_audit',
  'moderation_reports',
  'admin_logs',
  'compliance_audit',
] as const);

export function assertCommunityPurgeMembershipsTerminal(
  rawMemberships: readonly unknown[]
): void {
  for (const rawMembership of rawMemberships) {
    const membership = (rawMembership ?? {}) as Record<string, unknown>;
    if (membership['status'] !== 'left') {
      const error = new Error(
        'Purge bloqueado: existe membership sem estado terminal left.'
      ) as Error & { code?: string };
      error.code = 'community-purge-membership-not-terminal';
      throw error;
    }
  }
}

export function isCommunityPurgeProtectedCollection(
  collectionName: unknown
): boolean {
  const normalized = String(collectionName ?? '').trim();
  return (COMMUNITY_PURGE_PROTECTED_COLLECTIONS as readonly string[])
    .includes(normalized);
}
