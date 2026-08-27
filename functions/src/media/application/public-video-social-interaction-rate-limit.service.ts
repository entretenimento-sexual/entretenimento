import { consumeBackendRateLimitQuota } from './backend-rate-limit.service';
import {
  getPublicVideoSocialInteractionRateLimitConfig,
  type PublicVideoSocialInteractionKind,
} from './public-video-social-interaction-rate-limit';

const ACTION_BY_KIND: Record<PublicVideoSocialInteractionKind, string> = {
  reaction: 'toggleVideoReaction',
  comment: 'createVideoComment',
  rating: 'rateVideo',
};

const MESSAGE_BY_KIND: Record<PublicVideoSocialInteractionKind, string> = {
  reaction: 'Muitas reações foram enviadas em pouco tempo.',
  comment: 'Muitos comentários foram enviados em pouco tempo.',
  rating: 'Muitas avaliações foram enviadas em pouco tempo.',
};

export async function consumePublicVideoSocialInteractionQuota(
  kind: PublicVideoSocialInteractionKind,
  viewerUid: string,
  now = Date.now()
): Promise<void> {
  await consumeBackendRateLimitQuota({
    action: ACTION_BY_KIND[kind],
    subject: viewerUid,
    cost: 1,
    config: getPublicVideoSocialInteractionRateLimitConfig(kind),
    message: MESSAGE_BY_KIND[kind],
    now,
  });
}
