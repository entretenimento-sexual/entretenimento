import { describe, expect, it } from 'vitest';

import {
  initialCommunityNotificationLocalOverlayState,
  reduceCommunityNotificationLocalOverlay,
  visibleCommunityNotificationSummaries,
} from './community-notification-local-overlay.policy';

interface Summary {
  communityId: string;
  unreadCount: number;
}

const summary = (communityId: string, unreadCount = 1): Summary => ({
  communityId,
  unreadCount,
});

describe('community notification local overlay', () => {
  it('oculta imediatamente a Comunidade após saída local sem alterar a projeção canônica', () => {
    let state = reduceCommunityNotificationLocalOverlay(
      initialCommunityNotificationLocalOverlayState<Summary>(),
      {
        kind: 'server',
        viewerUid: 'user-1',
        summaries: [summary('community-a', 3), summary('community-b', 2)],
      }
    );

    state = reduceCommunityNotificationLocalOverlay(state, {
      kind: 'suppress',
      communityId: 'community-a',
    });

    expect(state.serverSummaries).toHaveLength(2);
    expect(visibleCommunityNotificationSummaries(state)).toEqual([
      summary('community-b', 2),
    ]);
  });

  it('remove a supressão transitória quando o backend confirma a remoção do resumo', () => {
    let state = reduceCommunityNotificationLocalOverlay(
      initialCommunityNotificationLocalOverlayState<Summary>(),
      {
        kind: 'server',
        viewerUid: 'user-1',
        summaries: [summary('community-a', 3)],
      }
    );
    state = reduceCommunityNotificationLocalOverlay(state, {
      kind: 'suppress',
      communityId: 'community-a',
    });
    state = reduceCommunityNotificationLocalOverlay(state, {
      kind: 'server',
      viewerUid: 'user-1',
      summaries: [],
    });

    expect(state.suppressedCommunityIds).toEqual([]);

    state = reduceCommunityNotificationLocalOverlay(state, {
      kind: 'server',
      viewerUid: 'user-1',
      summaries: [summary('community-a', 1)],
    });

    expect(visibleCommunityNotificationSummaries(state)).toEqual([
      summary('community-a', 1),
    ]);
  });

  it('não carrega supressão local entre contas', () => {
    let state = reduceCommunityNotificationLocalOverlay(
      initialCommunityNotificationLocalOverlayState<Summary>(),
      {
        kind: 'server',
        viewerUid: 'user-1',
        summaries: [summary('community-a', 3)],
      }
    );
    state = reduceCommunityNotificationLocalOverlay(state, {
      kind: 'suppress',
      communityId: 'community-a',
    });
    state = reduceCommunityNotificationLocalOverlay(state, {
      kind: 'server',
      viewerUid: 'user-2',
      summaries: [summary('community-a', 4)],
    });

    expect(state.suppressedCommunityIds).toEqual([]);
    expect(visibleCommunityNotificationSummaries(state)).toEqual([
      summary('community-a', 4),
    ]);
  });
});
