import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import type { ActionReducer } from '@ngrx/store';
import { beforeEach, describe, expect, it } from 'vitest';

import type { IAppNotification } from 'src/app/core/interfaces/app-notification.interface';
import { buildCommunityNotificationSummaries } from 'src/app/core/services/notifications/community-notification-summary.policy';
import {
  CommunityRealtimeAttentionCoordinatorService,
  type CommunityRealtimeAttentionMode,
} from 'src/app/community/data-access/community-realtime-attention-coordinator.service';
import {
  buildCommunityDiscoveryCacheKey,
  buildCommunityDiscoveryCacheQuery,
} from 'src/app/community/discovery/community-discovery-cache.model';
import type { CommunityPreviewCard } from 'src/app/community/data-access/community-preview.model';
import * as CommunityDiscoveryCacheActions from 'src/app/store/actions/actions.discovery/community-discovery-cache.actions';
import { authSessionChanged } from 'src/app/store/actions/actions.user/auth.actions';
import { STORE_FEATURE } from 'src/app/store/reducers/feature-keys';
import { resetStoreOnAuthChangeMetaReducer } from 'src/app/store/reducers/meta-reducers/reset-store-on-auth-change.metareducer';
import { communityDiscoveryCacheReducer } from 'src/app/store/reducers/reducers.discovery/community-discovery-cache.reducer';
import {
  type CommunityDiscoveryCacheState,
  initialCommunityDiscoveryCacheState,
} from 'src/app/store/states/states.discovery/community-discovery-cache.state';
import type { AppState } from 'src/app/store/states/app.state';

const COMMUNITY_COUNTS = [1, 5, 20, 100] as const;
const PAGE_SIZE = 12;

function notification(id: string, communityId: string, createdAt: number): IAppNotification {
  return {
    id,
    userId: 'viewer-a',
    type: 'community.comment.received',
    title: 'Nova mensagem',
    body: 'Atividade sintética.',
    route: null,
    communityId,
    activityCount: 1,
    readAt: null,
    createdAt,
    updatedAt: createdAt,
  };
}

function card(id: string): CommunityPreviewCard {
  return {
    communityId: id,
    name: `Comunidade ${id}`,
    slug: `comunidade-${id}`,
    description: null,
    source: { type: 'community', id },
    avatarUrl: null,
    coverUrl: null,
    metrics: { memberCount: 1, postCount: 0, mediaCount: 0 },
    access: {
      join: 'approval',
      minimumRole: null,
      requiresActiveSubscription: false,
    },
    tags: [],
  };
}

class FakeDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';

  setVisibility(state: DocumentVisibilityState): void {
    this.visibilityState = state;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

describe('Community operational synthetic validation / multi-community scale', () => {
  for (const communityCount of COMMUNITY_COUNTS) {
    it(`agrega notificações de ${communityCount} Comunidades sem misturar escopos`, () => {
      const notifications = Array.from(
        { length: communityCount },
        (_, index) => notification(
          `notification-${index + 1}`,
          `community-${index + 1}`,
          index + 1
        )
      );

      const summaries = buildCommunityNotificationSummaries(notifications);

      expect(summaries).toHaveLength(communityCount);
      expect(
        summaries.reduce((total, summary) => total + summary.unreadCount, 0)
      ).toBe(communityCount);
      expect(new Set(summaries.map((summary) => summary.communityId)).size)
        .toBe(communityCount);
    });

    it(`mantém paginação/cache estáveis com ${communityCount} Comunidades`, () => {
      const query = buildCommunityDiscoveryCacheQuery('viewer-a', {
        sourceType: 'community',
        discoveryMode: 'mine',
        tagId: null,
        pageSize: PAGE_SIZE,
      })!;

      let state: CommunityDiscoveryCacheState = {
        ...initialCommunityDiscoveryCacheState,
        activeViewerUid: 'viewer-a',
      };

      for (let offset = 0; offset < communityCount; offset += PAGE_SIZE) {
        const size = Math.min(PAGE_SIZE, communityCount - offset);
        const items = Array.from(
          { length: size },
          (_, index) => card(`c-${offset + index + 1}`)
        );
        const consumed = offset + size;

        state = communityDiscoveryCacheReducer(
          state,
          CommunityDiscoveryCacheActions.storeCommunityDiscoveryPage({
            query,
            page: {
              items,
              nextCursor: consumed < communityCount ? `cursor-${consumed}` : null,
              generatedAt: consumed,
            },
            append: offset > 0,
            storedAt: consumed,
          })
        );
      }

      const slices = Object.values(state.byQuery);
      expect(slices).toHaveLength(1);
      expect(slices[0]?.items).toHaveLength(communityCount);
      expect(new Set(slices[0]?.items.map((item) => item.communityId)).size)
        .toBe(communityCount);
      expect(slices[0]?.nextCursor).toBeNull();
    });
  }
});

describe('Community operational synthetic validation / concurrent attention', () => {
  let fakeDocument: FakeDocument;
  let service: CommunityRealtimeAttentionCoordinatorService;

  beforeEach(() => {
    fakeDocument = new FakeDocument();
    TestBed.configureTestingModule({
      providers: [
        CommunityRealtimeAttentionCoordinatorService,
        { provide: DOCUMENT, useValue: fakeDocument },
      ],
    });
    service = TestBed.inject(CommunityRealtimeAttentionCoordinatorService);
  });

  for (const communityCount of COMMUNITY_COUNTS) {
    it(`permite somente 1 realtime detalhado entre ${communityCount} Comunidades simultâneas`, () => {
      const modes = Array.from(
        { length: communityCount },
        () => [] as CommunityRealtimeAttentionMode[]
      );
      const subscriptions = modes.map((history, index) =>
        service.claimMode$(`community-${index + 1}`).subscribe((mode) => {
          history.push(mode);
        })
      );

      const currentModes = () => modes.map((history) => history.at(-1));

      expect(currentModes().filter((mode) => mode === 'detailed')).toHaveLength(1);
      expect(currentModes().at(-1)).toBe('detailed');

      fakeDocument.setVisibility('hidden');
      expect(currentModes().filter((mode) => mode === 'detailed')).toHaveLength(0);

      fakeDocument.setVisibility('visible');
      expect(currentModes().filter((mode) => mode === 'detailed')).toHaveLength(1);
      expect(currentModes().at(-1)).toBe('detailed');

      [...subscriptions].reverse().forEach((subscription) => subscription.unsubscribe());
    });
  }
});

describe('Community operational synthetic validation / session isolation', () => {
  it('purga 100 Comunidades da conta A e rejeita resposta atrasada depois da troca A→B', () => {
    const queryA = buildCommunityDiscoveryCacheQuery('viewer-a', {
      sourceType: 'community',
      discoveryMode: 'mine',
      tagId: null,
      pageSize: PAGE_SIZE,
    })!;
    const keyA = buildCommunityDiscoveryCacheKey(queryA);
    const populatedCache = {
      activeViewerUid: 'viewer-a',
      byQuery: {
        [keyA]: {
          query: queryA,
          items: Array.from({ length: 100 }, (_, index) => card(`a-${index + 1}`)),
          nextCursor: null,
          lastLoadedAt: 100,
        },
      },
    };

    const stateA = {
      [STORE_FEATURE.auth]: {
        ready: true,
        isAuthenticated: true,
        userId: 'viewer-a',
        emailVerified: true,
        loading: false,
        error: null,
      },
      [STORE_FEATURE.communityDiscoveryCache]: populatedCache,
    } as unknown as AppState;

    const passthroughReducer: ActionReducer<AppState> = (state) => state as AppState;
    const reducer = resetStoreOnAuthChangeMetaReducer(passthroughReducer);
    const stateB = reducer(
      stateA,
      authSessionChanged({ uid: 'viewer-b', emailVerified: true })
    );
    const cacheB = stateB[STORE_FEATURE.communityDiscoveryCache];

    expect(cacheB.activeViewerUid).toBe('viewer-b');
    expect(cacheB.byQuery).toEqual({});

    const afterLateAResponse = communityDiscoveryCacheReducer(
      cacheB,
      CommunityDiscoveryCacheActions.storeCommunityDiscoveryPage({
        query: queryA,
        page: {
          items: [card('late-from-a')],
          nextCursor: null,
          generatedAt: 200,
        },
        append: false,
        storedAt: 200,
      })
    );

    expect(afterLateAResponse).toBe(cacheB);
    expect(afterLateAResponse.byQuery).toEqual({});
  });
});
