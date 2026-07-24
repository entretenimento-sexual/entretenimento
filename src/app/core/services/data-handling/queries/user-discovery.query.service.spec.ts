import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { where } from 'firebase/firestore';

import { IUserDados } from '@core/interfaces/iuser-dados';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { FirestoreErrorHandlerService } from '@core/services/error-handler/firestore-error-handler.service';
import { AppCacheService } from '@core/services/general/cache/app-cache.service';
import { CacheDefinition } from '@core/services/general/cache/cache-contracts';
import { FirestoreReadService } from '../firestore/core/firestore-read.service';
import { UserDiscoveryQueryService } from './user-discovery.query.service';

type AppCacheMock = {
  get$: ReturnType<typeof vi.fn>;
  set$: ReturnType<typeof vi.fn>;
};

type ReadMock = {
  getDocumentsOnce: ReturnType<typeof vi.fn>;
};

describe('UserDiscoveryQueryService', () => {
  let service: UserDiscoveryQueryService;
  let cache: AppCacheMock;
  let read: ReadMock;
  let uidSubject: BehaviorSubject<string | null>;

  const profile = (uid: string): IUserDados =>
    ({
      uid,
      nickname: `perfil-${uid}`,
      gender: 'teste',
    }) as unknown as IUserDados;

  beforeEach(() => {
    uidSubject = new BehaviorSubject<string | null>('viewer-1');
    cache = {
      get$: vi.fn().mockReturnValue(of({ status: 'miss' })),
      set$: vi.fn().mockReturnValue(of(void 0)),
    };
    read = {
      getDocumentsOnce: vi.fn().mockReturnValue(of([])),
    };

    TestBed.configureTestingModule({
      providers: [
        UserDiscoveryQueryService,
        { provide: AppCacheService, useValue: cache },
        { provide: FirestoreReadService, useValue: read },
        {
          provide: FirestoreErrorHandlerService,
          useValue: {
            handleFirestoreErrorAndReturn: vi.fn(
              (_error: unknown, fallback: unknown) => of(fallback)
            ),
          },
        },
        {
          provide: AuthSessionService,
          useValue: { uid$: uidSubject.asObservable() },
        },
      ],
    });

    service = TestBed.inject(UserDiscoveryQueryService);
    vi.clearAllMocks();
  });

  it('usa cache user/private/memory para consulta semântica conhecida', async () => {
    await firstValueFrom(service.getUsersByGender$('Mulher'));

    expect(cache.get$).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'discovery:gender:["mulher"]',
        scope: 'user',
        ownerUid: 'viewer-1',
        sensitivity: 'private',
        storage: 'memory',
      })
    );
  });

  it('inclui valores dos filtros na identidade e evita colisão', async () => {
    await firstValueFrom(service.getUsersByGender$('Mulher'));
    await firstValueFrom(service.getUsersByGender$('Homem'));

    const definitions = cache.get$.mock.calls.map(
      ([definition]) => definition as CacheDefinition<IUserDados[]>
    );

    expect(definitions[0]?.key).toBe('discovery:gender:["mulher"]');
    expect(definitions[1]?.key).toBe('discovery:gender:["homem"]');
    expect(definitions[0]?.key).not.toBe(definitions[1]?.key);
  });

  it('não cria fingerprint inseguro para QueryConstraint arbitrária', async () => {
    await firstValueFrom(
      service.searchUsers([where('gender', '==', 'Mulher')])
    );

    expect(cache.get$).not.toHaveBeenCalled();
    expect(cache.set$).not.toHaveBeenCalled();
    expect(read.getDocumentsOnce).toHaveBeenCalledTimes(1);
  });

  it('trata lista vazia fresh como hit válido', async () => {
    cache.get$.mockReturnValueOnce(
      of({ status: 'fresh', value: [] as IUserDados[] })
    );

    const result = await firstValueFrom(service.getAllUsers$());

    expect(result).toEqual([]);
    expect(read.getDocumentsOnce).not.toHaveBeenCalled();
    expect(cache.set$).not.toHaveBeenCalled();
  });

  it('preenche cache somente em memória após miss', async () => {
    read.getDocumentsOnce.mockReturnValueOnce(
      of([{ uid: 'u1', nickname: 'Perfil', gender: 'teste' }])
    );

    const result = await firstValueFrom(service.getUsersByGender$('teste'));

    expect(result.map((item) => item.uid)).toEqual(['u1']);
    expect(cache.set$).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUid: 'viewer-1',
        storage: 'memory',
        sensitivity: 'private',
      }),
      expect.arrayContaining([
        expect.objectContaining({ uid: 'u1' }),
      ])
    );
  });

  it('preserva a ordem solicitada ao usar cache por UIDs', async () => {
    const cachedSorted = [profile('a'), profile('b')];

    cache.get$.mockImplementation(
      (definition: CacheDefinition<IUserDados[]>) => {
        if (definition.key === 'discovery:all') {
          return of({ status: 'miss' });
        }

        return of({ status: 'fresh', value: cachedSorted });
      }
    );

    const result = await firstValueFrom(
      service.getProfilesByUids$(['b', 'a', 'b'])
    );

    expect(result.map((item) => item.uid)).toEqual(['b', 'a']);
    expect(read.getDocumentsOnce).not.toHaveBeenCalled();
  });

  it('não lê nem escreve cache sem sessão autenticada', async () => {
    uidSubject.next(null);

    const result = await firstValueFrom(service.getAllUsers$());

    expect(result).toEqual([]);
    expect(cache.get$).not.toHaveBeenCalled();
    expect(cache.set$).not.toHaveBeenCalled();
    expect(read.getDocumentsOnce).not.toHaveBeenCalled();
  });
});
