// src/app/preferences/application/preferences-editor.facade.spec.ts
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, firstValueFrom, of, take } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IUserDados } from '@core/interfaces/iuser-dados';
import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';

import { PreferencesEditorFacade } from './preferences-editor.facade';
import { IntentStateService } from '../services/intent-state.service';
import { ProfilePreferencesService } from '../services/profile-preferences.service';
import { createEmptyIntentState, createEmptyPreferenceProfile } from '../utils/preference-normalizers';

describe('PreferencesEditorFacade', () => {
  const userSubject = new BehaviorSubject<IUserDados | null>(null);

  const profilePreferencesMock = {
    getProfile$: vi.fn((uid: string) => of(createEmptyPreferenceProfile(uid))),
    saveProfile$: vi.fn(() => of(void 0)),
  };

  const intentStateMock = {
    getIntentState$: vi.fn((uid: string) => of(createEmptyIntentState(uid))),
    saveIntentState$: vi.fn(() => of(void 0)),
  };

  const globalErrorMock = {
    handleError: vi.fn(),
  };

  const notifierMock = {
    showError: vi.fn(),
    showSuccess: vi.fn(),
  };

  let facade: PreferencesEditorFacade;

  beforeEach(() => {
    vi.clearAllMocks();
    userSubject.next(null);

    TestBed.configureTestingModule({
      providers: [
        PreferencesEditorFacade,
        {
          provide: CurrentUserStoreService,
          useValue: { user$: userSubject.asObservable() },
        },
        {
          provide: ProfilePreferencesService,
          useValue: profilePreferencesMock,
        },
        {
          provide: IntentStateService,
          useValue: intentStateMock,
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: globalErrorMock,
        },
        {
          provide: ErrorNotificationService,
          useValue: notifierMock,
        },
      ],
    });

    facade = TestBed.inject(PreferencesEditorFacade);
  });

  it('aguarda o proprietário antes de iniciar leituras privadas', async () => {
    const statePromise = firstValueFrom(
      facade.getEditorState$('owner').pipe(take(1))
    );

    expect(profilePreferencesMock.getProfile$).not.toHaveBeenCalled();
    expect(intentStateMock.getIntentState$).not.toHaveBeenCalled();

    userSubject.next({
      uid: 'owner',
      role: 'free',
      tier: 'free',
      isSubscriber: false,
    } as IUserDados);

    const state = await statePromise;

    expect(state.uid).toBe('owner');
    expect(profilePreferencesMock.getProfile$).toHaveBeenCalledWith('owner');
    expect(intentStateMock.getIntentState$).toHaveBeenCalledWith('owner');
  });

  it('rejeita UID diferente antes de acessar o Firestore', async () => {
    const statePromise = firstValueFrom(
      facade.getEditorState$('other-user').pipe(take(1))
    );

    userSubject.next({
      uid: 'owner',
      role: 'free',
      tier: 'free',
      isSubscriber: false,
    } as IUserDados);

    await expect(statePromise).rejects.toThrow(
      'O editor só pode acessar preferências do próprio usuário'
    );

    expect(profilePreferencesMock.getProfile$).not.toHaveBeenCalled();
    expect(intentStateMock.getIntentState$).not.toHaveBeenCalled();
    expect(globalErrorMock.handleError).toHaveBeenCalledTimes(1);
  });
});
