import { describe, expect, it } from 'vitest';

import {
  applyCommunitySocialUnreadSuppressions,
  reconcileCommunitySocialUnreadSuppressions,
  shouldSuppressCommunitySocialUnreadLocally,
  type CommunityUnreadSummaryLike,
} from './community-notification-unread-summary.local';

interface TestSummary extends CommunityUnreadSummaryLike {
  readonly updatedAt: number | null;
}

function summary(
  communityId: string,
  unreadCount: number,
  priorityUnreadCount = 0
): TestSummary {
  return {
    communityId,
    unreadCount,
    priorityUnreadCount,
    hasPriorityUnread: priorityUnreadCount > 0,
    updatedAt: 100,
  };
}

describe('community notification local unread convergence', () => {
  it('suprime imediatamente somente a parcela social da Comunidade deixada', () => {
    const result = applyCommunitySocialUnreadSuppressions(
      [summary('community-a', 5, 2), summary('community-b', 3, 0)],
      new Set(['community-a'])
    );

    expect(result).toEqual([
      summary('community-a', 2, 2),
      summary('community-b', 3, 0),
    ]);
  });

  it('remove localmente o resumo quando ele contém apenas atividade social', () => {
    const result = applyCommunitySocialUnreadSuppressions(
      [summary('community-a', 4, 0)],
      new Set(['community-a'])
    );

    expect(result).toEqual([]);
  });

  it('preserva moderação obrigatória durante a saída', () => {
    const result = applyCommunitySocialUnreadSuppressions(
      [summary('community-a', 2, 2)],
      new Set(['community-a'])
    );

    expect(result).toEqual([summary('community-a', 2, 2)]);
  });

  it('mantém a supressão apenas até o listener canônico confirmar a reconciliação', () => {
    const suppressed = new Set(['community-a', 'community-b']);

    const stillPending = reconcileCommunitySocialUnreadSuppressions(
      [summary('community-a', 5, 2), summary('community-b', 3, 3)],
      suppressed
    );
    expect([...stillPending]).toEqual(['community-a']);

    const converged = reconcileCommunitySocialUnreadSuppressions(
      [summary('community-a', 2, 2)],
      stillPending
    );
    expect([...converged]).toEqual([]);
  });

  it('não cria supressão local sem atividade social pendente', () => {
    expect(
      shouldSuppressCommunitySocialUnreadLocally(
        [summary('community-a', 2, 2)],
        'community-a'
      )
    ).toBe(false);
    expect(
      shouldSuppressCommunitySocialUnreadLocally(
        [summary('community-a', 4, 1)],
        'community-a'
      )
    ).toBe(true);
  });
});
