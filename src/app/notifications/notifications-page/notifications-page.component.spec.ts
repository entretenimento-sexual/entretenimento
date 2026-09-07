import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { AppNotificationService } from 'src/app/core/services/notifications/app-notification.service';
import { NotificationsPageComponent } from './notifications-page.component';

describe('NotificationsPageComponent', () => {
  const refreshCurrentUserNotifications = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function configure(readState: 'loading' | 'ready' | 'error'): void {
    TestBed.configureTestingModule({
      imports: [NotificationsPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: AppNotificationService,
          useValue: {
            currentUserVm$: of({
              loading: false,
              items: [],
              unreadCount: 0,
            }),
            currentUserReadState$: of(readState),
            currentUserCommunitySummaries$: of([]),
            currentUserCommunityUnreadCount$: of(0),
            refreshCurrentUserNotifications,
            markAsRead$: vi.fn(),
            markAllAsRead$: vi.fn(),
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
});
