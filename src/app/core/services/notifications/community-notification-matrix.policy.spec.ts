import { describe, expect, it } from 'vitest';

import type { IAppNotification } from 'src/app/core/interfaces/app-notification.interface';
import {
  COMMUNITY_NOTIFICATION_MATRIX,
  isCommunityNotificationPriority,
  isCommunityNotificationType,
} from './community-notification-matrix.policy';

const EXPECTED_TYPES = [
  'community.comment.received',
  'community.comment.reply.received',
  'community.post.reply.received',
  'community.post.reaction.received',
  'community.membership.approved',
  'community.membership.rejected',
  'community.membership.requested',
  'community.membership.removed',
  'community.membership.blocked',
  'community.membership.unblocked',
  'community.invite.accepted',
  'community.invite.declined',
  'community.content.moderated',
  'community.ownership.transfer_requested',
  'community.ownership.transfer_accepted',
  'community.ownership.transfer_declined',
  'community.ownership.transfer_canceled',
  'community.ownership.transfer_expired',
  'community.ownership.succession_archived',
] as const;

function notification(
  type: IAppNotification['type'],
  actionRequired = false
): Pick<IAppNotification, 'type' | 'actionRequired'> {
  return { type, actionRequired };
}

describe('community notification matrix', () => {
  it('fecha os tipos canônicos atuais e fixa background agregado', () => {
    expect(Object.keys(COMMUNITY_NOTIFICATION_MATRIX).sort())
      .toEqual([...EXPECTED_TYPES].sort());

    for (const type of EXPECTED_TYPES) {
      expect(isCommunityNotificationType(type)).toBe(true);
      expect(COMMUNITY_NOTIFICATION_MATRIX[type].backgroundProjection)
        .toBe('aggregate_summary');
      expect(COMMUNITY_NOTIFICATION_MATRIX[type].foregroundMode)
        .toBe('detailed_realtime');
    }
  });

  it.each([
    'community.membership.requested',
    'community.membership.removed',
    'community.membership.blocked',
    'community.content.moderated',
    'community.ownership.transfer_requested',
    'community.ownership.transfer_expired',
    'community.ownership.succession_archived',
  ] as const)('marca %s como prioridade', (type) => {
    expect(isCommunityNotificationPriority(notification(type))).toBe(true);
  });

  it('preserva actionRequired como escalada de prioridade', () => {
    expect(isCommunityNotificationPriority(
      notification('community.membership.approved', true)
    )).toBe(true);
  });

  it('não classifica domínios externos como Comunidade', () => {
    expect(isCommunityNotificationType('chat')).toBe(false);
  });
});
