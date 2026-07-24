// src/app/core/services/data-handling/firestore-query.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';

import { Firestore } from '@angular/fire/firestore';
import { FirestoreQueryService } from './firestore-query.service';

import { AppCacheService } from '../general/cache/app-cache.service';
import { CurrentUserStoreService } from '../autentication/auth/current-user-store.service';
import { FirestoreReadService } from './firestore/core/firestore-read.service';
import { FirestoreContextService } from './firestore/core/firestore-context.service';
import { UserPresenceQueryService } from './queries/user-presence.query.service';

import { IUserDados } from '../../interfaces/iuser-dados';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createStoreTestingMock,
  provideStoreTestingMock,
} from '../../../../test/ngrx-store-testing.providers';

class MockFirestoreReadService {
  getDocument = vi.fn().mockReturnValue(of(null));
  getDocumentsOnce = vi.fn().mockReturnValue(of([]));
  getDocumentsLiveSafe = vi.fn().mockReturnValue(of([]));
}

class MockAppCacheService {
  get$ = vi.fn().mockReturnValue(of({ status: 'miss' }));
  set$ = vi.fn().mockReturnValue(of(void 0));
}

class MockUserPresenceQueryService {
  getOnlineUsers$ = vi.fn().mockReturnValue(of([]));
  getOnlineUsersOnce$ = vi.fn().mockReturnValue(of([]));
  getOnlineUsersByRegion$ = vi.fn().mockReturnValue(of([]));
  getRecentlyOnline$ = vi.fn().mockReturnValue(of([]));
}

class MockFirestoreContextService {
  deferObservable$ = vi.fn((task: () => unknown) =>
    TestBed.runInInjectionContext(task as () => any)
  );
}

