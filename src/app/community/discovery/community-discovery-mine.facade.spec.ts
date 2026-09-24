import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import {
  CommunityDiscoveryMineCardView,
  CommunityDiscoveryMineFacade,
} from './community-discovery-mine.facade';

function card(input: Partial<CommunityDiscoveryMineCardView> = {}): CommunityDiscoveryMineCardView {
  return {
    communityId: 'community-1',
    name: 'Comunidade Um',
    description: '',
    imageUrl: null,
    source: { type: 'community' },
    status: 'active',
    visibility: 'public',
    memberCount: 10,
    tags: [],
    viewerMembershipStatus: 'active',
    viewerRole: 'member',
    viewerNotificationSummary: null,
    notificationUnreadCount: 0,
    notificationHasPriorityUnread: false,
    notificationUpdatedAt: null,
    notificationsMuted: false,
    ...input,
  } as CommunityDiscoveryMineCardView;
}

describe('CommunityDiscoveryMineFacade view surface', () => {
  let facade: CommunityDiscoveryMineFacade;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        CommunityDiscoveryMineFacade,
        {
          provide: ApplicationErrorService,
          useValue: { report: vi.fn() },
        },
      ],
    });

    facade = TestBed.inject(CommunityDiscoveryMineFacade);
  });

  it('centraliza busca e filtros de participação', () => {
    expect(facade.searchValue()).toBe('');
    expect(facade.isParticipationFilterSelected('all')).toBe(true);

    const input = document.createElement('input');
    input.value = 'administro';
    input.addEventListener('input', (event) => facade.changeSearch(event));
    input.dispatchEvent(new Event('input'));
    facade.selectParticipationFilter('managed');

    expect(facade.searchValue()).toBe('administro');
    expect(facade.isParticipationFilterSelected('managed')).toBe(true);

    facade.clearControls();

    expect(facade.searchValue()).toBe('');
    expect(facade.isParticipationFilterSelected('all')).toBe(true);
  });

  it('resolve agrupamento de atenção e apresentação de notificação', () => {
    const priority = card({
      communityId: 'priority',
      notificationUnreadCount: 3,
      notificationHasPriorityUnread: true,
    });
    const unread = card({
      communityId: 'unread',
      notificationUnreadCount: 2,
    });
    const quiet = card({ communityId: 'quiet' });

    expect(facade.attentionGroupKey(priority)).toBe('priority');
    expect(facade.attentionGroupPresentation(priority).label).toBe(
      'Precisa de atenção'
    );
    expect(facade.notificationStatusPresentation(unread)?.label).toBe(
      '2 não lidas'
    );
    expect(facade.notificationStatusPresentation(quiet)).toBeNull();

    expect(facade.startsAttentionGroup([priority, unread, quiet], 0)).toBe(true);
    expect(facade.startsAttentionGroup([priority, unread, quiet], 1)).toBe(true);
    expect(facade.startsAttentionGroup([unread, unread], 1)).toBe(false);
  });

  it('gera rótulo acessível incluindo prioridade quando necessário', () => {
    expect(
      facade.notificationUnreadAriaLabel(
        card({
          notificationUnreadCount: 4,
          notificationHasPriorityUnread: true,
        })
      )
    ).toBe('4 atividades não lidas, incluindo atividade prioritária');
  });
});
