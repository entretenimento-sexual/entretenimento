// src/app/core/services/data-handling/queries/user-discovery.query.service.spec.ts

import { firstValueFrom, of, throwError } from 'rxjs';
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

  it('preserva classificação pública sem propagar descrição privada', async () => {
    publicProfileReadMock.readByUids$.mockReturnValue(
      of({
        items: [{
          uid: 'profile-identity',
          nickname: 'Casal teste',
          identityCode: 'casal-ele-ela',
          identityLabel: 'Casal (Ele/Ela)',
          identityShortLabel: 'Casal',
          identityCatalogVersion: 1,
          descricao: 'Texto não publicado na projeção',
        }],
        nextCursor: null, reachedEnd: true, fetchedAt: Date.now(), scanned: 1,
      })
    );
    const [profile] = await firstValueFrom(service.getProfilesByUids$(['profile-identity']));
    expect(profile).toMatchObject({
      identityCode: 'casal-ele-ela',
      identityLabel: 'Casal (Ele/Ela)',
      identityShortLabel: 'Casal',
      identityCatalogVersion: 1,
    });
    expect(profile?.descricao).toBe('');
    expect(profile?.descricao).not.toContain('Texto não publicado');
  });

  it('hidrata exclusivamente a descrição com opt-in publicada pelo backend', async () => {
    publicProfileReadMock.readByUids$.mockReturnValue(
      of({
        items: [{
          uid: 'profile-public-description',
          nickname: 'Perfil',
          descricao: 'Texto privado - nunca enviar',
          publicDescription: 'Apresentação autorizada.',
        }],
        nextCursor: null, reachedEnd: true, fetchedAt: Date.now(), scanned: 1,
      })
    );
    const [profile] = await firstValueFrom(service.getProfilesByUids$(['profile-public-description']));
    expect(profile?.descricao).toBe('Apresentação autorizada.');
    expect(profile?.descricao).not.toContain('Texto privado');
  });

  it('hidrata contagem e ID público da capa sem campos de armazenamento privados', async () => {
    publicProfileReadMock.readByUids$.mockReturnValue(
      of({
        items: [{
          uid: 'media-owner',
          nickname: 'Perfil',
          photosCount: 18,
          videosCount: 2,
          coverPhotoId: 'cover-approved',
          storagePath: 'private/secret',
        }],
        nextCursor: null, reachedEnd: true, fetchedAt: Date.now(), scanned: 1,
      })
    );
    const [profile] = await firstValueFrom(service.getProfilesByUids$(['media-owner']));
    expect(profile).toMatchObject({
      photosCount: 18,
      videosCount: 2,
      coverPhotoId: 'cover-approved',
    });
    expect('storagePath' in (profile ?? {})).toBe(false);
  });

  it('preserva somente os sinais públicos de preferências durante hidratação', async () => {
    publicProfileReadMock.readByUids$.mockReturnValue(
      of({
        items: [
          {
            uid: 'profile-public-signals',
            nickname: 'Profile',
            publicRelationshipIntents: ['serious'],
            publicSeekingGenders: ['women'],
            publicSexualPractices: ['bdsm'],
            publicBodyTraits: ['tattoos'],
            preferenceBadgesVisible: true,
            publicPreferencesUpdatedAt: 1_720_000_000_000,
          },
        ],
        nextCursor: null,
        reachedEnd: true,
        fetchedAt: Date.now(),
        scanned: 1,
      })
    );

    const profiles = await firstValueFrom(
      service.getProfilesByUids$(['profile-public-signals'])
    );

    expect(profiles[0]).toMatchObject({
      publicRelationshipIntents: ['serious'],
      publicSeekingGenders: ['women'],
      publicSexualPractices: ['bdsm'],
      publicBodyTraits: ['tattoos'],
      preferenceBadgesVisible: true,
      publicPreferencesUpdatedAt: 1_720_000_000_000,
    });
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
      'discovery:public_profiles:uids:v4:query:gender:man:viewer=viewer-1'
    );
  });

  it('não converte erro 429 em perfil inexistente quando o chamador exige erro explícito', async () => {
    const quotaError = Object.assign(new Error('Quota excedida'), {
      code: 'functions/resource-exhausted',
    });
    publicProfileReadMock.readByUids$.mockReturnValue(
      throwError(() => quotaError)
    );

    await expect(firstValueFrom(
      service.getProfilesByUids$(['visitado'], {
        forceRefresh: true,
        propagateErrors: true,
      })
    )).rejects.toBe(quotaError);

    expect(globalErrorHandlerMock.handleError).not.toHaveBeenCalled();
  });

  it('persiste somente uma projeção com elegibilidade temporal ainda válida', async () => {
    publicProfileReadMock.readByUids$.mockReturnValue(of({
      items: [{
        uid: 'owner-valid',
        nickname: 'Perfil validado',
        ageEligibilityVerifiedAdult: true,
        ageEligibilityValidUntil: Date.now() + 60_000,
      }],
      nextCursor: null,
      reachedEnd: true,
      fetchedAt: Date.now(),
      scanned: 1,
    }));

    await firstValueFrom(service.getProfilesByUids$(['owner-valid']));
    expect(cacheMock.set).toHaveBeenCalledWith(
      'discovery:public_profiles:uids:v4:owner-valid:viewer=viewer-1',
      expect.any(Array),
      30_000,
      { persist: true }
    );
  });

  it('forceRefresh ignora cache local mesmo quando havia snapshot persistido', async () => {
    cacheMock.get.mockReturnValue(of([{
      uid: 'owner-a',
      nickname: 'Snapshot antigo',
      ageEligibilityVerifiedAdult: true,
      ageEligibilityValidUntil: Date.now() + 60_000,
    }]));
    publicProfileReadMock.readByUids$.mockReturnValue(of({
      items: [{
        uid: 'owner-a',
        nickname: 'Atualizado no backend',
      }],
      nextCursor: null,
      reachedEnd: true,
      fetchedAt: Date.now(),
      scanned: 1,
    }));

    const profiles = await firstValueFrom(service.getProfilesByUids$(
      ['owner-a'], { forceRefresh: true }
    ));
    expect(profiles[0]?.nickname).toBe('Atualizado no backend');
    expect(cacheMock.get).not.toHaveBeenCalled();
    expect(cacheMock.set).not.toHaveBeenCalled();
    expect(publicProfileReadMock.readByUids$).toHaveBeenCalledWith(['owner-a']);
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
      'discovery:public_profiles:uids:v4:profile-a,profile-b:viewer=viewer-1';

    expect(profiles.map((profile) => profile.uid)).toEqual([
      'profile-a',
      'profile-b',
    ]);
    expect(publicProfileReadMock.readByUids$).toHaveBeenCalledWith([
      'profile-a',
      'profile-b',
    ]);
    expect(cacheMock.get).toHaveBeenCalledWith(expectedCacheKey);
    // A projeção pública não transporta prova de validade temporal; o
    // cache não deve persistir dados que recusaria na próxima leitura.
    expect(cacheMock.set).not.toHaveBeenCalled();
  });
});
