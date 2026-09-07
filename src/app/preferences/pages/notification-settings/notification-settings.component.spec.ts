import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_NOTIFICATION_PREFERENCES } from 'src/app/core/interfaces/notification-preferences.interface';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { NotificationPreferencesService } from 'src/app/core/services/notifications/notification-preferences.service';
import { PushNotificationDeviceService } from 'src/app/core/services/notifications/push-notification-device.service';
import { NotificationSettingsComponent } from './notification-settings.component';

describe('NotificationSettingsComponent', () => {
  const refreshCurrentPreferences = vi.fn();
  const updateCurrentPreferences$ = vi.fn(() => of(undefined));
  const activatePush$ = vi.fn(() => of('active' as const));
  const deactivatePush$ = vi.fn(() => of('inactive' as const));
  const refreshPush$ = vi.fn(() => of('inactive' as const));

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function configure(readState: 'loading' | 'ready' | 'error' = 'ready'): void {
    TestBed.configureTestingModule({
      imports: [NotificationSettingsComponent],
      providers: [
        provideRouter([]),
        {
          provide: NotificationPreferencesService,
          useValue: {
            currentVm$: of({
              loading: false,
              preferences: DEFAULT_NOTIFICATION_PREFERENCES,
            }),
            currentReadState$: of(readState),
            refreshCurrentPreferences,
            updateCurrentPreferences$,
          },
        },
        {
          provide: PushNotificationDeviceService,
          useValue: {
            vm$: of({
              state: 'inactive',
              busy: false,
            }),
            activate$: activatePush$,
            deactivate$: deactivatePush$,
            refresh$: refreshPush$,
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showSuccess: vi.fn(),
            showError: vi.fn(),
            showInfo: vi.fn(),
            showWarning: vi.fn(),
          },
        },
      ],
    });
  }

  it('expõe Comunidades como preferência opcional sem desligar moderação essencial', () => {
    configure();

    const fixture = TestBed.createComponent(NotificationSettingsComponent);
    fixture.detectChanges();

    const cards = Array.from(
      fixture.nativeElement.querySelectorAll('.notification-option') as NodeListOf<HTMLElement>
    );
    const communityCard = cards.find((card) =>
      card.textContent?.includes('Comunidades')
    );
    const checkbox = communityCard?.querySelector('input') as HTMLInputElement;

    expect(communityCard?.textContent).toContain('Avisos essenciais de moderação');
    expect(checkbox.checked).toBe(true);
    expect(checkbox.disabled).toBe(false);

    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(updateCurrentPreferences$).toHaveBeenCalledWith({
      communities: false,
    });
  });

  it('não apresenta valores padrão como preferências carregadas quando a leitura falha', () => {
    configure('error');

    const fixture = TestBed.createComponent(NotificationSettingsComponent);
    fixture.detectChanges();

    const errorState = fixture.nativeElement.querySelector(
      '.notification-settings-state--error'
    ) as HTMLElement | null;
    const retryButton = fixture.nativeElement.querySelector(
      '.notification-settings-state__retry'
    ) as HTMLButtonElement | null;

    expect(errorState).not.toBeNull();
    expect(errorState?.getAttribute('role')).toBe('alert');
    expect(errorState?.textContent).toContain(
      'Não foi possível carregar suas preferências.'
    );
    expect(fixture.nativeElement.querySelectorAll('.notification-option').length).toBe(0);
    expect(retryButton).not.toBeNull();

    retryButton?.click();

    expect(refreshCurrentPreferences).toHaveBeenCalledTimes(1);
  });

  it('oferece opt-in explícito para Web Push sem misturar com preferências por tipo', () => {
    configure();

    const fixture = TestBed.createComponent(NotificationSettingsComponent);
    fixture.detectChanges();

    const card = fixture.nativeElement.querySelector(
      '.push-device-card'
    ) as HTMLElement | null;
    const button = card?.querySelector(
      '.push-device-card__action'
    ) as HTMLButtonElement | null;

    expect(card?.textContent).toContain('Notificações no navegador');
    expect(card?.textContent).toContain('identificador aleatório');
    expect(button?.textContent).toContain('Ativar neste dispositivo');

    button?.click();

    expect(activatePush$).toHaveBeenCalledTimes(1);
    expect(updateCurrentPreferences$).not.toHaveBeenCalled();
  });
});
