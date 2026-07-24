import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IUserDados } from '@core/interfaces/iuser-dados';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { AppCacheService } from '@core/services/general/cache/app-cache.service';
import { PrivacyDebugLoggerService } from '@core/services/privacy/privacy-debug-logger.service';
import {
  addUserToState,
  updateUserInState,
} from 'src/app/store/actions/actions.user/user.actions';
import { sanitizeUserForStore } from 'src/app/store/utils/user-store.serializer';
import { UserStateCacheService } from './user-state-cache.service';

describe('UserStateCacheService', () => {
  let service: UserStateCacheService;
  let cache: {
    get$: ReturnType<typeof vi.fn>;
    peek: ReturnType<typeof vi.fn>;
    set$: ReturnType<typeof vi.fn>;
    invalidate$: ReturnType<typeof vi.fn>;
  };
  let store: {
    dispatch: ReturnType<typeof vi.fn>;
  };
  let globalError: {
    handleError: ReturnType<typeof vi.fn>;
  };

  const user = {
    uid: 'uid-1',
    email: 'private@example.com',
    nickname: 'alex',
    descricao: '',
    role: 'free',
    isSubscriber: false,
    lastLogin: 1_000,
  } as IUserDados;

  beforeEach(() => {
    cache = {
      get$: vi.fn().mockReturnValue(of({ status: 'miss' })),
      peek: vi.fn().mockReturnValue({ status: 'miss' }),
      set$: vi.fn().mockReturnValue(of(void 0)),
      invalidate$: vi.fn().mockReturnValue(of(void 0)),
    };
    store = {
      dispatch: vi.fn(),
    };
    globalError = {
      handleError: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        UserStateCacheService,
        { provide: AppCacheService, useValue: cache },
        { provide: Store, useValue: store },
        {
          provide: GlobalErrorHandlerService,
          useValue: globalError,
        },
        {
          provide: PrivacyDebugLoggerService,
          useValue: { log: vi.fn() },
        },
      ],
    });

    service = TestBed.inject(UserStateCacheService);
  });

  it('retorna undefined em miss com política user/restricted/memory', async () => {
    expect(
      await firstValueFrom(service.getCachedUser$(' uid-1 '))
    ).toBeUndefined();

    expect(cache.get$).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'profile-state',
        scope: 'user',
        ownerUid: 'uid-1',
        sensitivity: 'restricted',
        storage: 'memory',
        version: 1,
      })
    );
  });

  it('getCachedUserSnapshot usa apenas peek da memória', () => {
    cache.peek.mockReturnValueOnce({
      status: 'fresh',
      value: user,
    });

    expect(service.getCachedUserSnapshot('uid-1')).toEqual(user);
    expect(cache.peek).toHaveBeenCalledTimes(1);
    expect(cache.get$).not.toHaveBeenCalled();
  });

  it('upsertUser adiciona perfil novo ao Store e à memória tipada', () => {
    const safeUser = sanitizeUserForStore(user);

    service.upsertUser(user, 120_000);

    expect(store.dispatch).toHaveBeenCalledWith(
      addUserToState({ user: safeUser })
    );
    expect(cache.set$).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'profile-state',
        ownerUid: 'uid-1',
        sensitivity: 'restricted',
        storage: 'memory',
        ttlMs: 120_000,
      }),
      safeUser
    );
  });

  it('upsertUser não gera dispatch ou write redundante', () => {
    const safeUser = sanitizeUserForStore(user);
    cache.peek.mockReturnValueOnce({
      status: 'fresh',
      value: safeUser,
    });

    service.upsertUser({ ...user });

    expect(store.dispatch).not.toHaveBeenCalled();
    expect(cache.set$).not.toHaveBeenCalled();
  });

  it('upsertUser atualiza perfil existente quando houver mudança', () => {
    const current = sanitizeUserForStore(user);
    const updated = sanitizeUserForStore({
      ...user,
      nickname: 'alex-2',
    });
    cache.peek.mockReturnValueOnce({
      status: 'fresh',
      value: current,
    });

    service.upsertUser({ ...user, nickname: 'alex-2' });

    expect(store.dispatch).toHaveBeenCalledWith(
      updateUserInState({
        uid: 'uid-1',
        updatedData: updated,
      })
    );
    expect(cache.set$).toHaveBeenCalledWith(
      expect.objectContaining({ storage: 'memory' }),
      updated
    );
  });

  it('updateUserInStateAndCache mescla patch e preserva API void', () => {
    cache.peek.mockReturnValueOnce({
      status: 'fresh',
      value: user,
    });

    service.updateUserInStateAndCache('uid-1', {
      nickname: 'novo-nick',
    } as IUserDados);

    expect(store.dispatch).toHaveBeenCalledWith(
      updateUserInState({
        uid: 'uid-1',
        updatedData: expect.objectContaining({
          uid: 'uid-1',
          email: 'private@example.com',
          nickname: 'novo-nick',
        }) as IUserDados,
      })
    );
    expect(cache.set$).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUid: 'uid-1',
        sensitivity: 'restricted',
        storage: 'memory',
      }),
      expect.objectContaining({ nickname: 'novo-nick' })
    );
  });

  it('invalidate remove somente a definição do UID', () => {
    service.invalidate(' uid-1 ');

    expect(cache.invalidate$).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'profile-state',
        ownerUid: 'uid-1',
        storage: 'memory',
      })
    );
  });

  it('UID vazio é no-op e não cria chave inválida', async () => {
    expect(
      await firstValueFrom(service.getCachedUser$('   '))
    ).toBeUndefined();

    service.upsertUser({ ...user, uid: '' });
    service.invalidate('');

    expect(cache.get$).not.toHaveBeenCalled();
    expect(cache.peek).not.toHaveBeenCalled();
    expect(cache.set$).not.toHaveBeenCalled();
    expect(cache.invalidate$).not.toHaveBeenCalled();
    expect(store.dispatch).not.toHaveBeenCalled();
  });
});
