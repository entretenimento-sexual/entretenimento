// src/app/preferences/application/preferences-editor.facade.spec.ts
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, firstValueFrom, of, take, toArray } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IUserDados } from '@core/interfaces/iuser-dados';
import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';

import { PreferencesEditorFacade } from './preferences-editor.facade';
import { IntentStateService } from '../services/intent-state.service';
import { PreferenceProfilePersistenceService } from '../services/preference-profile-persistence.service';
import { ProfilePreferencesService } from '../services/profile-preferences.service';
import {
  createEmptyIntentState,
  createEmptyPreferenceProfile,
} from '../utils/preference-normalizers';

describe('PreferencesEditorFacade', () => {
  const userSubject = new BehaviorSubject<IUserDados | null>(null);

  const profilePreferencesMock = {
    getProfile$: vi.fn((uid: string) => of(createEmptyPreferenceProfile(uid))),
  };

  const profilePersistenceMock = {
    saveProfileWithProjection$: vi.fn(() => of(void 0)),
    saveAllWithProjection$: vi.fn(() => of(void 0)),
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
          provide: PreferenceProfilePersistenceService,
          useValue: profilePersistenceMock,
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

  it('deriva o editor da sessão antes de iniciar leituras privadas', async () => {
    const statePromise = firstValueFrom(
      facade.currentEditorState$.pipe(take(1))
    );

    expect(profilePreferencesMock.getProfile$).not.toHaveBeenCalled();
    expect(intentStateMock.getIntentState$).not.toHaveBeenCalled();

    userSubject.next(freeUser('owner'));

    const state = await statePromise;

    expect(state.uid).toBe('owner');
    expect(profilePreferencesMock.getProfile$).toHaveBeenCalledWith('owner');
    expect(intentStateMock.getIntentState$).toHaveBeenCalledWith('owner');
    expect(globalErrorMock.handleError).not.toHaveBeenCalled();
  });

  it('não recria leituras privadas quando apenas a projeção do usuário muda', async () => {
    const statesPromise = firstValueFrom(
      facade.currentEditorState$.pipe(take(2), toArray())
    );

    userSubject.next(freeUser('owner'));
    userSubject.next({
      ...freeUser('owner'),
      nickname: 'Perfil atualizado',
      discoveryPreferencesUpdatedAt: 123,
    });

    const states = await statesPromise;

    expect(states).toHaveLength(2);
    expect(states[1]?.user?.nickname).toBe('Perfil atualizado');
    expect(profilePreferencesMock.getProfile$).toHaveBeenCalledTimes(1);
    expect(intentStateMock.getIntentState$).toHaveBeenCalledTimes(1);
  });

  it('mantém a API explícita estrita para UID diferente', async () => {
    const statePromise = firstValueFrom(
      facade.getEditorState$('other-user').pipe(take(1))
    );

    userSubject.next(freeUser('owner'));

    await expect(statePromise).rejects.toThrow(
      'O editor só pode acessar preferências do próprio usuário'
    );

    expect(profilePreferencesMock.getProfile$).not.toHaveBeenCalled();
    expect(intentStateMock.getIntentState$).not.toHaveBeenCalled();
    expect(globalErrorMock.handleError).toHaveBeenCalledTimes(1);
  });

  it('salva o perfil pelo writer atômico que também atualiza discovery', async () => {
    userSubject.next(freeUser('owner'));

    const profile = createEmptyPreferenceProfile('owner');
    profile.hardRules.acceptedGenders = ['women'];
    profile.hardRules.acceptsCouples = false;

    await firstValueFrom(
      facade.saveProfileOnly$('owner', profile).pipe(take(1))
    );

    expect(
      profilePersistenceMock.saveProfileWithProjection$
    ).toHaveBeenCalledTimes(1);
    expect(
      profilePersistenceMock.saveProfileWithProjection$
    ).toHaveBeenCalledWith(
      'owner',
      expect.objectContaining({
        userId: 'owner',
        hardRules: expect.objectContaining({
          acceptedGenders: ['women'],
          acceptsCouples: false,
        }),
      })
    );
  });
});

function freeUser(uid: string): IUserDados {
  return {
    uid,
    email: null,
    photoURL: null,
    role: 'free',
    tier: 'free',
    lastLogin: 0,
    descricao: '',
    isSubscriber: false,
  };
}
