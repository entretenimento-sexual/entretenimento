// src/app/core/services/data-handling/queries/user-discovery.query.service.spec.ts

import { firstValueFrom, of } from 'rxjs';
import { where } from 'firebase/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IUserDados } from '@core/interfaces/iuser-dados';

import { UserDiscoveryQueryService } from './user-discovery.query.service';

describe('UserDiscoveryQueryService', () => {
  const readMock = {
    getDocumentsOnce: vi.fn(),
  };

  const cacheMock = {
    get: vi.fn(() => of(null)),
    set: vi.fn(),
  };

  const firestoreErrorMock = {
    handleFirestoreErrorAndReturn: vi.fn(
      (_error: unknown, fallback: IUserDados[]) => of(fallback)
    ),
  };

  const authSessionMock = {
    uid$: of('viewer-1'),
  };

  let service: UserDiscoveryQueryService;

  beforeEach(() => {
    vi.clearAllMocks();
    cacheMock.get.mockReturnValue(of(null));

    service = new UserDiscoveryQueryService(
      readMock as any,
      cacheMock as any,
      firestoreErrorMock as any,
      authSessionMock as any
    );
  });

  it('não deve expor leitura integral de public_profiles', () => {
    expect('getAllUsers$' in service).toBe(false);
  });

  it('deve executar consultas genéricas distintas sem compartilhar cache por tipo', async () => {
    readMock.getDocumentsOnce
      .mockReturnValueOnce(
        of([
          {
            uid: 'man-1',
            nickname: 'Man',
            gender: 'man',
          },
        ])
      )
      .mockReturnValueOnce(
        of([
          {
            uid: 'woman-1',
            nickname: 'Woman',
            gender: 'woman',
          },
        ])
      );

    const men = await firstValueFrom(
      service.searchUsers([where('gender', '==', 'man')])
    );
    const women = await firstValueFrom(
      service.searchUsers([where('gender', '==', 'woman')])
    );

    expect(men.map((profile) => profile.uid)).toEqual(['man-1']);
    expect(women.map((profile) => profile.uid)).toEqual(['woman-1']);
    expect(readMock.getDocumentsOnce).toHaveBeenCalledTimes(2);
    expect(cacheMock.get).not.toHaveBeenCalled();
  });

  it('deve separar cache conhecido pela consulta e pela sessão', async () => {
    readMock.getDocumentsOnce.mockReturnValue(
      of([
        {
          uid: 'profile-1',
          nickname: 'Profile',
          gender: 'man',
        },
      ])
    );

    await firstValueFrom(service.getUsersByGender$('Man'));

    expect(cacheMock.get).toHaveBeenCalledWith(
      'discovery:public_profiles:uids:query:gender:man:viewer=viewer-1'
    );
  });

  it('deve hidratar somente os UIDs pedidos com chave determinística', async () => {
    readMock.getDocumentsOnce.mockReturnValue(
      of([
        {
          uid: 'profile-a',
          nickname: 'Profile A',
        },
        {
          uid: 'profile-b',
          nickname: 'Profile B',
        },
      ])
    );

    const profiles = await firstValueFrom(
      service.getProfilesByUids$([
        'profile-b',
        'profile-a',
        'profile-b',
      ])
    );

    const expectedCacheKey =
      'discovery:public_profiles:uids:profile-a,profile-b:viewer=viewer-1';

    expect(profiles.map((profile) => profile.uid)).toEqual([
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
    expect(
      cacheMock.get.mock.calls.some(([key]) =>
        String(key).includes('public_profiles:all')
      )
    ).toBe(false);
  });
});
