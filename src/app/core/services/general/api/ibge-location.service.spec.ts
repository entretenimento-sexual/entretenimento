// src/app/core/services/general/api/ibge-location.service.spec.ts
import { TestBed } from '@angular/core/testing';
import {
  HttpClientTestingModule,
  HttpTestingController,
} from '@angular/common/http/testing';
import { BehaviorSubject, firstValueFrom, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  IBGELocationService,
  IbgeMunicipio,
  IbgeUF,
  UserLocation,
} from './ibge-location.service';
import { AppCacheService } from '../cache/app-cache.service';
import { CurrentUserStoreService } from '../../autentication/auth/current-user-store.service';
import { AccessControlService } from '../../autentication/auth/access-control.service';
import { GlobalErrorHandlerService } from '../../error-handler/global-error-handler.service';

describe('IBGELocationService', () => {
  let service: IBGELocationService;
  let httpMock: HttpTestingController;
  let cache: {
    get$: ReturnType<typeof vi.fn>;
    set$: ReturnType<typeof vi.fn>;
    invalidate$: ReturnType<typeof vi.fn>;
  };
  let user$: BehaviorSubject<any | null | undefined>;
  let access: {
    hasAtLeast$: ReturnType<typeof vi.fn>;
  };
  let globalError: {
    handleError: ReturnType<typeof vi.fn>;
  };

  const estadosUrl =
    'https://servicodados.ibge.gov.br/api/v1/localidades/estados';
  const municipiosUrl = (uf: string) =>
    `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${encodeURIComponent(uf)}/municipios`;

  beforeEach(() => {
    cache = {
      get$: vi.fn().mockReturnValue(of({ status: 'miss' })),
      set$: vi.fn().mockReturnValue(of(void 0)),
      invalidate$: vi.fn().mockReturnValue(of(void 0)),
    };
    user$ = new BehaviorSubject<any | null | undefined>(undefined);
    access = {
      hasAtLeast$: vi.fn().mockReturnValue(of(false)),
    };
    globalError = {
      handleError: vi.fn(),
    };

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        IBGELocationService,
        { provide: AppCacheService, useValue: cache },
        {
          provide: CurrentUserStoreService,
          useValue: {
            user$,
            getLoggedUserUIDSnapshot: vi.fn(() => 'uid-viewer'),
          },
        },
        { provide: AccessControlService, useValue: access },
        {
          provide: GlobalErrorHandlerService,
          useValue: globalError,
        },
      ],
    });

    service = TestBed.inject(IBGELocationService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    user$.complete();
    vi.clearAllMocks();
  });

  it('deve ser criado', () => {
    expect(service).toBeTruthy();
  });

  it('carrega estados, ordena e persiste envelope público global', async () => {
    const promise = firstValueFrom(service.getEstados());
    const unsorted: IbgeUF[] = [
      { id: 33, sigla: 'RJ', nome: 'Rio de Janeiro' },
      { id: 35, sigla: 'SP', nome: 'São Paulo' },
      { id: 31, sigla: 'MG', nome: 'Minas Gerais' },
    ];

    const request = httpMock.expectOne(estadosUrl);
    expect(request.request.method).toBe('GET');
    request.flush(unsorted);

    const result = await promise;
    expect(result.map((item) => item.sigla)).toEqual([
      'MG',
      'RJ',
      'SP',
    ]);
    expect(cache.set$).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'catalog:ibge:states',
        scope: 'global',
        sensitivity: 'public',
        storage: 'persistent',
        version: 1,
      }),
      result
    );
  });

  it('retorna estados fresh sem chamada HTTP', async () => {
    const cached: IbgeUF[] = [
      { id: 31, sigla: 'MG', nome: 'Minas Gerais' },
    ];
    cache.get$.mockReturnValueOnce(
      of({ status: 'fresh', value: cached })
    );

    expect(await firstValueFrom(service.getEstados())).toEqual(cached);
    httpMock.expectNone(estadosUrl);
    expect(cache.set$).not.toHaveBeenCalled();
  });

  it('coalesce chamadas concorrentes de estados em uma requisição', async () => {
    const first = firstValueFrom(service.getEstados());
    const second = firstValueFrom(service.getEstados());

    const request = httpMock.expectOne(estadosUrl);
    request.flush([
      { id: 33, sigla: 'RJ', nome: 'Rio de Janeiro' },
    ] as IbgeUF[]);

    await expect(first).resolves.toHaveLength(1);
    await expect(second).resolves.toHaveLength(1);
  });

  it('carrega municípios com chave pública versionada por UF', async () => {
    const promise = firstValueFrom(service.getMunicipios(' rj '));
    const unsorted: IbgeMunicipio[] = [
      { id: 2, nome: 'Duque de Caxias' },
      { id: 1, nome: 'Angra dos Reis' },
    ];

    const request = httpMock.expectOne(municipiosUrl('RJ'));
    request.flush(unsorted);

    const result = await promise;
    expect(result.map((item) => item.nome)).toEqual([
      'Angra dos Reis',
      'Duque de Caxias',
    ]);
    expect(cache.set$).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'catalog:ibge:municipalities:RJ',
        scope: 'global',
        storage: 'persistent',
      }),
      result
    );
  });

  it('retorna [] para UF vazia sem consultar HTTP ou cache', async () => {
    expect(await firstValueFrom(service.getMunicipios('   '))).toEqual([]);
    expect(cache.get$).not.toHaveBeenCalled();
    httpMock.expectNone(() => true);
  });

  it('reporta falha de catálogo silenciosamente e retorna fallback', async () => {
    const promise = firstValueFrom(service.getEstados());
    const request = httpMock.expectOne(estadosUrl);
    request.flush('erro', {
      status: 500,
      statusText: 'Server Error',
    });

    expect(await promise).toEqual([]);
    expect(globalError.handleError).toHaveBeenCalledTimes(1);
  });

  it('retorna localização cached com política restrita em memória', async () => {
    const location: UserLocation = {
      uf: 'RJ',
      municipio: 'Niterói',
    };
    cache.get$.mockReturnValueOnce(
      of({ status: 'fresh', value: location })
    );

    expect(await firstValueFrom(service.getUserLocation())).toEqual(
      location
    );
    expect(cache.get$).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'location-summary',
        scope: 'user',
        ownerUid: 'uid-viewer',
        sensitivity: 'restricted',
        storage: 'memory',
        ttlMs: null,
      })
    );
  });

  it('espera hidratação e deriva localização do perfil runtime', async () => {
    const promise = firstValueFrom(service.getUserLocation());

    user$.next({
      estado: 'rj',
      municipio: 'Rio de Janeiro',
    });

    const result = await promise;
    expect(result).toEqual({
      uf: 'RJ',
      municipio: 'Rio de Janeiro',
    });
    expect(cache.set$).toHaveBeenCalledWith(
      expect.objectContaining({
        sensitivity: 'restricted',
        storage: 'memory',
      }),
      result
    );
  });

  it('updateUserLocation mantém API void e grava somente em memória quando permitido', () => {
    access.hasAtLeast$.mockReturnValue(of(true));

    service.updateUserLocation({
      uf: 'rj',
      municipio: 'Niterói',
    });

    expect(access.hasAtLeast$).toHaveBeenCalledWith('premium');
    expect(cache.set$).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'user',
        sensitivity: 'restricted',
        storage: 'memory',
      }),
      { uf: 'RJ', municipio: 'Niterói' }
    );
  });

  it('não atualiza localização sem ACL ou com payload inválido', () => {
    service.updateUserLocation({ uf: 'SP', municipio: 'Campinas' });
    service.updateUserLocation({ uf: ' ', municipio: '' });

    expect(cache.set$).not.toHaveBeenCalled();
    expect(access.hasAtLeast$).toHaveBeenCalledTimes(1);
  });

  it('clearUserLocationCache invalida a definição privada', () => {
    service.clearUserLocationCache();

    expect(cache.invalidate$).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'location-summary',
        ownerUid: 'uid-viewer',
        storage: 'memory',
      })
    );
  });

  it('warmCaches pré-aquece estados e municípios quando houver UF', () => {
    const estadosSpy = vi
      .spyOn(service, 'getEstados')
      .mockReturnValue(of([]));
    const municipiosSpy = vi
      .spyOn(service, 'getMunicipios')
      .mockReturnValue(of([]));

    service.warmCaches('RJ');

    expect(estadosSpy).toHaveBeenCalledTimes(1);
    expect(municipiosSpy).toHaveBeenCalledWith('RJ');
  });
});
