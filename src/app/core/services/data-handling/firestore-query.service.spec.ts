// src/app/core/services/data-handling/firestore-query.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { expect as jestExpect } from '@jest/globals';

import { Firestore } from '@angular/fire/firestore';
import { FirestoreQueryService } from './firestore-query.service';

import { CacheService } from '../general/cache/cache.service';
import { FirestoreUserQueryService } from './firestore-user-query.service';
import { FirestoreReadService } from './firestore/core/firestore-read.service';
import { UserPresenceQueryService } from './queries/user-presence.query.service';

import { IUserDados } from '../../interfaces/iuser-dados';

// ========================
// Mocks
// ========================

class MockFirestoreReadService {
  getDocument = jest.fn().mockReturnValue(of(null));
  getDocumentsOnce = jest.fn().mockReturnValue(of([]));
}

class MockCacheService {
  get = jest.fn().mockReturnValue(of(undefined));
  set = jest.fn();
}

class MockFirestoreUserQueryService {
  getUserWithObservable = jest.fn().mockReturnValue(of(null));
}

class MockUserPresenceQueryService {
  getOnlineUsers$ = jest.fn().mockReturnValue(of([]));
  getOnlineUsersOnce$ = jest.fn().mockReturnValue(of([]));
  getOnlineUsersByRegion$ = jest.fn().mockReturnValue(of([]));
  getRecentlyOnline$ = jest.fn().mockReturnValue(of([]));
}

