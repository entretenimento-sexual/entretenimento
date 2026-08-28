import { consumeBackendRateLimitQuota } from './backend-rate-limit.service';
import {
  getPublicMediaSocialInteractionRateLimitConfig,
  type PublicMediaSocialInteractionKind,
} from './public-media-social-interaction-rate-limit';

type PublicPhotoSocialInteractionKind = Extract<
  PublicMediaSocialInteractionKind,
  'reaction' | 'comment'
>;

const ACTION_BY_KIND: Record<PublicPhotoSocialInteractionKind, string> = {
  reaction: 'togglePhotoReaction',
  comment: 'createPhotoComment',
};

const MESSAGE_BY_KIND: Record<PublicPhotoSocialInteractionKind, string> = {
  reaction: 'Muitas reações foram enviadas em pouco tempo.',
  comment: 'Muitos comentários foram enviados em pouco tempo.',
};

export async function consumePublicPhotoSocialInteractionQuota(
  kind: PublicPhotoSocialInteractionKind,
  viewerUid: string,
  now = Date.now()
): Promise<void> {
  await consumeBackendRateLimitQuota({
    action: ACTION_BY_KIND[kind],
    subject: viewerUid,
    cost: 1,
    config: getPublicMediaSocialInteractionRateLimitConfig(kind),
    message: MESSAGE_BY_KIND[kind],
    now,
  });
}
