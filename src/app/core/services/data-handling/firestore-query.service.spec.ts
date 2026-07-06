// src/app/core/services/data-handling/firestore-query.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';

import { Firestore } from '@angular/fire/firestore';
import { FirestoreQueryService } from './firestore-query.service';

import { CacheService } from '../general/cache/cache.service';
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

class MockCacheService {
  get = vi.fn().mockReturnValue(of(undefined));
  set = vi.fn();
}

class MockUserPresenceQueryService {
  getOnlineUsers$ = vi.fn().mockReturnValue(of([]));
  getOnlineUsersOnce$ = vi.fn().mockReturnValue(of([]));
  getOnlineUsersByRegion$ = vi.fn().mockReturnValue(of([]));
  getRecentlyOnline$ = vi.fn().mockReturnValue(of([]));
}

class MockFirestoreContextService {
  deferObservable$ = vi.fn((task: () => unknown) => task());
}

describe('FirestoreQueryService', () => {
  let service: FirestoreQueryService;

  let mockRead: MockFirestoreReadService;
  let mockCache: MockCacheService;
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
        { provide: CacheService, useClass: MockCacheService },
        { provide: FirestoreReadService, useClass: MockFirestoreReadService },
        { provide: FirestoreContextService, useClass: MockFirestoreContextService },
        { provide: UserPresenceQueryService, useClass: MockUserPresenceQueryService },
      ],
    });

    service = TestBed.inject(FirestoreQueryService);

    mockRead = TestBed.inject(FirestoreReadService) as unknown as MockFirestoreReadService;
    mockCache = TestBed.inject(CacheService) as unknown as MockCacheService;
    mockPresence = TestBed.inject(UserPresenceQueryService) as unknown as MockUserPresenceQueryService;

    vi.clearAllMocks();
  });

  it('deve ser criado', () => {
    expect(service).toBeTruthy();
  });

  it('getFirestoreInstance retorna a instância injetada', () => {
    const instance = service.getFirestoreInstance();
    expect(instance).toBe(firestoreMock);
  });

  it('getDocumentById delega para FirestoreReadService.getDocument', async () => {
    const obj = { uid: '123' } as unknown as IUserDados;
    mockRead.getDocument.mockReturnValueOnce(of(obj));

    const res = await firstValueFrom(service.getDocumentById<IUserDados>('users', '123'));

    expect(mockRead.getDocument).toHaveBeenCalledWith('users', '123');
    expect(res).toEqual(obj);
  });

  it('getDocumentsByQuery delega para FirestoreReadService.getDocumentsOnce com cache', async () => {
    const result = [{ uid: '1' }] as unknown as IUserDados[];
    mockRead.getDocumentsOnce.mockReturnValueOnce(of(result));

    const res = await firstValueFrom(service.getDocumentsByQuery<IUserDados>('users', []));

    expect(mockRead.getDocumentsOnce).toHaveBeenCalledWith(
      'users',
      [],
      { useCache: true, cacheTTL: 300_000 }
    );
    expect(res).toEqual(result);
  });

  describe('getAllUsers', () => {
    it('usa cache quando houver', async () => {
      const cached = [{ uid: 'c1' }] as unknown as IUserDados[];
      mockCache.get.mockReturnValueOnce(of(cached));

      const res = await firstValueFrom(service.getAllUsers());

      expect(res).toEqual(cached);
      expect(mockRead.getDocumentsOnce).not.toHaveBeenCalled();
      expect(mockCache.set).not.toHaveBeenCalled();
    });

    it('busca e seta cache quando não houver', async () => {
      const users = [{ uid: 'u1' }, { uid: 'u2' }] as unknown as IUserDados[];
      mockCache.get.mockReturnValueOnce(of(undefined));
      mockRead.getDocumentsOnce.mockReturnValueOnce(of(users));

      const res = await firstValueFrom(service.getAllUsers());

      expect(res).toEqual(users);
      expect(mockRead.getDocumentsOnce).toHaveBeenCalledWith(
        'users',
        [],
        { useCache: true, cacheTTL: 300_000 }
      );
      expect(mockCache.set).toHaveBeenCalledWith('allUsers', users, 600_000);
    });
  });

  describe('presença por delegação', () => {
    it('getOnlineUsers$ delega para UserPresenceQueryService.getOnlineUsers$', async () => {
      const users = [{ uid: 'o1', isOnline: true }] as unknown as IUserDados[];
      mockPresence.getOnlineUsers$.mockReturnValueOnce(of(users));

      const res = await firstValueFrom(service.getOnlineUsers$());

      expect(mockPresence.getOnlineUsers$).toHaveBeenCalled();
      expect(res).toEqual(users);
    });

    it('getOnlineUsers delega para UserPresenceQueryService.getOnlineUsersOnce$', async () => {
      const users = [{ uid: 'o1', isOnline: true }] as unknown as IUserDados[];
      mockPresence.getOnlineUsersOnce$.mockReturnValueOnce(of(users));

      const res = await firstValueFrom(service.getOnlineUsers());

      expect(mockPresence.getOnlineUsersOnce$).toHaveBeenCalled();
      expect(res).toEqual(users);
    });

    it('getOnlineUsersByRegion delega para UserPresenceQueryService.getOnlineUsersByRegion$', async () => {
      const users = [{ uid: 'r1', municipio: 'Rio', isOnline: true }] as unknown as IUserDados[];
      mockPresence.getOnlineUsersByRegion$.mockReturnValueOnce(of(users));

      const res = await firstValueFrom(service.getOnlineUsersByRegion('Rio'));

      expect(mockPresence.getOnlineUsersByRegion$).toHaveBeenCalledWith('Rio');
      expect(res).toEqual(users);
    });

    it('getRecentlyOnline$ delega para UserPresenceQueryService.getRecentlyOnline$', async () => {
      const users = [{ uid: 'x1' }] as unknown as IUserDados[];
      mockPresence.getRecentlyOnline$.mockReturnValueOnce(of(users));

      const res = await firstValueFrom(service.getRecentlyOnline$(45_000));

      expect(mockPresence.getRecentlyOnline$).toHaveBeenCalledWith(45_000);
      expect(res).toEqual(users);
    });
  });

  describe('wrappers compat', () => {
    it('getUsersByMunicipio aplica where', async () => {
      const users = [{ uid: 'm1', municipio: 'Rio' }] as unknown as IUserDados[];
      mockRead.getDocumentsOnce.mockReturnValueOnce(of(users));

      const res = await firstValueFrom(service.getUsersByMunicipio('Rio'));

      expect(res).toEqual(users);
      const last = mockRead.getDocumentsOnce.mock.calls.at(-1)!;
      expect(last[0]).toBe('users');
      expect(Array.isArray(last[1])).toBe(true);
      expect((last[1] as any[]).length).toBe(1);
    });

    it('getOnlineUsersByMunicipio delega para getOnlineUsersByRegion', async () => {
      const users = [{ uid: '1', municipio: 'Rio', isOnline: true }] as unknown as IUserDados[];
      mockPresence.getOnlineUsersByRegion$.mockReturnValueOnce(of(users));

      const res = await firstValueFrom(service.getOnlineUsersByMunicipio('Rio'));

      expect(mockPresence.getOnlineUsersByRegion$).toHaveBeenCalledWith('Rio');
      expect(res).toEqual(users);
    });

    it('getSuggestedProfiles delega para getDocumentsLiveSafe com limit', async () => {
      const users = [{ uid: 's1' }] as unknown as IUserDados[];
      mockRead.getDocumentsLiveSafe.mockReturnValueOnce(of(users));

      const res = await firstValueFrom(service.getSuggestedProfiles());

      expect(res).toEqual(users);
      const last = mockRead.getDocumentsLiveSafe.mock.calls.at(-1)!;
      expect(last[0]).toBe('public_profiles');
      expect(Array.isArray(last[1])).toBe(true);
      expect((last[1] as any[]).length).toBe(1);
      expect(last[2]).toEqual({ idField: 'uid', requireAuth: true });
    });
  });

  it('getProfilesByOrientationAndLocation envia 3 constraints', async () => {
    const users = [{ uid: 'p1' }] as unknown as IUserDados[];
    mockRead.getDocumentsOnce.mockReturnValueOnce(of(users));

    const res = await firstValueFrom(
      service.getProfilesByOrientationAndLocation('M', 'hetero', 'Rio')
    );

    expect(res).toEqual(users);
    const last = mockRead.getDocumentsOnce.mock.calls.at(-1)!;
    const constraints = last[1] as any[];
    expect(constraints.length).toBe(3);
  });

  it('getUserFromState retorna null quando selector não tem usuário', async () => {
    const res = await firstValueFrom(service.getUserFromState('uX'));
    expect(res).toBeNull();
  });

  it('searchUsers delega para getDocumentsOnce com constraints', async () => {
    const constraints: any[] = [{}, {}];
    const result = [{ uid: 'z1' }] as unknown as IUserDados[];
    mockRead.getDocumentsOnce.mockReturnValueOnce(of(result));

    const res = await firstValueFrom(service.searchUsers(constraints as any));

    expect(res).toEqual(result);
    expect(mockRead.getDocumentsOnce).toHaveBeenCalledWith(
      'users',
      constraints as any,
      { useCache: true, cacheTTL: 300_000 }
    );
  });
});
