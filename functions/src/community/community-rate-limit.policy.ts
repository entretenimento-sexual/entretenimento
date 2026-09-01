// functions/src/community/community-rate-limit.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY RATE LIMIT POLICY
// -----------------------------------------------------------------------------
// Política única de antiabuso operacional das mutações de Comunidades.
//
// Importante: estes limites burst/sustained NÃO substituem quotas de produto
// existentes (ex.: quantidade máxima de posts/tópicos em 24h). Quotas de produto
// continuam no domínio que as define; esta política limita automação/spam em
// janelas curtas antes das operações transacionais mais caras.
// -----------------------------------------------------------------------------

import type {
  BackendFixedWindowRateLimitConfig,
} from '../media/application/backend-fixed-window-rate-limit';

export type CommunityRateLimitAction =
  | 'feed_post'
  | 'feed_conversation'
  | 'feed_reaction'
  | 'feed_report_post'
  | 'feed_report_comment'
  | 'feed_report_reply'
  | 'invite_send'
  | 'membership_request'
  | 'member_management';

export interface CommunityRateLimitPolicy {
  readonly backendAction: string;
  readonly config: BackendFixedWindowRateLimitConfig;
  readonly reason: string;
  readonly message: string;
}

const MINUTE_MS = 60 * 1_000;
const HOUR_MS = 60 * MINUTE_MS;

const POLICY_BY_ACTION: Readonly<Record<
  CommunityRateLimitAction,
  CommunityRateLimitPolicy
>> = Object.freeze({
  feed_post: Object.freeze({
    backendAction: 'createCommunityFeedPost',
    config: Object.freeze({
      burstWindowMs: MINUTE_MS,
      burstMax: 6,
      sustainedWindowMs: 10 * MINUTE_MS,
      sustainedMax: 18,
    }),
    reason: 'community_feed_rate_limited',
    message: 'Muitas publicações foram enviadas em pouco tempo.',
  }),
  feed_conversation: Object.freeze({
    // Preserva o identificador já utilizado em produção para não zerar quota.
    backendAction: 'createCommunityFeedComment',
    config: Object.freeze({
      burstWindowMs: MINUTE_MS,
      burstMax: 12,
      sustainedWindowMs: 10 * MINUTE_MS,
      sustainedMax: 60,
    }),
    reason: 'community_feed_conversation_rate_limited',
    message: 'Muitas mensagens foram enviadas em pouco tempo.',
  }),
  feed_reaction: Object.freeze({
    // Preserva o identificador já utilizado em produção para não zerar quota.
    backendAction: 'toggleCommunityFeedReaction',
    config: Object.freeze({
      burstWindowMs: MINUTE_MS,
      burstMax: 40,
      sustainedWindowMs: 10 * MINUTE_MS,
      sustainedMax: 180,
    }),
    reason: 'community_feed_reaction_rate_limited',
    message: 'Muitas reações foram enviadas em pouco tempo.',
  }),
  feed_report_post: Object.freeze({
    backendAction: 'reportCommunityFeedPost',
    config: Object.freeze({
      burstWindowMs: MINUTE_MS,
      burstMax: 12,
      sustainedWindowMs: 10 * MINUTE_MS,
      sustainedMax: 48,
    }),
    reason: 'community_report_rate_limited',
    message: 'Muitas denúncias foram enviadas em pouco tempo.',
  }),
  feed_report_comment: Object.freeze({
    backendAction: 'reportCommunityFeedComment',
    config: Object.freeze({
      burstWindowMs: MINUTE_MS,
      burstMax: 12,
      sustainedWindowMs: 10 * MINUTE_MS,
      sustainedMax: 48,
    }),
    reason: 'community_report_rate_limited',
    message: 'Muitas denúncias foram enviadas em pouco tempo.',
  }),
  feed_report_reply: Object.freeze({
    backendAction: 'reportCommunityFeedCommentReply',
    config: Object.freeze({
      burstWindowMs: MINUTE_MS,
      burstMax: 12,
      sustainedWindowMs: 10 * MINUTE_MS,
      sustainedMax: 48,
    }),
    reason: 'community_report_rate_limited',
    message: 'Muitas denúncias foram enviadas em pouco tempo.',
  }),
  invite_send: Object.freeze({
    backendAction: 'sendCommunityInvite',
    config: Object.freeze({
      burstWindowMs: MINUTE_MS,
      burstMax: 6,
      sustainedWindowMs: HOUR_MS,
      sustainedMax: 24,
    }),
    reason: 'community_invite_rate_limited',
    message: 'Muitos convites foram enviados em pouco tempo.',
  }),
  membership_request: Object.freeze({
    backendAction: 'requestCommunityMembership',
    config: Object.freeze({
      burstWindowMs: MINUTE_MS,
      burstMax: 6,
      sustainedWindowMs: HOUR_MS,
      sustainedMax: 20,
    }),
    reason: 'community_membership_rate_limited',
    message: 'Muitas solicitações de entrada foram feitas em pouco tempo.',
  }),
  member_management: Object.freeze({
    backendAction: 'manageCommunityMember',
    config: Object.freeze({
      burstWindowMs: MINUTE_MS,
      burstMax: 20,
      sustainedWindowMs: HOUR_MS,
      sustainedMax: 100,
    }),
    reason: 'community_management_rate_limited',
    message: 'Muitas ações de gestão foram executadas em pouco tempo.',
  }),
});

export function getCommunityRateLimitPolicy(
  action: CommunityRateLimitAction
): Readonly<CommunityRateLimitPolicy> {
  return POLICY_BY_ACTION[action];
}
