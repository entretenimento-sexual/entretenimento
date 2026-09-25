// src/app/core/services/data-handling/queries/user-discovery.query.service.spec.ts

import { firstValueFrom, of } from 'rxjs';
import { where } from 'firebase/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserDiscoveryQueryService } from './user-discovery.query.service';

describe('UserDiscoveryQueryService', () => {
  const cacheMock = {
    get: vi.fn(() => of(null)),
    set: vi.fn(),
  };

  const globalErrorHandlerMock = {
    handleError: vi.fn(),
  };

  const authSessionMock = {
    uid$: of('viewer-1'),
  };

  const publicProfileReadMock = {
    read$: vi.fn(),
    readByUids$: vi.fn(),
  };

  let service: UserDiscoveryQueryService;

  beforeEach(() => {
    vi.clearAllMocks();
    cacheMock.get.mockReturnValue(of(null));
    publicProfileReadMock.read$.mockReturnValue(
      of({
        items: [],
        nextCursor: null,
        reachedEnd: true,
        fetchedAt: Date.now(),
        scanned: 0,
      })
    );
    publicProfileReadMock.readByUids$.mockReturnValue(
      of({
        items: [],
        nextCursor: null,
        reachedEnd: true,
        fetchedAt: Date.now(),
        scanned: 0,
      })
    );

    service = new UserDiscoveryQueryService(
      cacheMock as any,
      authSessionMock as any,
      publicProfileReadMock as any,
      globalErrorHandlerMock as any
    );
  });

  it('não deve expor leitura integral de public_profiles', () => {
    expect('getAllUsers$' in service).toBe(false);
  });

  it('falha fechado na API genérica baseada em QueryConstraint', async () => {
    const result = await firstValueFrom(
      service.searchUsers([where('gender', '==', 'man')])
    );

    expect(result).toEqual([]);
    expect(publicProfileReadMock.read$).not.toHaveBeenCalled();
    expect(globalErrorHandlerMock.handleError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Consulta genérica'),
        context: 'user-discovery.searchUsers.legacy-query-constraint',
        skipUserNotification: true,
        silent: true,
      })
    );
  });

  it('deve executar busca estruturada pela fronteira backend-time', async () => {
    publicProfileReadMock.read$.mockReturnValue(
      of({
        items: [
          {
            uid: 'profile-1',
            nickname: 'Profile',
            gender: 'man',
            age: 42,
          },
        ],
        nextCursor: null,
        reachedEnd: true,
        fetchedAt: Date.now(),
        scanned: 1,
      })
    );

    const profiles = await firstValueFrom(
      service.getUsersByGender$('Man')
    );

    expect(publicProfileReadMock.read$).toHaveBeenCalledWith({
      mode: 'all',
      pageSize: 120,
      filters: { gender: 'Man' },
    });
    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.uid).toBe('profile-1');
    expect(profiles[0]?.age).toBeNull();
  });

  it('deve separar cache conhecido pela consulta e pela sessão', async () => {
    publicProfileReadMock.read$.mockReturnValue(
      of({
        items: [
          {
            uid: 'profile-1',
            nickname: 'Profile',
            gender: 'man',
          },
        ],
        nextCursor: null,
        reachedEnd: true,
        fetchedAt: Date.now(),
        scanned: 1,
      })
    );

    await firstValueFrom(service.getUsersByGender$('Man'));

    expect(cacheMock.get).toHaveBeenCalledWith(
      'discovery:public_profiles:uids:v3:query:gender:man:viewer=viewer-1'
    );
  });

  it('deve hidratar somente os UIDs pedidos com chave determinística', async () => {
    publicProfileReadMock.readByUids$.mockReturnValue(
      of({
        items: [
          {
            uid: 'profile-a',
            nickname: 'Profile A',
          },
          {
            uid: 'profile-b',
            nickname: 'Profile B',
          },
        ],
        nextCursor: null,
        reachedEnd: true,
        fetchedAt: Date.now(),
        scanned: 2,
      })
    );

    const profiles = await firstValueFrom(
      service.getProfilesByUids$([
        'profile-b',
        'profile-a',
        'profile-b',
      ])
    );

    const expectedCacheKey =
      'discovery:public_profiles:uids:v3:profile-a,profile-b:viewer=viewer-1';

    expect(profiles.map((profile) => profile.uid)).toEqual([
      'profile-a',
      'profile-b',
    ]);
    expect(publicProfileReadMock.readByUids$).toHaveBeenCalledWith([
      'profile-a',
      'profile-b',
    ]);
    expect(cacheMock.get).toHaveBeenCalledWith(expectedCacheKey);
    expect(cacheMock.set).toHaveBeenCalledWith(
      expectedCacheKey,
      expect.any(Array),
      30_000,
      { persist: true }
    );
  });
});
