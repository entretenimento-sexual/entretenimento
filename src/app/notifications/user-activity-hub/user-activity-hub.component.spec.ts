import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { AppNotificationService } from 'src/app/core/services/notifications/app-notification.service';
import { CommunityNotificationUnreadSummaryService } from 'src/app/core/services/notifications/community-notification-unread-summary.service';
import { UserActivityHubComponent } from './user-activity-hub.component';

describe('UserActivityHubComponent', () => {
  it('mantém categorias recentes, usa projeção agregada de Comunidades e preserva o total global da Central', () => {
    TestBed.configureTestingModule({
      imports: [UserActivityHubComponent],
      providers: [
        provideRouter([]),
        {
          provide: AppNotificationService,
          useValue: {
            currentUserUnreadCount$: of(9),
            currentUserNotifications$: of([
              {
                id: 'notification-room-1',
                userId: 'user-1',
                type: 'social',
                title: 'Convite para sala',
                body: 'Uma nova sala está disponível.',
                route: '/chat/rooms/room-1',
                readAt: null,
                createdAt: 1,
                updatedAt: 1,
              },
              {
                id: 'notification-place-1',
                userId: 'user-1',
                type: 'social',
                title: 'Novidade em um Local',
                body: 'Confira a atualização.',
                route: '/dashboard/locais/local-1',
                readAt: null,
                createdAt: 2,
                updatedAt: 2,
              },
              {
                id: 'notification-community-reply-1',
                userId: 'user-1',
                type: 'community.comment.reply.received',
                title: 'Nova resposta',
                body: 'Seu comentário recebeu novas respostas.',
                route: null,
                activityCount: 3,
                readAt: null,
                createdAt: 4,
                updatedAt: 4,
              },
              {
                id: 'notification-connection-1',
                userId: 'user-1',
                type: 'social',
                title: 'Solicitação de conexão',
                body: 'Uma pessoa quer se conectar.',
                route: '/friends/requests',
                readAt: null,
                createdAt: 3,
                updatedAt: 3,
              },
              {
                id: 'notification-system-1',
                userId: 'user-1',
                type: 'system',
                title: 'Atualização da plataforma',
                body: 'Há uma novidade disponível.',
                route: '/notificacoes',
                readAt: null,
                createdAt: 5,
                updatedAt: 5,
              },
            ]),
          },
        },
        {
          provide: CommunityNotificationUnreadSummaryService,
          useValue: {
            currentUserUnreadCount$: of(7),
          },
        },
      ],
    });

    const fixture = TestBed.createComponent(UserActivityHubComponent);
    fixture.detectChanges();

    const nav = fixture.nativeElement.querySelector(
      '.activity-bar'
    ) as HTMLElement | null;
    const links = Array.from(
      fixture.nativeElement.querySelectorAll('a') as NodeListOf<HTMLAnchorElement>
    );
    const listItems = Array.from(
      fixture.nativeElement.querySelectorAll('.activity-bar__entry') as NodeListOf<HTMLLIElement>
    );
    const labels = Array.from(
      fixture.nativeElement.querySelectorAll('.activity-bar__label') as NodeListOf<HTMLElement>
    ).map((element) => element.textContent?.trim());
    const connectionLink = links.find((link) =>
      link.textContent?.includes('Conexões')
    );
    const roomLink = links.find((link) =>
      link.textContent?.includes('Salas')
    );
    const communitiesLink = links.find((link) =>
      link.textContent?.includes('Comunidades')
    );
    const momentsLink = links.find((link) =>
      link.textContent?.includes('Momentos')
    );
    const centralLink = links.find((link) =>
      link.textContent?.includes('Central')
    );

    expect(labels).toEqual([
      'Mensagens',
      'Conexões',
      'Salas',
      'Comunidades',
      'Momentos',
      'Central',
    ]);
    expect(labels).not.toContain('Status');
    expect(labels).not.toContain('Locais');
    expect(nav?.hasAttribute('aria-live')).toBe(false);
    expect(listItems).toHaveLength(links.length);
    expect(links.every((link) => !link.hasAttribute('role'))).toBe(true);
    expect(connectionLink?.getAttribute('href')).toBe('/friends/requests');
    expect(roomLink?.getAttribute('href')).toBe('/chat/room-invites');
    expect(communitiesLink?.getAttribute('href')).toBe('/dashboard/comunidades/minhas');
    expect(momentsLink?.getAttribute('href')).toBe('/descobrir');
    expect(
      communitiesLink?.querySelector('.activity-bar__badge')?.textContent?.trim()
    ).toBe('7');
    expect(communitiesLink?.getAttribute('aria-label')).toContain('7 pendências.');
    expect(
      centralLink?.querySelector('.activity-bar__badge')?.textContent?.trim()
    ).toBe('9');
  });

  it('não duplica uma notificação genérica que pertence somente à Central', () => {
    TestBed.configureTestingModule({
      imports: [UserActivityHubComponent],
      providers: [
        provideRouter([]),
        {
          provide: AppNotificationService,
          useValue: {
            currentUserUnreadCount$: of(1),
            currentUserNotifications$: of([
              {
                id: 'notification-system-only',
                userId: 'user-1',
                type: 'system',
                title: 'Aviso',
                body: 'Atualização geral.',
                route: '/notificacoes',
                readAt: null,
                createdAt: 1,
                updatedAt: 1,
              },
            ]),
          },
        },
        {
          provide: CommunityNotificationUnreadSummaryService,
          useValue: {
            currentUserUnreadCount$: of(0),
          },
        },
      ],
    });

    const fixture = TestBed.createComponent(UserActivityHubComponent);
    fixture.detectChanges();

    const links = Array.from(
      fixture.nativeElement.querySelectorAll('a') as NodeListOf<HTMLAnchorElement>
    );
    const centralLink = links.find((link) =>
      link.textContent?.includes('Central')
    );

    expect(
      centralLink?.querySelector('.activity-bar__badge')?.textContent?.trim()
    ).toBe('1');
    expect(centralLink?.getAttribute('aria-label')).toContain('1 pendência.');
  });
});
