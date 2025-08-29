// src/app/core/services/data-handling/firestore-query.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { expect as jestExpect } from '@jest/globals'; // 👈 garante typings do Jest

import * as fb from 'firebase/firestore';

import { FirestoreQueryService } from './firestore-query.service';
import { FirestoreService } from './firestore.service';
import { CacheService } from '../general/cache/cache.service';
import { FirestoreUserQueryService } from './firestore-user-query.service';
import { IUserDados } from '../../interfaces/iuser-dados';

class MockFirestoreService {
  getFirestoreInstance = jest.fn().mockReturnValue({} as any);
  getDocument = jest.fn().mockReturnValue(of(null));
  getDocuments = jest.fn().mockReturnValue(of([]));
}

class MockCacheService {
  get = jest.fn().mockReturnValue(of(undefined));
  set = jest.fn();
}

class MockFirestoreUserQueryService {
  getUserWithObservable = jest.fn().mockReturnValue(of(null));
}

describe('FirestoreQueryService (Jest)', () => {
  let service: FirestoreQueryService;
  let mockFs: MockFirestoreService;
  let mockCache: MockCacheService;
  let mockUserQuery: MockFirestoreUserQueryService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        FirestoreQueryService,
        { provide: FirestoreService, useClass: MockFirestoreService },
        { provide: CacheService, useClass: MockCacheService },
        { provide: FirestoreUserQueryService, useClass: MockFirestoreUserQueryService },
      ],
    });

    service = TestBed.inject(FirestoreQueryService);
    mockFs = TestBed.inject(FirestoreService) as unknown as MockFirestoreService;
    mockCache = TestBed.inject(CacheService) as unknown as MockCacheService;
    mockUserQuery = TestBed.inject(FirestoreUserQueryService) as unknown as MockFirestoreUserQueryService;

    jest.clearAllMocks();
  });

  it('deve ser criado', () => {
    expect(service).toBeTruthy();
  });

  it('getFirestoreInstance delega para FirestoreService.getFirestoreInstance', () => {
    const instance = service.getFirestoreInstance();
    expect(mockFs.getFirestoreInstance).toHaveBeenCalled();
    expect(instance).toBeTruthy();
  });

  it('getDocumentById delega para FirestoreService.getDocument', (done) => {
    const obj = { uid: '123' } as unknown as IUserDados;
    mockFs.getDocument.mockReturnValue(of(obj));

    service.getDocumentById<IUserDados>('users', '123').subscribe((res) => {
      expect(mockFs.getDocument).toHaveBeenCalledWith('users', '123');
      expect(res).toEqual(obj);
      done();
    });
  });

  it('getDocumentsByQuery delega para FirestoreService.getDocuments', (done) => {
    const result = [{ uid: '1' }] as unknown as IUserDados[];
    mockFs.getDocuments.mockReturnValue(of(result));

    service.getDocumentsByQuery<IUserDados>('users', []).subscribe((res) => {
      expect(mockFs.getDocuments).toHaveBeenCalledWith('users', jestExpect.any(Array));
      expect(res).toEqual(result);
      done();
    });
  });

  describe('getAllUsers', () => {
    it('usa cache quando houver', (done) => {
      const cached = [{ uid: 'c1' }] as unknown as IUserDados[];
      mockCache.get.mockReturnValueOnce(of(cached));

      service.getAllUsers().subscribe((res) => {
        expect(res).toEqual(cached);
        expect(mockFs.getDocuments).not.toHaveBeenCalled();
        expect(mockCache.set).not.toHaveBeenCalled();
        done();
      });
    });

    it('busca e seta cache quando não houver', (done) => {
      const users = [{ uid: 'u1' }, { uid: 'u2' }] as unknown as IUserDados[];
      mockCache.get.mockReturnValueOnce(of(undefined));
      mockFs.getDocuments.mockReturnValueOnce(of(users));

      service.getAllUsers().subscribe((res) => {
        expect(res).toEqual(users);
        expect(mockFs.getDocuments).toHaveBeenCalledWith('users', jestExpect.any(Array));
        expect(mockCache.set).toHaveBeenCalledWith('allUsers', users, 600_000);
        done();
      });
    });
  });

  describe('getOnlineUsers', () => {
    it('usa cache quando houver', (done) => {
      const cached = [{ uid: 'o1' }] as unknown as IUserDados[];
      mockCache.get.mockReturnValueOnce(of(cached));

      service.getOnlineUsers().subscribe((res) => {
        expect(res).toEqual(cached);
        expect(mockFs.getDocuments).not.toHaveBeenCalled();
        expect(mockCache.set).not.toHaveBeenCalled();
        done();
      });
    });

    it('busca e seta cache quando não houver', (done) => {
      const users = [{ uid: 'o1' }, { uid: 'o2' }] as unknown as IUserDados[];
      mockCache.get.mockReturnValueOnce(of(undefined));
      mockFs.getDocuments.mockReturnValueOnce(of(users));

      service.getOnlineUsers().subscribe((res) => {
        expect(res).toEqual(users);
        expect(mockFs.getDocuments).toHaveBeenCalledWith('users', jestExpect.any(Array));
        expect(mockCache.set).toHaveBeenCalledWith('onlineUsers', users, 60_000);
        done();
      });
    });
  });

  it('getUsersByMunicipio aplica where', (done) => {
    const users = [{ uid: 'm1', municipio: 'Rio' }] as unknown as IUserDados[];
    mockFs.getDocuments.mockReturnValueOnce(of(users));

    service.getUsersByMunicipio('Rio').subscribe((res) => {
      expect(res).toEqual(users);
      const lastArgs = mockFs.getDocuments.mock.calls.at(-1)!;
      expect(lastArgs[0]).toBe('users');
      expect(Array.isArray(lastArgs[1])).toBe(true);
      expect((lastArgs[1] as any[]).length).toBe(1);
      done();
    });
  });

  it('getOnlineUsersByMunicipio filtra pela cidade', (done) => {
    const list = [
      { uid: '1', municipio: 'Rio' },
      { uid: '2', municipio: 'Niterói' },
      { uid: '3', municipio: 'Rio' },
    ] as unknown as IUserDados[];

    jest.spyOn(service, 'getOnlineUsers').mockReturnValue(of(list));

    service.getOnlineUsersByMunicipio('Rio').subscribe((res) => {
      expect(res.length).toBe(2); // 👈 sem toHaveLength
      expect(res.every(u => u.municipio === 'Rio')).toBe(true);
      done();
    });
  });

  it('getOnlineUsersByRegion emite via onSnapshot (mock)', (done) => {
    jest.spyOn(fb, 'collection').mockReturnValue({} as any);
    jest.spyOn(fb, 'query').mockReturnValue({} as any);
    // 👇 cast para evitar erro de overload do TS
    (jest.spyOn(fb as any, 'onSnapshot') as unknown as jest.Mock).mockImplementation((_q: any, next: Function) => {
      const fakeSnap = {
        docs: [
          { data: () => ({ uid: 'r1', municipio: 'Rio', isOnline: true }) },
          { data: () => ({ uid: 'r2', municipio: 'Rio', isOnline: true }) },
        ],
      };
      next(fakeSnap);
      return () => { };
    });

    service.getOnlineUsersByRegion('Rio').subscribe((res) => {
      expect(mockFs.getFirestoreInstance).toHaveBeenCalled();
      expect(fb.collection).toHaveBeenCalled();
      expect(fb.query).toHaveBeenCalled();
      expect((fb as any).onSnapshot).toHaveBeenCalled();
      expect(res.length).toBe(2); // 👈 sem toHaveLength
      expect(res[0].uid).toBe('r1');
      done();
    });
  });

  it('getSuggestedProfiles delega para getDocuments([])', (done) => {
    const users = [{ uid: 's1' }] as unknown as IUserDados[];
    mockFs.getDocuments.mockReturnValueOnce(of(users));

    service.getSuggestedProfiles().subscribe((res) => {
      expect(res).toEqual(users);
      expect(mockFs.getDocuments).toHaveBeenCalledWith('users', jestExpect.any(Array));
      done();
    });
  });

  it('getProfilesByOrientationAndLocation envia 3 constraints', (done) => {
    const users = [{ uid: 'p1' }] as unknown as IUserDados[];
    mockFs.getDocuments.mockReturnValueOnce(of(users));

    service.getProfilesByOrientationAndLocation('M', 'hetero', 'Rio').subscribe((res) => {
      expect(res).toEqual(users);
      const [, constraints] = mockFs.getDocuments.mock.calls.at(-1)!;
      expect((constraints as any[]).length).toBe(3);
      done();
    });
  });

  it('getUserFromState delega para FirestoreUserQueryService.getUserWithObservable', (done) => {
    const user = { uid: 'uX' } as unknown as IUserDados;
    mockUserQuery.getUserWithObservable.mockReturnValueOnce(of(user));

    service.getUserFromState('uX').subscribe((res) => {
      expect(res).toEqual(user);
      expect(mockUserQuery.getUserWithObservable).toHaveBeenCalledWith('uX');
      done();
    });
  });

  it('searchUsers delega para getDocuments com constraints', (done) => {
    const constraints: any[] = [{}, {}];
    const result = [{ uid: 'z1' }] as unknown as IUserDados[];
    mockFs.getDocuments.mockReturnValueOnce(of(result));

    service.searchUsers(constraints as any).subscribe((res) => {
      expect(res).toEqual(result);
      expect(mockFs.getDocuments).toHaveBeenCalledWith('users', constraints as any);
      done();
    });
  });
});
