import { describe, expect, it } from 'vitest';

import type { IAppNotification } from 'src/app/core/interfaces/app-notification.interface';

import {
  buildCommunityNotificationSummaries,
  communityNotificationActivityCount,
  isCommunityPriorityNotification,
} from './community-notification-summary.policy';

function notification(
  patch: Partial<IAppNotification> & Pick<IAppNotification, 'id' | 'type'>
): IAppNotification {
  const { id, type, ...overrides } = patch;

  return {
    id,
    userId: 'user-1',
    type,
    title: 'Título',
    body: 'Mensagem',
    route: null,
    readAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('community notification summary policy', () => {
  it('agrupa várias comunidades sem criar outra fonte de dados', () => {
    const summaries = buildCommunityNotificationSummaries([
      notification({
        id: 'reply-1',
        type: 'community.comment.reply.received',
        communityId: 'community-a',
        createdAt: 30,
      }),
      notification({
        id: 'comment-1',
        type: 'community.comment.received',
        communityId: 'community-a',
        createdAt: 20,
      }),
      notification({
        id: 'comment-2',
        type: 'community.comment.received',
        communityId: 'community-b',
        createdAt: 10,
      }),
      notification({
        id: 'system-1',
        type: 'system',
        createdAt: 40,
      }),
    ]);

    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toMatchObject({
      communityId: 'community-a',
      unreadCount: 2,
    });
    expect(summaries[0]?.latestNotification.id).toBe('reply-1');
    expect(summaries[1]).toMatchObject({
      communityId: 'community-b',
      unreadCount: 1,
    });
  });

  it('contabiliza todas as atividades não lidas agrupadas no mesmo documento', () => {
    const summaries = buildCommunityNotificationSummaries([
      notification({
        id: 'reply-group',
        type: 'community.comment.reply.received',
        communityId: 'community-a',
        activityCount: 4,
        createdAt: 30,
      }),
      notification({
        id: 'comment-single',
        type: 'community.comment.received',
        communityId: 'community-a',
        activityCount: null,
        createdAt: 20,
      }),
      notification({
        id: 'read-group',
        type: 'community.comment.reply.received',
        communityId: 'community-a',
        activityCount: 7,
        readAt: 50,
        createdAt: 10,
      }),
    ]);

    expect(summaries[0]?.unreadCount).toBe(5);
    expect(
      communityNotificationActivityCount(
        notification({
          id: 'invalid-count',
          type: 'community.comment.received',
          activityCount: 0,
        })
      )
    ).toBe(1);
  });

  it('não contabiliza como não lidas as notificações já abertas', () => {
    const summaries = buildCommunityNotificationSummaries([
      notification({
        id: 'read-1',
        type: 'community.comment.received',
        communityId: 'community-a',
        readAt: 50,
      }),
      notification({
        id: 'unread-1',
        type: 'community.comment.reply.received',
        communityId: 'community-a',
        readAt: null,
      }),
    ]);

    expect(summaries[0]?.unreadCount).toBe(1);
  });

  it('marca moderação como prioridade inclusive para resposta legada', () => {
    const moderatedReply = notification({
      id: 'moderation-1',
      type: 'community.content.moderated',
      communityId: 'community-a',
      moderationTarget: 'reply',
      replyId: 'reply-1',
    });

    expect(isCommunityPriorityNotification(moderatedReply)).toBe(true);
    expect(
      buildCommunityNotificationSummaries([moderatedReply])[0]
        ?.hasPriorityUnread
    ).toBe(true);
  });

  it('preserva a ordenação pela atividade mais recente da comunidade', () => {
    const summaries = buildCommunityNotificationSummaries([
      notification({
        id: 'a-old',
        type: 'community.comment.received',
        communityId: 'community-a',
        createdAt: 10,
      }),
      notification({
        id: 'b-new',
        type: 'community.comment.received',
        communityId: 'community-b',
        createdAt: 40,
      }),
      notification({
        id: 'a-new',
        type: 'community.comment.reply.received',
        communityId: 'community-a',
        createdAt: 30,
      }),
    ]);

    expect(summaries.map((item) => item.communityId)).toEqual([
      'community-b',
      'community-a',
    ]);
    expect(summaries[1]?.latestNotification.id).toBe('a-new');
  });
});
