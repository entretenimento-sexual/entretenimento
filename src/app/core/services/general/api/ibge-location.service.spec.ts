// src/app/core/services/general/api/ibge-location.service.spec.ts
import { TestBed } from '@angular/core/testing';
import {
  HttpClientTestingModule,
  HttpTestingController,
} from '@angular/common/http/testing';
import { BehaviorSubject, of } from 'rxjs';

import {
  IBGELocationService,
  IbgeUF,
  IbgeMunicipio,
  UserLocation,
} from './ibge-location.service';
import { CacheService } from '../cache/cache.service';
import { CurrentUserStoreService } from '../../autentication/auth/current-user-store.service';
import { AccessControlService } from '../../autentication/auth/access-control.service';
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from 'vitest';


// =============================================================================
// Mocks nativos do ambiente atual (Jest runtime, sem depender de expect.any())
// =============================================================================

type CacheServiceMock = {
  get: Mock;
  set: Mock;
  delete: Mock;
};

type CurrentUserStoreServiceMock = {
  user$: BehaviorSubject<any | null | undefined>;
};

type AccessControlServiceMock = {
  hasAtLeast$: Mock;
};

describe('IBGELocationService', () => {
  let service: IBGELocationService;
  let httpMock: HttpTestingController;

  let cacheMock: CacheServiceMock;
  let userStoreMock: CurrentUserStoreServiceMock;
  let accessMock: AccessControlServiceMock;

  const ESTADOS_URL =
    'https://servicodados.ibge.gov.br/api/v1/localidades/estados';

  const MUNICIPIOS_URL = (uf: string) =>
    `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${encodeURIComponent(
      uf
    )}/municipios`;

  beforeEach(() => {
    cacheMock = {
      get: vi.fn().mockReturnValue(of(null)),
      set: vi.fn(),
      delete: vi.fn(),
    };

    userStoreMock = {
      user$: new BehaviorSubject<any | null | undefined>(undefined),
    };

    accessMock = {
      hasAtLeast$: vi.fn().mockReturnValue(of(false)),
    };

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        IBGELocationService,
        { provide: CacheService, useValue: cacheMock },
        { provide: CurrentUserStoreService, useValue: userStoreMock },
        { provide: AccessControlService, useValue: accessMock },
      ],
    });

    service = TestBed.inject(IBGELocationService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    userStoreMock.user$.complete();
    vi.clearAllMocks();
  });

  it('deve ser criado', () => {
    expect(service).toBeTruthy();
  });

  it('deve carregar estados do IBGE quando cache estiver vazio e ordená-los', (done) => {
    const unsorted: IbgeUF[] = [
      { id: 33, sigla: 'RJ', nome: 'Rio de Janeiro' },
      { id: 35, sigla: 'SP', nome: 'São Paulo' },
      { id: 31, sigla: 'MG', nome: 'Minas Gerais' },
    ];

    cacheMock.get.mockReturnValue(of(null));

    service.getEstados().subscribe((list) => {
      expect(list.map((e) => e.sigla)).toEqual(['MG', 'RJ', 'SP']);

      const setArgs = cacheMock.set.mock.calls[0];
      expect(setArgs[0]).toBe('ibge:estados');
      expect(setArgs[1]).toEqual(list);
      expect(typeof setArgs[2]).toBe('number');
      expect(setArgs[2]).toBeGreaterThan(0);
     
    });

    const req = httpMock.expectOne(ESTADOS_URL);
    expect(req.request.method).toBe('GET');
    req.flush(unsorted);
  });

  it('deve retornar estados do cache quando disponível sem chamar HTTP', (done) => {
    const cached: IbgeUF[] = [
      { id: 31, sigla: 'MG', nome: 'Minas Gerais' },
      { id: 33, sigla: 'RJ', nome: 'Rio de Janeiro' },
    ];

    cacheMock.get.mockReturnValue(of(cached));

    service.getEstados().subscribe((list) => {
      expect(list).toBe(cached);
      expect(cacheMock.set).not.toHaveBeenCalled();
      
    });

    httpMock.expectNone(ESTADOS_URL);
  });

  it('deve carregar municípios de uma UF, ordenar e salvar no cache', (done) => {
    const uf = 'RJ';
    const unsorted: IbgeMunicipio[] = [
      { id: 2, nome: 'Duque de Caxias' },
      { id: 1, nome: 'Angra dos Reis' },
      { id: 3, nome: 'Rio de Janeiro' },
    ];

    cacheMock.get.mockReturnValue(of(null));

    service.getMunicipios(uf).subscribe((list) => {
      expect(list.map((m) => m.nome)).toEqual([
        'Angra dos Reis',
        'Duque de Caxias',
        'Rio de Janeiro',
      ]);

      const setArgs = cacheMock.set.mock.calls[0];
      expect(setArgs[0]).toBe(`ibge:municipios:${uf}`);
      expect(setArgs[1]).toEqual(list);
      expect(typeof setArgs[2]).toBe('number');
      expect(setArgs[2]).toBeGreaterThan(0);

    });

    const req = httpMock.expectOne(MUNICIPIOS_URL(uf));
    expect(req.request.method).toBe('GET');
    req.flush(unsorted);
  });

  it('deve retornar municípios do cache quando disponível', (done) => {
    const uf = 'SP';
    const cached: IbgeMunicipio[] = [
      { id: 1, nome: 'Campinas' },
      { id: 2, nome: 'São Paulo' },
    ];

    cacheMock.get.mockImplementation((key: string) => {
      if (key === `ibge:municipios:${uf}`) {
        return of(cached);
      }
      return of(null);
    });

    service.getMunicipios(uf).subscribe((list) => {
      expect(list).toBe(cached);
      expect(cacheMock.set).not.toHaveBeenCalled();
      
    });

    httpMock.expectNone(MUNICIPIOS_URL(uf));
  });

  it('deve retornar [] se a requisição de estados falhar', (done) => {
    cacheMock.get.mockReturnValue(of(null));

    service.getEstados().subscribe((list) => {
      expect(list).toEqual([]);
      
    });

    const req = httpMock.expectOne(ESTADOS_URL);
    req.flush('erro', { status: 500, statusText: 'Server Error' });
  });

  it('deve retornar [] imediatamente se getMunicipios for chamado com UF vazia', (done) => {
    service.getMunicipios('   ').subscribe((list) => {
      expect(list).toEqual([]);
      
    });

    httpMock.expectNone(() => true);
  });

  it('getUserLocation deve vir do cache quando existir', (done) => {
    const cached: UserLocation = {
      uf: 'RJ',
      municipio: 'Duque de Caxias',
    };

    cacheMock.get.mockReturnValue(of(cached));

    service.getUserLocation().subscribe((loc) => {
      expect(loc).toEqual(cached);
      
    });
  });

  it('getUserLocation deve derivar do usuário do store e persistir quando cache estiver vazio', (done) => {
    cacheMock.get.mockReturnValue(of(null));
    userStoreMock.user$.next({
      estado: 'rj',
      municipio: 'Rio de Janeiro',
    });

    service.getUserLocation().subscribe((loc) => {
      expect(loc).toEqual({
        uf: 'RJ',
        municipio: 'Rio de Janeiro',
      });

      expect(cacheMock.set).toHaveBeenCalledWith('user:location', {
        uf: 'RJ',
        municipio: 'Rio de Janeiro',
      });

    });
  });

  it('updateUserLocation deve setar no cache quando role for premium ou superior', () => {
    accessMock.hasAtLeast$.mockReturnValue(of(true));

    service.updateUserLocation({
      uf: 'rj',
      municipio: 'Niterói',
    });

    expect(accessMock.hasAtLeast$).toHaveBeenCalledWith('premium');
    expect(cacheMock.set).toHaveBeenCalledWith('user:location', {
      uf: 'RJ',
      municipio: 'Niterói',
    });
  });

  it('updateUserLocation não deve setar no cache quando role for insuficiente', () => {
    accessMock.hasAtLeast$.mockReturnValue(of(false));

    service.updateUserLocation({
      uf: 'SP',
      municipio: 'Campinas',
    });

    expect(accessMock.hasAtLeast$).toHaveBeenCalledWith('premium');
    expect(cacheMock.set).not.toHaveBeenCalledWith('user:location', {
      uf: 'SP',
      municipio: 'Campinas',
    });
  });

  it('updateUserLocation deve ignorar payload inválido', () => {
    accessMock.hasAtLeast$.mockReturnValue(of(true));

    service.updateUserLocation({
      uf: '   ',
      municipio: '',
    });

    expect(accessMock.hasAtLeast$).not.toHaveBeenCalled();
    expect(cacheMock.set).not.toHaveBeenCalled();
  });

  it('clearUserLocationCache deve deletar a chave no cache', () => {
    service.clearUserLocationCache();
    expect(cacheMock.delete).toHaveBeenCalledWith('user:location');
  });

  it('warmCaches deve disparar getEstados e getMunicipios quando UF for fornecida', () => {
 const spyEstados = vi.spyOn(service as any, 'getEstados');
const spyMunicipios = vi.spyOn(service as any, 'getMunicipios');

    service.warmCaches('RJ');

    expect(spyEstados).toHaveBeenCalled();
    expect(spyMunicipios).toHaveBeenCalledWith('RJ');
  });

  it('warmCaches deve disparar apenas getEstados quando UF não for fornecida', () => {
const spyEstados = vi.spyOn(service as any, 'algumMetodo');
const spyMunicipios = vi.spyOn(service as any, 'algumOutroMetodo');

    service.warmCaches();

    expect(spyEstados).toHaveBeenCalled();
    expect(spyMunicipios).not.toHaveBeenCalled();
  });
});
