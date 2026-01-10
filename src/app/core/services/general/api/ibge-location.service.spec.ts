//src\app\core\services\general\api\ibge-location.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';

import { IBGELocationService, IbgeUF, IbgeMunicipio, UserLocation } from './ibge-location.service';
import { BehaviorSubject, of } from 'rxjs';

// Mocks simples dos serviços usados pelo IBGELocationService
class CacheServiceMock {
  get = jasmine.createSpy('get').and.returnValue(of(null));
  set = jasmine.createSpy('set');
  delete = jasmine.createSpy('delete');
}

class CurrentUserStoreServiceMock {
  // começa como undefined (estado real do app)
  user$ = new BehaviorSubject<any | null | undefined>(undefined);
}

class AccessControlServiceMock {
  hasAtLeast$ = jasmine.createSpy('hasAtLeast$').and.returnValue(of(false));
}

describe('IBGELocationService', () => {
  let service: IBGELocationService;
  let httpMock: HttpTestingController;

  // aliases internos do app (ajuste se não usa @core/* nos testes)
  let cache: CacheServiceMock;
  let userStore: CurrentUserStoreServiceMock;
  let access: AccessControlServiceMock;

  const ESTADOS_URL = 'https://servicodados.ibge.gov.br/api/v1/localidades/estados';
  const MUNICIPIOS_URL = (uf: string) =>
    `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${encodeURIComponent(uf)}/municipios`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        IBGELocationService,
        { provide: (class { } as any), useValue: null }, // placeholder se algum provider fantasma aparecer
        { provide: (class { } as any), useValue: null },
        { provide: (class { } as any), useValue: null },
        // Mapear explicitamente mocks para os tokens reais do app:
        { provide: (require as any).resolveWeak?.('@core/services/general/cache/cache.service') ?? 'CacheService', useClass: CacheServiceMock },
        { provide: (require as any).resolveWeak?.('@core/services/autentication/auth/current-user-store.service') ?? 'CurrentUserStoreService', useClass: CurrentUserStoreServiceMock },
        { provide: (require as any).resolveWeak?.('@core/services/autentication/auth/access-control.service') ?? 'AccessControlService', useClass: AccessControlServiceMock },
      ],
    });

    // Como os tokens com alias variam por setup, pegue instâncias via injeção concreta:
    service = TestBed.inject(IBGELocationService);
    httpMock = TestBed.inject(HttpTestingController);

    // Recupera instâncias dos mocks ligados por DI
    // (Como não temos os tokens TS reais aqui, pegamos por 'any' do próprio service)
    // @ts-ignore - acesso ao campo privado para fins de teste
    cache = (service as any).cache;
    // @ts-ignore
    userStore = (service as any).userStore;
    // @ts-ignore
    access = (service as any).access;
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('deve carregar estados do IBGE quando cache estiver vazio e ordená-los', (done) => {
    const unsorted: IbgeUF[] = [
      { id: 33, sigla: 'RJ', nome: 'Rio de Janeiro' },
      { id: 35, sigla: 'SP', nome: 'São Paulo' },
      { id: 31, sigla: 'MG', nome: 'Minas Gerais' },
    ];

    cache.get.and.returnValue(of(null));

    service.getEstados().subscribe((list) => {
      expect(list.map(e => e.sigla)).toEqual(['MG', 'RJ', 'SP']); // ordenado por nome
      expect(cache.set).toHaveBeenCalledWith('ibge:estados', list, jasmine.any(Number));
      done();
    });

    const req = httpMock.expectOne(ESTADOS_URL);
    expect(req.request.method).toBe('GET');
    req.flush(unsorted);
  });

  it('deve retornar estados do cache quando disponível (sem chamar HTTP)', (done) => {
    const cached: IbgeUF[] = [
      { id: 31, sigla: 'MG', nome: 'Minas Gerais' },
      { id: 33, sigla: 'RJ', nome: 'Rio de Janeiro' },
    ];
    cache.get.and.returnValue(of(cached));

    service.getEstados().subscribe((list) => {
      expect(list).toBe(cached);
      done();
    });

    httpMock.expectNone(ESTADOS_URL);
  });

  it('deve carregar municípios de uma UF, ordenar, e salvar no cache (miss)', (done) => {
    const uf = 'RJ';
    const unsorted: IbgeMunicipio[] = [
      { id: 2, nome: 'Duque de Caxias' },
      { id: 1, nome: 'Angra dos Reis' },
      { id: 3, nome: 'Rio de Janeiro' },
    ];

    cache.get.and.returnValue(of(null)); // miss

    service.getMunicipios(uf).subscribe((list) => {
      expect(list.map(m => m.nome)).toEqual(['Angra dos Reis', 'Duque de Caxias', 'Rio de Janeiro']);
      expect(cache.set).toHaveBeenCalledWith(`ibge:municipios:${uf}`, list, jasmine.any(Number));
      done();
    });

    const req = httpMock.expectOne(MUNICIPIOS_URL(uf));
    expect(req.request.method).toBe('GET');
    req.flush(unsorted);
  });

  it('deve retornar municípios do cache quando disponível (hit)', (done) => {
    const uf = 'SP';
    const cached: IbgeMunicipio[] = [{ id: 1, nome: 'Campinas' }, { id: 2, nome: 'São Paulo' }];
    cache.get.and.callFake((key: string) =>
      key === `ibge:municipios:${uf}` ? of(cached) : of(null)
    );

    service.getMunicipios(uf).subscribe((list) => {
      expect(list).toBe(cached);
      done();
    });

    httpMock.expectNone(MUNICIPIOS_URL(uf));
  });

  it('deve retornar [] se a requisição de estados falhar', (done) => {
    cache.get.and.returnValue(of(null));

    service.getEstados().subscribe((list) => {
      expect(list).toEqual([]);
      done();
    });

    const req = httpMock.expectOne(ESTADOS_URL);
    req.flush('erro', { status: 500, statusText: 'Server Error' });
  });

  it('deve retornar [] imediatamente se getMunicipios for chamado com UF vazia', (done) => {
    service.getMunicipios('  ').subscribe((list) => {
      expect(list).toEqual([]);
      done();
    });
    httpMock.expectNone(req =>
      /\/localidades\/estados\/[^/]+\/municipios(?:$|\?)/.test(req.urlWithParams)
    );
  });

  it('getUserLocation: deve vir do cache quando existir', (done) => {
    const cached: UserLocation = { uf: 'RJ', municipio: 'Duque de Caxias' };
    cache.get.and.returnValue(of(cached));

    service.getUserLocation().subscribe((loc) => {
      expect(loc).toEqual(cached);
      done();
    });
  });

  it('getUserLocation: quando cache estiver vazio, deve derivar do usuário do store e persistir', (done) => {
    cache.get.and.returnValue(of(null));
    userStore.user$.next({ estado: 'rj', municipio: 'Rio de Janeiro' });

    service.getUserLocation().subscribe((loc) => {
      expect(loc).toEqual({ uf: 'RJ', municipio: 'Rio de Janeiro' });
      expect(cache.set).toHaveBeenCalledWith('user:location', { uf: 'RJ', municipio: 'Rio de Janeiro' });
      done();
    });
  });

  it('updateUserLocation: deve setar no cache quando role >= premium', (done) => {
    access.hasAtLeast$.and.returnValue(of(true));

    service.updateUserLocation({ uf: 'rj', municipio: 'Niterói' });

    // como é async por subscribe interno, aguarde microtask
    setTimeout(() => {
      expect(cache.set).toHaveBeenCalledWith('user:location', { uf: 'RJ', municipio: 'Niterói' });
      done();
    });
  });

  it('updateUserLocation: não deve setar no cache quando role for insuficiente', (done) => {
    access.hasAtLeast$.and.returnValue(of(false));

    service.updateUserLocation({ uf: 'SP', municipio: 'Campinas' });

    setTimeout(() => {
      // não chamou set com o par correto
      const calls = cache.set.calls.allArgs();
      const calledWithUserKey = calls.some(args => args[0] === 'user:location');
      expect(calledWithUserKey).toBeFalse();
      done();
    });
  });

  it('clearUserLocationCache: deve deletar a chave no cache', () => {
    service.clearUserLocationCache();
    expect(cache.delete).toHaveBeenCalledWith('user:location');
  });

  it('warmCaches: deve disparar getEstados e getMunicipios (quando uf fornecida)', () => {
    const spyEstados = spyOn(service as any, 'getEstados').and.returnValue(of([]));
    const spyMunicipios = spyOn(service as any, 'getMunicipios').and.returnValue(of([]));

    service.warmCaches('RJ');

    expect(spyEstados).toHaveBeenCalled();
    expect(spyMunicipios).toHaveBeenCalledWith('RJ');
  });
});
