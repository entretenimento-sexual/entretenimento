import { TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import type { User } from 'firebase/auth';
import { BehaviorSubject, firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IUserSocialLinks } from '../../interfaces/interfaces-user-dados/iuser-social-links';
import { AuthSessionService } from '../autentication/auth/auth-session.service';
import { FirestoreContextService } from '../data-handling/firestore/core/firestore-context.service';
import { ErrorNotificationService } from '../error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { AppCacheService } from '../general/cache/app-cache.service';
import { CacheDefinition } from '../general/cache/cache-contracts';
import { UserSocialLinksService } from './user-social-links.service';

type SocialLinksValue = IUserSocialLinks | null;

type AppCacheMock = {
  get$: ReturnType<typeof vi.fn>;
  set$: ReturnType<typeof vi.fn>;
  invalidate$: ReturnType<typeof vi.fn>;
};

describe('UserSocialLinksService cache policy', () => {
  let service: UserSocialLinksService;
  let cache: AppCacheMock;
  let readySubject: BehaviorSubject<boolean>;
  let authUserSubject: BehaviorSubject<User | null>;
  let globalError: { handleError: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    readySubject = new BehaviorSubject<boolean>(true);
    authUserSubject = new BehaviorSubject<User | null>(
      { uid: 'viewer-1' } as User
    );

    cache = {
      get$: vi.fn().mockReturnValue(
        of({
          status: 'fresh',
          value: { instagram: 'perfil-publico' } as IUserSocialLinks,
        })
      ),
      set$: vi.fn().mockReturnValue(of(void 0)),
      invalidate$: vi.fn().mockReturnValue(of(void 0)),
    };

    globalError = {
      handleError: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        UserSocialLinksService,
        { provide: Firestore, useValue: {} },
        {
          provide: FirestoreContextService,
          useValue: {
            deferPromise$: vi.fn(),
            deferObservable$: vi.fn(),
          },
        },
        { provide: AppCacheService, useValue: cache },
        {
          provide: AuthSessionService,
          useValue: {
            ready$: readySubject.asObservable(),
            authUser$: authUserSubject.asObservable(),
          },
        },
        { provide: GlobalErrorHandlerService, useValue: globalError },
        {
          provide: ErrorNotificationService,
          useValue: { showError: vi.fn() },
        },
      ],
    });

    service = TestBed.inject(UserSocialLinksService);
    vi.clearAllMocks();
  });

  it('usa cache restrito do dono para o documento privado', async () => {
    await firstValueFrom(service.getSocialLinks('viewer-1'));

    expect(cache.get$).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'social-links:private:viewer-1',
        scope: 'user',
        ownerUid: 'viewer-1',
        sensitivity: 'restricted',
        storage: 'memory',
      })
    );
  });

  it('usa cache público viewer-scoped ao consultar outro perfil', async () => {
    await firstValueFrom(service.getSocialLinks('profile-2'));

    expect(cache.get$).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'social-links:public:profile-2',
        scope: 'user',
        ownerUid: 'viewer-1',
        sensitivity: 'private',
        storage: 'memory',
      })
    );
  });

  it('usa session/public/memory para leitura anônima permitida', async () => {
    authUserSubject.next(null);

    await firstValueFrom(
      service.getSocialLinks('profile-2', { allowAnonymousRead: true })
    );

    expect(cache.get$).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'social-links:public:profile-2',
        scope: 'session',
        sensitivity: 'public',
        storage: 'memory',
      })
    );

    const definition = cache.get$.mock.calls[0]?.[0] as CacheDefinition<SocialLinksValue>;
    expect(definition.ownerUid).toBeUndefined();
  });

  it('ignora persistCache e mantém links exclusivamente em memória', async () => {
    await firstValueFrom(
      service.getSocialLinks('profile-2', { persistCache: true })
    );

    const definition = cache.get$.mock.calls[0]?.[0] as CacheDefinition<SocialLinksValue>;
    expect(definition.storage).toBe('memory');
  });

  it('não reutiliza a identidade privada como identidade pública', async () => {
    await firstValueFrom(service.getSocialLinks('viewer-1'));
    const privateDefinition = cache.get$.mock.calls[0]?.[0] as CacheDefinition<SocialLinksValue>;

    authUserSubject.next({ uid: 'viewer-2' } as User);
    await firstValueFrom(service.getSocialLinks('viewer-1'));
    const publicDefinition = cache.get$.mock.calls[1]?.[0] as CacheDefinition<SocialLinksValue>;

    expect(privateDefinition.key).toBe('social-links:private:viewer-1');
    expect(publicDefinition.key).toBe('social-links:public:viewer-1');
    expect(privateDefinition.key).not.toBe(publicDefinition.key);
    expect(privateDefinition.ownerUid).toBe('viewer-1');
    expect(publicDefinition.ownerUid).toBe('viewer-2');
  });

  it('não consulta cache privado ou público sem autenticação e sem permissão anônima', async () => {
    authUserSubject.next(null);

    const result = await firstValueFrom(service.getSocialLinks('profile-2'));

    expect(result).toBeNull();
    expect(cache.get$).not.toHaveBeenCalled();
    expect(globalError.handleError).toHaveBeenCalledTimes(1);
  });
});
