import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  IAppNotification,
  ICommunityNotificationSummary,
} from 'src/app/core/interfaces/app-notification.interface';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { AppNotificationService } from 'src/app/core/services/notifications/app-notification.service';
import {
  CommunityNotificationUnreadSummary,
  CommunityNotificationUnreadSummaryService,
} from 'src/app/core/services/notifications/community-notification-unread-summary.service';
import { NotificationsPageComponent } from './notifications-page.component';

function communityNotification(
  id = 'notification-community-1',
  communityId = 'community-1'
): IAppNotification {
  return {
    id,
    userId: 'user-1',
    type: 'community.comment.received',
    title: 'Nova atividade na Comunidade',
    body: 'Uma publicação recebeu novos comentários.',
    route: `/dashboard/comunidades/minhas/${communityId}`,
    communityId,
    activityCount: 2,
    readAt: null,
    createdAt: 123,
    updatedAt: 123,
  };
}

describe('NotificationsPageComponent', () => {
  const refreshCurrentUserNotifications = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function configure(
    readState: 'loading' | 'ready' | 'error',
    communityUnreadCount = 0,
    recentCommunitySummaries: readonly ICommunityNotificationSummary[] = [],
    exactSummaryMap: ReadonlyMap<
      string,
      CommunityNotificationUnreadSummary
    > = new Map(),
    vmItems: readonly IAppNotification[] = [],
    globalUnreadCount = 0
  ): void {
    TestBed.configureTestingModule({
      imports: [NotificationsPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: AppNotificationService,
          useValue: {
            currentUserVm$: of({
              loading: false,
              items: [...vmItems],
              unreadCount: globalUnreadCount,
            }),
            currentUserReadState$: of(readState),
            currentUserCommunitySummaries$: of(recentCommunitySummaries),
            // Valor legado propositalmente divergente: o total exato de
            // Comunidades deve vir da projeção server-side dedicada.
            currentUserCommunityUnreadCount$: of(1),
            refreshCurrentUserNotifications,
            markAsRead$: vi.fn(),
            markAllAsRead$: vi.fn(),
          },
        },
        {
          provide: CommunityNotificationUnreadSummaryService,
          useValue: {
            currentUserUnreadCount$: of(communityUnreadCount),
            currentUserSummaryMap$: of(exactSummaryMap),
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showError: vi.fn(),
            showWarning: vi.fn(),
            showSuccess: vi.fn(),
          },
        },
      ],
    });
  }

  it('distingue falha de leitura do estado vazio e permite tentar novamente', () => {
    configure('error');

    const fixture = TestBed.createComponent(NotificationsPageComponent);
    fixture.detectChanges();
    fixture.detectChanges();

    const errorState = fixture.nativeElement.querySelector(
      '.notifications-state--error'
    ) as HTMLElement | null;
    const retryButton = fixture.nativeElement.querySelector(
      '.notifications-state__retry'
    ) as HTMLButtonElement | null;

    expect(errorState).not.toBeNull();
    expect(errorState?.getAttribute('role')).toBe('alert');
    expect(errorState?.textContent).toContain(
      'Não foi possível carregar as notificações.'
    );
    expect(errorState?.textContent).not.toContain('Nenhuma notificação.');
    expect(retryButton).not.toBeNull();

    retryButton?.click();

    expect(refreshCurrentUserNotifications).toHaveBeenCalledTimes(1);
  });

  it('mantém o estado vazio somente quando a leitura terminou sem erro', () => {
    configure('ready');

    const fixture = TestBed.createComponent(NotificationsPageComponent);
    fixture.detectChanges();
    fixture.detectChanges();

    const emptyState = fixture.nativeElement.querySelector(
      '.notifications-state--empty'
    ) as HTMLElement | null;

    expect(emptyState).not.toBeNull();
    expect(emptyState?.textContent).toContain('Nenhuma notificação.');
    expect(
      fixture.nativeElement.querySelector('.notifications-state--error')
    ).toBeNull();
  });

  it('usa a projeção agregada para o total multi-Comunidade', async () => {
    configure('ready', 17);

    const component = TestBed.runInInjectionContext(
      () => new NotificationsPageComponent()
    );

    expect(await firstValueFrom(component.communityUnreadCount$)).toBe(17);
  });

  it('usa a contagem exata sem atribuir ao card recente uma prioridade que ele não representa', async () => {
    const latestNotification = communityNotification();
    const recentSummary: ICommunityNotificationSummary = {
      communityId: 'community-1',
      latestNotification,
      unreadCount: 2,
      hasPriorityUnread: false,
    };
    const exactSummary: CommunityNotificationUnreadSummary = {
      communityId: 'community-1',
      unreadCount: 9,
      priorityUnreadCount: 3,
      hasPriorityUnread: true,
      updatedAt: 999,
    };

    configure(
      'ready',
      9,
      [recentSummary],
      new Map([['community-1', exactSummary]])
    );

    const component = TestBed.runInInjectionContext(
      () => new NotificationsPageComponent()
    );
    const summaries = await firstValueFrom(component.communitySummaries$);

    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.unreadCount).toBe(9);
    expect(summaries[0]?.hasPriorityUnread).toBe(false);
    expect(summaries[0]?.latestNotification).toBe(latestNotification);
    expect(component.notificationRoute(summaries[0]!.latestNotification)).toBe(
      '/dashboard/comunidades/minhas/community-1'
    );

    const fixture = TestBed.createComponent(NotificationsPageComponent);
    fixture.detectChanges();
    fixture.detectChanges();

    const status = fixture.nativeElement.querySelector(
      '.community-activity__status'
    ) as HTMLElement | null;
    const card = fixture.nativeElement.querySelector(
      '.community-activity__item'
    ) as HTMLElement | null;
    const scope = fixture.nativeElement.querySelector(
      '.community-activity__header p'
    ) as HTMLElement | null;

    expect(status?.textContent?.trim()).toBe('9 novidades');
    expect(card?.classList.contains('community-activity__item--priority')).toBe(false);
    expect(scope?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'As Comunidades abaixo refletem atividade recente; as pendências consideram todas as atividades não lidas.'
    );
  });

  it('preserva o resumo recente quando a projeção exata não contém a Comunidade', async () => {
    const latestNotification = communityNotification();
    const recentSummary: ICommunityNotificationSummary = {
      communityId: 'community-1',
      latestNotification,
      unreadCount: 2,
      hasPriorityUnread: false,
    };

    configure('ready', 0, [recentSummary], new Map());

    const component = TestBed.runInInjectionContext(
      () => new NotificationsPageComponent()
    );
    const summaries = await firstValueFrom(component.communitySummaries$);

    expect(summaries).toEqual([recentSummary]);
    expect(summaries[0]?.latestNotification).toBe(latestNotification);
  });

  it('mantém pendências antigas de Comunidades visíveis sem declarar a Central vazia', () => {
    const exactSummary: CommunityNotificationUnreadSummary = {
      communityId: 'community-older',
      unreadCount: 6,
      priorityUnreadCount: 1,
      hasPriorityUnread: true,
      updatedAt: 111,
    };

    configure(
      'ready',
      6,
      [],
      new Map([['community-older', exactSummary]]),
      [],
      1
    );

    const fixture = TestBed.createComponent(NotificationsPageComponent);
    fixture.detectChanges();
    fixture.detectChanges();

    const section = fixture.nativeElement.querySelector(
      '.community-activity'
    ) as HTMLElement | null;
    const total = fixture.nativeElement.querySelector(
      '.community-activity__total'
    ) as HTMLElement | null;
    const fallback = fixture.nativeElement.querySelector(
      '.community-activity__fallback'
    ) as HTMLElement | null;
    const link = fixture.nativeElement.querySelector(
      '.community-activity__fallback-link'
    ) as HTMLAnchorElement | null;

    expect(section).not.toBeNull();
    expect(total?.textContent?.replace(/\s+/g, ' ').trim()).toBe('6 pendentes');
    expect(fallback?.textContent?.replace(/\s+/g, ' ').trim()).toContain(
      'Abrir a lista não altera o estado de leitura das atividades.'
    );
    expect(link?.textContent?.trim()).toBe('Ver minhas Comunidades');
    expect(link?.getAttribute('href')).toBe('/dashboard/comunidades/minhas');
    expect(
      fixture.nativeElement.querySelector('.community-activity__item')
    ).toBeNull();
    expect(
      fixture.nativeElement.querySelector('.notifications-state--empty')
    ).toBeNull();
    expect(
      fixture.nativeElement.querySelector('.notifications-list')
    ).toBeNull();
  });
});
