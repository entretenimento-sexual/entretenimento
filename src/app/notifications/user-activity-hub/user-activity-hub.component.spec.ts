import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { AppNotificationService } from 'src/app/core/services/notifications/app-notification.service';
import { UserActivityHubComponent } from './user-activity-hub.component';

describe('UserActivityHubComponent', () => {
  it('mantém pendências globais sem misturar Conexões com convites de Sala', () => {
    TestBed.configureTestingModule({
      imports: [UserActivityHubComponent],
      providers: [
        provideRouter([]),
        {
          provide: AppNotificationService,
          useValue: {
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
            ]),
          },
        },
      ],
    });

    const fixture = TestBed.createComponent(UserActivityHubComponent);
    fixture.detectChanges();

    const labels = Array.from(
      fixture.nativeElement.querySelectorAll('.activity-bar__label') as NodeListOf<HTMLElement>
    ).map((element) => element.textContent?.trim());
    const connectionLink = Array.from(
      fixture.nativeElement.querySelectorAll('a') as NodeListOf<HTMLAnchorElement>
    ).find((link) => link.textContent?.includes('Conexões'));

    expect(labels).toEqual(['Mensagens', 'Conexões', 'Status', 'Central']);
    expect(labels).not.toContain('Locais');
    expect(labels).not.toContain('Salas');
    expect(connectionLink?.getAttribute('href')).toBe('/friends/requests');
    expect(fixture.nativeElement.textContent).toContain('3');
  });
});
