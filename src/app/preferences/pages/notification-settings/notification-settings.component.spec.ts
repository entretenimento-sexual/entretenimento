import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_NOTIFICATION_PREFERENCES } from 'src/app/core/interfaces/notification-preferences.interface';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { NotificationPreferencesService } from 'src/app/core/services/notifications/notification-preferences.service';
import { NotificationSettingsComponent } from './notification-settings.component';

describe('NotificationSettingsComponent', () => {
  it('expõe Comunidades como preferência opcional sem desligar moderação essencial', () => {
    const updateCurrentPreferences$ = vi.fn(() => of(undefined));

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
            updateCurrentPreferences$,
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showSuccess: vi.fn(),
            showError: vi.fn(),
          },
        },
      ],
    });

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
});
