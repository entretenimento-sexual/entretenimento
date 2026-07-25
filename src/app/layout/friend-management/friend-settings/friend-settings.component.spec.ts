import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { FriendSettingsComponent } from './friend-settings.component';
import { AuthSessionService } from '../../../core/services/autentication/auth/auth-session.service';
import { CacheService } from '../../../core/services/general/cache/cache.service';
import { ErrorNotificationService } from '../../../core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../../../core/services/error-handler/global-error-handler.service';

describe('FriendSettingsComponent', () => {
  let component: FriendSettingsComponent;
  let fixture: ComponentFixture<FriendSettingsComponent>;

  const cacheGet = vi.fn(() => of(null));
  const cacheSet = vi.fn();
  const showSuccess = vi.fn();
  const showError = vi.fn();
  const handleError = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();

    await TestBed.configureTestingModule({
      imports: [FriendSettingsComponent],
      providers: [
        provideMockStore({ initialState: {} }),
        {
          provide: AuthSessionService,
          useValue: {
            readyUid$: of('user-123'),
          },
        },
        {
          provide: CacheService,
          useValue: {
            get: cacheGet,
            set: cacheSet,
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showSuccess,
            showError,
          },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: {
            handleError,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FriendSettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('loads settings from a cache key scoped by the authenticated UID', () => {
    expect(cacheGet).toHaveBeenCalledWith('friendSettings:user-123');
    expect(cacheGet).not.toHaveBeenCalledWith('friendSettings');
  });

  it('stores settings under the authenticated UID without persisting loading state', () => {
    const settings = {
      receiveRequests: false,
      showOnlineStatus: true,
      allowSearchByNickname: false,
    };

    component.settingsForm.setValue(settings);
    component.saveSettings();

    expect(cacheSet).toHaveBeenCalledWith(
      'friendSettings:user-123',
      settings,
      600_000,
      { persist: true }
    );
    expect(cacheSet).not.toHaveBeenCalledWith(
      'loadingSettings',
      expect.anything(),
      expect.anything()
    );
    expect(showSuccess).toHaveBeenCalledWith(
      'Configurações de amizade atualizadas com sucesso!'
    );
  });
});