describe('FirestoreQueryService', () => {
  let service: FirestoreQueryService;
  let mockRead: MockFirestoreReadService;
  let mockCache: MockAppCacheService;
  let mockPresence: MockUserPresenceQueryService;

  const firestoreMock = {} as unknown as Firestore;

  beforeEach(() => {
    const storeMock = createStoreTestingMock({
      defaultSelectorValue: null,
    });

    TestBed.configureTestingModule({
      providers: [
        FirestoreQueryService,
        ...provideStoreTestingMock(storeMock),
        { provide: Firestore, useValue: firestoreMock },
        { provide: AppCacheService, useClass: MockAppCacheService },
        {
          provide: CurrentUserStoreService,
          useValue: {
            getLoggedUserUIDSnapshot: vi.fn(() => 'uid-viewer'),
          },
        },
        {
          provide: FirestoreReadService,
          useClass: MockFirestoreReadService,
        },
        {
          provide: FirestoreContextService,
          useClass: MockFirestoreContextService,
        },
        {
          provide: UserPresenceQueryService,
          useClass: MockUserPresenceQueryService,
        },
      ],
    });

    service = TestBed.inject(FirestoreQueryService);
    mockRead = TestBed.inject(
      FirestoreReadService
    ) as unknown as MockFirestoreReadService;
    mockCache = TestBed.inject(
      AppCacheService
    ) as unknown as MockAppCacheService;
    mockPresence = TestBed.inject(
      UserPresenceQueryService
    ) as unknown as MockUserPresenceQueryService;

    vi.clearAllMocks();
  });

  it('deve ser criado', () => {
    expect(service).toBeTruthy();
  });

  it('getFirestoreInstance retorna a instância injetada', () => {
    expect(service.getFirestoreInstance()).toBe(firestoreMock);
  });

  it('getDocumentById delega para FirestoreReadService.getDocument', async () => {
    const obj = { uid: '123' } as unknown as IUserDados;
    mockRead.getDocument.mockReturnValueOnce(of(obj));

    const result = await firstValueFrom(
      service.getDocumentById<IUserDados>('users', '123')
    );

    expect(mockRead.getDocument).toHaveBeenCalledWith('users', '123');
    expect(result).toEqual(obj);
  });

  it('getDocumentsByQuery mantém a assinatura compatível', async () => {
    const users = [{ uid: '1' }] as unknown as IUserDados[];
    mockRead.getDocumentsOnce.mockReturnValueOnce(of(users));

    const result = await firstValueFrom(
      service.getDocumentsByQuery<IUserDados>('users', [])
    );

    expect(mockRead.getDocumentsOnce).toHaveBeenCalledWith(
      'users',
      [],
      { useCache: true, cacheTTL: 300_000 }
    );
    expect(result).toEqual(users);
  });

  describe('getAllUsers', () => {
    it('usa cache privado em memória quando houver valor fresh', async () => {
      const cached = [{ uid: 'c1' }] as unknown as IUserDados[];
      mockCache.get$.mockReturnValueOnce(
        of({ status: 'fresh', value: cached })
      );

      const result = await firstValueFrom(service.getAllUsers());

      expect(result).toEqual(cached);
      expect(mockRead.getDocumentsOnce).not.toHaveBeenCalled();
      expect(mockCache.set$).not.toHaveBeenCalled();
      expect(mockCache.get$).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'all-users',
          scope: 'user',
          ownerUid: 'uid-viewer',
          sensitivity: 'private',
          storage: 'memory',
        })
      );
    });

    it('busca e preenche cache memory-only quando houver miss', async () => {
      const users = [
        { uid: 'u1' },
        { uid: 'u2' },
      ] as unknown as IUserDados[];
      mockCache.get$.mockReturnValueOnce(of({ status: 'miss' }));
      mockRead.getDocumentsOnce.mockReturnValueOnce(of(users));

      const result = await firstValueFrom(service.getAllUsers());

      expect(result).toEqual(users);
      expect(mockRead.getDocumentsOnce).toHaveBeenCalledWith(
        'users',
        [],
        { idField: 'uid', requireAuth: true }
      );
      expect(mockCache.set$).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerUid: 'uid-viewer',
          storage: 'memory',
        }),
        users
      );
    });
  });

  describe('presença por delegação', () => {
    it('getOnlineUsers$ delega para UserPresenceQueryService', async () => {
      const users = [
        { uid: 'o1', isOnline: true },
      ] as unknown as IUserDados[];
      mockPresence.getOnlineUsers$.mockReturnValueOnce(of(users));

      expect(await firstValueFrom(service.getOnlineUsers$())).toEqual(users);
      expect(mockPresence.getOnlineUsers$).toHaveBeenCalled();
    });

    it('getOnlineUsers delega para leitura once', async () => {
      const users = [
        { uid: 'o1', isOnline: true },
      ] as unknown as IUserDados[];
      mockPresence.getOnlineUsersOnce$.mockReturnValueOnce(of(users));

      expect(await firstValueFrom(service.getOnlineUsers())).toEqual(users);
      expect(mockPresence.getOnlineUsersOnce$).toHaveBeenCalled();
    });

    it('getOnlineUsersByRegion delega por município', async () => {
      const users = [
        { uid: 'r1', municipio: 'Rio', isOnline: true },
      ] as unknown as IUserDados[];
      mockPresence.getOnlineUsersByRegion$.mockReturnValueOnce(of(users));

      expect(
        await firstValueFrom(service.getOnlineUsersByRegion('Rio'))
      ).toEqual(users);
      expect(
        mockPresence.getOnlineUsersByRegion$
      ).toHaveBeenCalledWith('Rio');
    });

    it('getRecentlyOnline$ delega a janela recebida', async () => {
      const users = [{ uid: 'x1' }] as unknown as IUserDados[];
      mockPresence.getRecentlyOnline$.mockReturnValueOnce(of(users));

      expect(
        await firstValueFrom(service.getRecentlyOnline$(45_000))
      ).toEqual(users);
      expect(mockPresence.getRecentlyOnline$).toHaveBeenCalledWith(
        45_000
      );
    });
  });

  describe('wrappers compat', () => {
    it('getUsersByMunicipio aplica uma constraint', async () => {
      const users = [
        { uid: 'm1', municipio: 'Rio' },
      ] as unknown as IUserDados[];
      mockRead.getDocumentsOnce.mockReturnValueOnce(of(users));

      expect(
        await firstValueFrom(service.getUsersByMunicipio('Rio'))
      ).toEqual(users);

      const last = mockRead.getDocumentsOnce.mock.calls.at(-1)!;
      expect(last[0]).toBe('users');
      expect(Array.isArray(last[1])).toBe(true);
      expect((last[1] as any[]).length).toBe(1);
    });

    it('getOnlineUsersByMunicipio delega para região', async () => {
      const users = [
        { uid: '1', municipio: 'Rio', isOnline: true },
      ] as unknown as IUserDados[];
      mockPresence.getOnlineUsersByRegion$.mockReturnValueOnce(of(users));

      expect(
        await firstValueFrom(service.getOnlineUsersByMunicipio('Rio'))
      ).toEqual(users);
      expect(
        mockPresence.getOnlineUsersByRegion$
      ).toHaveBeenCalledWith('Rio');
    });

    it('getSuggestedProfiles usa leitura live autenticada', async () => {
      const users = [{ uid: 's1' }] as unknown as IUserDados[];
      mockRead.getDocumentsLiveSafe.mockReturnValueOnce(of(users));

      expect(
        await firstValueFrom(service.getSuggestedProfiles())
      ).toEqual(users);

      const last = mockRead.getDocumentsLiveSafe.mock.calls.at(-1)!;
      expect(last[0]).toBe('public_profiles');
      expect(Array.isArray(last[1])).toBe(true);
      expect((last[1] as any[]).length).toBe(1);
      expect(last[2]).toEqual({
        idField: 'uid',
        requireAuth: true,
      });
    });
  });

  it('getProfilesByOrientationAndLocation envia 3 constraints', async () => {
    const users = [{ uid: 'p1' }] as unknown as IUserDados[];
    mockRead.getDocumentsOnce.mockReturnValueOnce(of(users));

    expect(
      await firstValueFrom(
        service.getProfilesByOrientationAndLocation(
          'M',
          'hetero',
          'Rio'
        )
      )
    ).toEqual(users);

    const last = mockRead.getDocumentsOnce.mock.calls.at(-1)!;
    expect((last[1] as any[]).length).toBe(3);
  });

  it('getUserFromState retorna null quando selector não tem usuário', async () => {
    expect(
      await firstValueFrom(service.getUserFromState('uX'))
    ).toBeNull();
  });

  it('searchUsers mantém a delegação compatível', async () => {
    const constraints: any[] = [{}, {}];
    const users = [{ uid: 'z1' }] as unknown as IUserDados[];
    mockRead.getDocumentsOnce.mockReturnValueOnce(of(users));

    expect(
      await firstValueFrom(service.searchUsers(constraints as any))
    ).toEqual(users);
    expect(mockRead.getDocumentsOnce).toHaveBeenCalledWith(
      'users',
      constraints as any,
      { useCache: true, cacheTTL: 300_000 }
    );
  });
});