describe('FirestoreQueryService (Jest)', () => {
  let service: FirestoreQueryService;

  let mockRead: MockFirestoreReadService;
  let mockCache: MockCacheService;
  let mockUserQuery: MockFirestoreUserQueryService;
  let mockPresence: MockUserPresenceQueryService;

  const firestoreMock = {} as unknown as Firestore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        FirestoreQueryService,

        { provide: Firestore, useValue: firestoreMock },
        { provide: CacheService, useClass: MockCacheService },
        { provide: FirestoreUserQueryService, useClass: MockFirestoreUserQueryService },
        { provide: FirestoreReadService, useClass: MockFirestoreReadService },
        { provide: UserPresenceQueryService, useClass: MockUserPresenceQueryService },
      ],
    });

    service = TestBed.inject(FirestoreQueryService);

    mockRead = TestBed.inject(FirestoreReadService) as unknown as MockFirestoreReadService;
    mockCache = TestBed.inject(CacheService) as unknown as MockCacheService;
    mockUserQuery = TestBed.inject(FirestoreUserQueryService) as unknown as MockFirestoreUserQueryService;
    mockPresence = TestBed.inject(UserPresenceQueryService) as unknown as MockUserPresenceQueryService;

    jest.clearAllMocks();
  });

  it('deve ser criado', () => {
    expect(service).toBeTruthy();
  });

  it('getFirestoreInstance retorna a instância injetada', () => {
    const instance = service.getFirestoreInstance();
    expect(instance).toBe(firestoreMock);
  });

  it('getDocumentById delega para FirestoreReadService.getDocument', (done) => {
    const obj = { uid: '123' } as unknown as IUserDados;
    mockRead.getDocument.mockReturnValueOnce(of(obj));

    service.getDocumentById<IUserDados>('users', '123').subscribe((res: IUserDados | null) => {
      expect(mockRead.getDocument).toHaveBeenCalledWith('users', '123');
      expect(res).toEqual(obj);
      done();
    });
  });

  it('getDocumentsByQuery delega para FirestoreReadService.getDocumentsOnce (com cache)', (done) => {
    const result = [{ uid: '1' }] as unknown as IUserDados[];
    mockRead.getDocumentsOnce.mockReturnValueOnce(of(result));

    service.getDocumentsByQuery<IUserDados>('users', []).subscribe((res: IUserDados[]) => {
      expect(mockRead.getDocumentsOnce).toHaveBeenCalledWith(
        'users',
        jestExpect.any(Array),
        { useCache: true, cacheTTL: 300_000 }
      );
      expect(res).toEqual(result);
      done();
    });
  });

  describe('getAllUsers', () => {
    it('usa cache quando houver', (done) => {
      const cached = [{ uid: 'c1' }] as unknown as IUserDados[];
      mockCache.get.mockReturnValueOnce(of(cached));

      service.getAllUsers().subscribe((res: IUserDados[]) => {
        expect(res).toEqual(cached);
        expect(mockRead.getDocumentsOnce).not.toHaveBeenCalled();
        expect(mockCache.set).not.toHaveBeenCalled();
        done();
      });
    });

    it('busca e seta cache quando não houver', (done) => {
      const users = [{ uid: 'u1' }, { uid: 'u2' }] as unknown as IUserDados[];
      mockCache.get.mockReturnValueOnce(of(undefined));
      mockRead.getDocumentsOnce.mockReturnValueOnce(of(users));

      service.getAllUsers().subscribe((res: IUserDados[]) => {
        expect(res).toEqual(users);
        expect(mockRead.getDocumentsOnce).toHaveBeenCalledWith(
          'users',
          jestExpect.any(Array),
          { useCache: true, cacheTTL: 300_000 }
        );
        expect(mockCache.set).toHaveBeenCalledWith('allUsers', users, 600_000);
        done();
      });
    });
  });

  describe('presença (delegação)', () => {
    it('getOnlineUsers$ delega para UserPresenceQueryService.getOnlineUsers$', (done) => {
      const users = [{ uid: 'o1', isOnline: true }] as unknown as IUserDados[];
      mockPresence.getOnlineUsers$.mockReturnValueOnce(of(users));

      service.getOnlineUsers$().subscribe((res: IUserDados[]) => {
        expect(mockPresence.getOnlineUsers$).toHaveBeenCalled();
        expect(res).toEqual(users);
        done();
      });
    });

    it('getOnlineUsers delega para UserPresenceQueryService.getOnlineUsersOnce$', (done) => {
      const users = [{ uid: 'o1', isOnline: true }] as unknown as IUserDados[];
      mockPresence.getOnlineUsersOnce$.mockReturnValueOnce(of(users));

      service.getOnlineUsers().subscribe((res: IUserDados[]) => {
        expect(mockPresence.getOnlineUsersOnce$).toHaveBeenCalled();
        expect(res).toEqual(users);
        done();
      });
    });

    it('getOnlineUsersByRegion delega para UserPresenceQueryService.getOnlineUsersByRegion$', (done) => {
      const users = [{ uid: 'r1', municipio: 'Rio', isOnline: true }] as unknown as IUserDados[];
      mockPresence.getOnlineUsersByRegion$.mockReturnValueOnce(of(users));

      service.getOnlineUsersByRegion('Rio').subscribe((res: IUserDados[]) => {
        expect(mockPresence.getOnlineUsersByRegion$).toHaveBeenCalledWith('Rio');
        expect(res).toEqual(users);
        done();
      });
    });

    it('getRecentlyOnline$ delega para UserPresenceQueryService.getRecentlyOnline$', (done) => {
      const users = [{ uid: 'x1' }] as unknown as IUserDados[];
      mockPresence.getRecentlyOnline$.mockReturnValueOnce(of(users));

      service.getRecentlyOnline$(45_000).subscribe((res: IUserDados[]) => {
        expect(mockPresence.getRecentlyOnline$).toHaveBeenCalledWith(45_000);
        expect(res).toEqual(users);
        done();
      });
    });
  });

  describe('wrappers compat', () => {
    it('getUsersByMunicipio aplica where (1 constraint)', (done) => {
      const users = [{ uid: 'm1', municipio: 'Rio' }] as unknown as IUserDados[];
      mockRead.getDocumentsOnce.mockReturnValueOnce(of(users));

      service.getUsersByMunicipio('Rio').subscribe((res: IUserDados[]) => {
        expect(res).toEqual(users);

        const last = mockRead.getDocumentsOnce.mock.calls.at(-1)!;
        expect(last[0]).toBe('users');
        expect(Array.isArray(last[1])).toBe(true);
        expect((last[1] as any[]).length).toBe(1);

        done();
      });
    });

    it('getOnlineUsersByMunicipio delega para getOnlineUsersByRegion', (done) => {
      const users = [{ uid: '1', municipio: 'Rio', isOnline: true }] as unknown as IUserDados[];
      mockPresence.getOnlineUsersByRegion$.mockReturnValueOnce(of(users));

      service.getOnlineUsersByMunicipio('Rio').subscribe((res: IUserDados[]) => {
        expect(mockPresence.getOnlineUsersByRegion$).toHaveBeenCalledWith('Rio');
        expect(res).toEqual(users);
        done();
      });
    });

    it('getSuggestedProfiles delega para getDocumentsOnce com constraints []', (done) => {
      const users = [{ uid: 's1' }] as unknown as IUserDados[];
      mockRead.getDocumentsOnce.mockReturnValueOnce(of(users));

      service.getSuggestedProfiles().subscribe((res: IUserDados[]) => {
        expect(res).toEqual(users);
        expect(mockRead.getDocumentsOnce).toHaveBeenCalledWith(
          'users',
          jestExpect.any(Array),
          { useCache: true, cacheTTL: 300_000 }
        );
        done();
      });
    });
  });

  it('getProfilesByOrientationAndLocation envia 3 constraints', (done) => {
    const users = [{ uid: 'p1' }] as unknown as IUserDados[];
    mockRead.getDocumentsOnce.mockReturnValueOnce(of(users));

    service.getProfilesByOrientationAndLocation('M', 'hetero', 'Rio').subscribe((res: IUserDados[]) => {
      expect(res).toEqual(users);
      const last = mockRead.getDocumentsOnce.mock.calls.at(-1)!;
      const constraints = last[1] as any[];
      expect(constraints.length).toBe(3);
      done();
    });
  });

  it('getUserFromState delega para FirestoreUserQueryService.getUserWithObservable', (done) => {
    const user = { uid: 'uX' } as unknown as IUserDados;
    mockUserQuery.getUserWithObservable.mockReturnValueOnce(of(user));

    service.getUserFromState('uX').subscribe((res: IUserDados | null) => {
      expect(res).toEqual(user);
      expect(mockUserQuery.getUserWithObservable).toHaveBeenCalledWith('uX');
      done();
    });
  });

  it('searchUsers delega para getDocumentsOnce com constraints', (done) => {
    const constraints: any[] = [{}, {}];
    const result = [{ uid: 'z1' }] as unknown as IUserDados[];
    mockRead.getDocumentsOnce.mockReturnValueOnce(of(result));

    service.searchUsers(constraints as any).subscribe((res: IUserDados[]) => {
      expect(res).toEqual(result);
      expect(mockRead.getDocumentsOnce).toHaveBeenCalledWith(
        'users',
        constraints as any,
        { useCache: true, cacheTTL: 300_000 }
      );
      done();
    });
  });
});
