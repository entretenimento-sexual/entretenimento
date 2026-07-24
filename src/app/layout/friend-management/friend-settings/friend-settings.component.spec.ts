import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FriendSettingsComponent } from './friend-settings.component';
import { ErrorNotificationService } from '../../../core/services/error-handler/error-notification.service';
import { updateFriendSettings } from '../../../store/actions/actions.interactions/actions.friends';
import { initialState as friendsInitialState } from '../../../store/states/states.interactions/friends.state';

describe('FriendSettingsComponent', () => {
  let component: FriendSettingsComponent;
  let fixture: ComponentFixture<FriendSettingsComponent>;
  let store: MockStore;
  let notifier: {
    showSuccess: ReturnType<typeof vi.fn>;
    showError: ReturnType<typeof vi.fn>;
  };

  const initialSettings = {
    receiveRequests: false,
    showOnlineStatus: true,
    allowSearchByNickname: false,
  };

  beforeEach(async () => {
    notifier = {
      showSuccess: vi.fn(),
      showError: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [FriendSettingsComponent],
      providers: [
        provideMockStore({
          initialState: {
            interactions_friends: {
              ...friendsInitialState,
              settings: initialSettings,
            },
          },
        }),
        {
          provide: ErrorNotificationService,
          useValue: notifier,
        },
      ],
    }).compileComponents();

    store = TestBed.inject(MockStore);
    fixture = TestBed.createComponent(FriendSettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('hidrata o formulário a partir do Store, sem CacheService', () => {
    expect(component.settingsForm.getRawValue()).toEqual(initialSettings);
  });

  it('salva no Store sem loading artificial nem atraso', () => {
    const dispatchSpy = vi.spyOn(store, 'dispatch');
    const nextSettings = {
      receiveRequests: true,
      showOnlineStatus: false,
      allowSearchByNickname: true,
    };

    component.settingsForm.setValue(nextSettings);
    component.saveSettings();

    expect(dispatchSpy).toHaveBeenCalledWith(
      updateFriendSettings({ settings: nextSettings })
    );
    expect(notifier.showSuccess).toHaveBeenCalledWith(
      'Configurações de amizade aplicadas nesta sessão.'
    );
    expect(component.settingsForm.pristine).toBe(true);
  });
});
