import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  ParamMap,
  convertToParamMap,
} from '@angular/router';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import { MediaApplicationErrorService } from 'src/app/core/services/media/media-application-error.service';
import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
import {
  IPublicProfilePhotoCursor,
  IPublicProfilePhotoPage,
  PublicProfilePhotoPaginationService,
} from 'src/app/core/services/media/public-profile-photo-pagination.service';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';
import { PublicPhotoViewerLauncherService } from '../photo-viewer/public-photo-viewer-launcher.service';
import {
  PublicProfilePhotosComponent,
  resolvePublicProfilePhotoPageSize,
} from './public-profile-photos.component';

const PHOTO: IPublicPhotoItem = {
  id: 'photo-1',
  ownerUid: 'owner-1',
  createdAt: 1,
  publishedAt: 100,
  orderIndex: 0,
  visibility: 'PUBLIC',
  moderationStatus: 'APPROVED',
  assetAccess: 'SIGNED_URL',
  url: 'https://example.test/photo-1.jpg',
};

const SECOND: IPublicPhotoItem = {
  ...PHOTO,
  id: 'photo-2',
  orderIndex: 1,
  url: 'https://example.test/photo-2.jpg',
};

const OTHER: IPublicPhotoItem = {
  ...PHOTO,
  id: 'photo-other',
  ownerUid: 'owner-2',
  url: 'https://example.test/photo-other.jpg',
};

const CURSOR: IPublicProfilePhotoCursor = {
  documentId: PHOTO.id,
  orderIndex: PHOTO.orderIndex,
  publishedAt: PHOTO.publishedAt,
};

function page(
  items: readonly IPublicPhotoItem[],
  nextCursor: IPublicProfilePhotoCursor | null
): IPublicProfilePhotoPage {
  return {
    items,
    nextCursor,
    hasMore: nextCursor !== null,
  };
}

describe('PublicProfilePhotosComponent / paginação pública', () => {
  let component: PublicProfilePhotosComponent;
  let routeParams: BehaviorSubject<ParamMap>;
  let pagination: { loadPage$: ReturnType<typeof vi.fn> };
  let viewer: { open$: ReturnType<typeof vi.fn> };
  let errors: { report: ReturnType<typeof vi.fn> };
  let publicUsers: { getPublicUserById$: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    routeParams = new BehaviorSubject<ParamMap>(
      convertToParamMap({ id: PHOTO.ownerUid })
    );

    pagination = {
      loadPage$: vi.fn((
        ownerUid: string,
        options?: { cursor?: IPublicProfilePhotoCursor | null }
      ) => {
        if (ownerUid === OTHER.ownerUid) {
          return of(page([OTHER], null));
        }

        return options?.cursor
          ? of(page([SECOND, PHOTO], null))
          : of(page([PHOTO], CURSOR));
      }),
    };

    viewer = {
      open$: vi.fn(() => of(void 0)),
    };

    errors = {
      report: vi.fn(),
    };
    publicUsers = {
      getPublicUserById$: vi.fn((uid: string) => of({
        uid, nickname: uid === PHOTO.ownerUid ? 'Perfil de teste' : 'Outro perfil',
        photoURL: 'https://example.test/avatar.png',
        municipio: 'Rio de Janeiro', estado: 'RJ',
        identityCode: 'casal-ele-ela',
        identityLabel: 'Casal (Ele/Ela)',
        orientation: 'bissexual',
      })),
    };

    TestBed.configureTestingModule({
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { paramMap: routeParams.asObservable() },
        },
        {
          provide: PublicProfilePhotoPaginationService,
          useValue: pagination,
        },
        {
          provide: FirestoreUserQueryService,
          useValue: publicUsers,
        },
        {
          provide: PublicPhotoViewerLauncherService,
          useValue: viewer,
        },
        {
          provide: MediaApplicationErrorService,
          useValue: errors,
        },
        {
          provide: PrivacyDebugLoggerService,
          useValue: { log: vi.fn() },
        },
      ],
    });

    component = TestBed.runInInjectionContext(
      () => new PublicProfilePhotosComponent()
    );

    // O componente criado diretamente não executa ngAfterViewInit.
    // A dimensão inicial é injetada explicitamente nestes testes.
    component['pageSizeSubject'].next(24);
  });

  it('identifica o perfil usando somente a leitura pública autorizada', () => {
    const identities: Array<{ nickname: string; city?: string | null } | null> = [];
    const subscription = component.profileIdentity$.subscribe(identity => identities.push(identity));

    expect(publicUsers.getPublicUserById$).toHaveBeenCalledWith(PHOTO.ownerUid);
    expect(identities.at(-1)).toMatchObject({
      nickname: 'Perfil de teste',
      city: 'Rio de Janeiro',
      state: 'RJ',
      identityLabel: 'Casal (Ele/Ela)',
      orientationShortLabel: 'Bi',
    });
    subscription.unsubscribe();
  });

  it('prioriza o catálogo diante de rótulos divergentes', () => {
    publicUsers.getPublicUserById$.mockReturnValue(of({
      uid: PHOTO.ownerUid,
      nickname: 'Perfil de teste',
      identityCode: 'casal-ela-ela',
      identityLabel: 'Rótulo divergente',
    }));
    const identities: Array<{ identityLabel: string | null } | null> = [];
    const subscription = component.profileIdentity$.subscribe(identity => identities.push(identity));
    expect(identities.at(-1)?.identityLabel).toBe('Casal (Ela/Ela)');
    subscription.unsubscribe();
  });

  it('não inventa classificação sem código público reconhecido', () => {
    publicUsers.getPublicUserById$.mockReturnValue(of({
      uid: PHOTO.ownerUid, nickname: 'Perfil de teste', identityCode: 'desconhecido',
    }));
    const identities: Array<{ identityLabel: string | null } | null> = [];
    const subscription = component.profileIdentity$.subscribe(identity => identities.push(identity));
    expect(identities.at(-1)?.identityLabel).toBeNull();
    subscription.unsubscribe();
  });

  it('não mostra identidade de outro UID e descarta resultados atrasados', () => {
    const pending = new Subject<{ uid: string; nickname: string } | null>();
    publicUsers.getPublicUserById$.mockImplementation((uid: string) => (
      uid === PHOTO.ownerUid ? pending : of({ uid, nickname: 'Outro perfil' })
    ));
    const identities: Array<{ nickname: string } | null> = [];
    const subscription = component.profileIdentity$.subscribe(identity => identities.push(identity));

    routeParams.next(convertToParamMap({ id: OTHER.ownerUid }));
    pending.next({ uid: PHOTO.ownerUid, nickname: 'Identidade antiga' });

    expect(identities.at(-1)?.nickname).toBe('Outro perfil');
    expect(identities.some(identity => identity?.nickname === 'Identidade antiga')).toBe(false);
    subscription.unsubscribe();
  });

  it('não revela identificação quando a leitura pública falha ou não corresponde', () => {
    publicUsers.getPublicUserById$.mockReturnValue(of({
      uid: OTHER.ownerUid, nickname: 'Nome não autorizado',
    }));
    const identities: Array<{ nickname: string } | null> = [];
    const subscription = component.profileIdentity$.subscribe(identity => identities.push(identity));
    expect(identities.at(-1)).toBeNull();
    subscription.unsubscribe();
  });

  it('seleciona 8, 12 ou 24 conforme as colunas do contêiner', () => {
    expect(resolvePublicProfilePhotoPageSize(360)).toBe(8);
    expect(resolvePublicProfilePhotoPageSize(380)).toBe(8);
    expect(resolvePublicProfilePhotoPageSize(399)).toBe(8);
    expect(resolvePublicProfilePhotoPageSize(400)).toBe(12);
    expect(resolvePublicProfilePhotoPageSize(552)).toBe(12);
    expect(resolvePublicProfilePhotoPageSize(559)).toBe(12);
    expect(resolvePublicProfilePhotoPageSize(560)).toBe(12);
    expect(resolvePublicProfilePhotoPageSize(759)).toBe(12);
    expect(resolvePublicProfilePhotoPageSize(760)).toBe(24);
    expect(resolvePublicProfilePhotoPageSize(1100)).toBe(24);
  });

  it('espera conhecer a largura antes da primeira consulta', () => {
    component['pageSizeSubject'].next(null);

    const states: string[] = [];
    const subscription = component.state$.subscribe(
      (state) => states.push(state.status)
    );

    expect(pagination.loadPage$).not.toHaveBeenCalled();
    expect(states.at(-1)).toBe('loading');

    component['pageSizeSubject'].next(8);

    expect(pagination.loadPage$).toHaveBeenCalledWith(
      PHOTO.ownerUid,
      { pageSize: 8 }
    );

    expect(states.at(-1)).toBe('ready');
    subscription.unsubscribe();
  });

  it('usa lote de 12 fotos quando o contêiner tem duas colunas', () => {
    component['pageSizeSubject'].next(12);

    const subscription = component.state$.subscribe();

    expect(pagination.loadPage$).toHaveBeenCalledWith(
      PHOTO.ownerUid,
      { pageSize: 12 }
    );

    subscription.unsubscribe();
  });

  it('não reinicia a galeria quando o tamanho muda', () => {
    const states: IPublicPhotoItem[][] = [];
    const subscription = component.state$.subscribe(
      (state) => states.push([...state.items])
    );

    expect(pagination.loadPage$).toHaveBeenCalledTimes(1);

    component['pageSizeSubject'].next(8);

    expect(pagination.loadPage$).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toEqual([PHOTO]);

    component.loadMorePhotos();

    expect(pagination.loadPage$).toHaveBeenLastCalledWith(
      PHOTO.ownerUid,
      { cursor: CURSOR, pageSize: 8 }
    );

    expect(states.at(-1)).toEqual([PHOTO, SECOND]);
    subscription.unsubscribe();
  });
  it('carrega a primeira página pelo serviço público paginado', () => {
    const states: Array<{ status: string; items: readonly IPublicPhotoItem[] }> = [];
    const subscription = component.state$.subscribe(
      (state) => states.push(state)
    );

    expect(pagination.loadPage$).toHaveBeenCalledWith(PHOTO.ownerUid, { pageSize: 24 });
    expect(states.at(-1)).toMatchObject({
      status: 'ready',
      items: [PHOTO],
    });

    subscription.unsubscribe();
  });

  it('carrega mais fotos, preserva a ordem e elimina duplicações', () => {
    const states: Array<{
      items: readonly IPublicPhotoItem[];
      hasMore: boolean;
    }> = [];

    const subscription = component.state$.subscribe(
      (state) => states.push(state)
    );

    component.loadMorePhotos();

    expect(pagination.loadPage$).toHaveBeenLastCalledWith(
      PHOTO.ownerUid,
      { cursor: CURSOR, pageSize: 24 }
    );

    expect(states.at(-1)).toMatchObject({
      items: [PHOTO, SECOND],
      hasMore: false,
    });

    subscription.unsubscribe();
  });

  it('impede requisições simultâneas para a próxima página', () => {
    const pending = new Subject<IPublicProfilePhotoPage>();

    pagination.loadPage$.mockImplementation((
      _ownerUid: string,
      options?: { cursor?: IPublicProfilePhotoCursor | null }
    ) => options?.cursor
      ? pending
      : of(page([PHOTO], CURSOR))
    );

    const states: Array<{
      loadingMore: boolean;
      items: readonly IPublicPhotoItem[];
    }> = [];

    const subscription = component.state$.subscribe(
      (state) => states.push(state)
    );

    component.loadMorePhotos();
    component.loadMorePhotos();

    expect(pagination.loadPage$).toHaveBeenCalledTimes(2);
    expect(states.at(-1)?.loadingMore).toBe(true);

    pending.next(page([SECOND], null));

    expect(states.at(-1)).toMatchObject({
      loadingMore: false,
      items: [PHOTO, SECOND],
    });

    subscription.unsubscribe();
  });

  it('preserva fotos quando uma página falha e permite tentar novamente', () => {
    let attempts = 0;

    pagination.loadPage$.mockImplementation((
      _ownerUid: string,
      options?: { cursor?: IPublicProfilePhotoCursor | null }
    ) => {
      if (!options?.cursor) {
        return of(page([PHOTO], CURSOR));
      }

      attempts += 1;

      return attempts === 1
        ? throwError(() => new Error('network error'))
        : of(page([SECOND], null));
    });

    const states: Array<{
      items: readonly IPublicPhotoItem[];
      hasMore: boolean;
      pageError: boolean;
    }> = [];

    const subscription = component.state$.subscribe(
      (state) => states.push(state)
    );

    component.loadMorePhotos();

    expect(states.at(-1)).toMatchObject({
      items: [PHOTO],
      hasMore: true,
      pageError: true,
    });

    component.loadMorePhotos();

    expect(states.at(-1)).toMatchObject({
      items: [PHOTO, SECOND],
      hasMore: false,
      pageError: false,
    });

    subscription.unsubscribe();
  });

  it('ignora página atrasada depois da troca de proprietário', () => {
    const pending = new Subject<IPublicProfilePhotoPage>();

    pagination.loadPage$.mockImplementation((
      ownerUid: string,
      options?: { cursor?: IPublicProfilePhotoCursor | null }
    ) => {
      if (ownerUid === OTHER.ownerUid) {
        return of(page([OTHER], null));
      }

      return options?.cursor
        ? pending
        : of(page([PHOTO], CURSOR));
    });

    const states: Array<{
      ownerUid: string;
      items: readonly IPublicPhotoItem[];
    }> = [];

    const subscription = component.state$.subscribe(
      (state) => states.push(state)
    );

    component.loadMorePhotos();

    routeParams.next(convertToParamMap({ id: OTHER.ownerUid }));

    pending.next(page([SECOND], null));

    expect(states.at(-1)).toMatchObject({
      ownerUid: OTHER.ownerUid,
      items: [OTHER],
    });

    subscription.unsubscribe();
  });

  it('ignora página atrasada após retry do mesmo perfil', () => {
    const pending = new Subject<IPublicProfilePhotoPage>();

    pagination.loadPage$.mockImplementation((
      _ownerUid: string,
      options?: { cursor?: IPublicProfilePhotoCursor | null }
    ) => options?.cursor
      ? pending
      : of(page([PHOTO], CURSOR))
    );

    const states: Array<{
      items: readonly IPublicPhotoItem[];
      hasMore: boolean;
    }> = [];

    const subscription = component.state$.subscribe(
      (state) => states.push(state)
    );

    component.loadMorePhotos();
    component.retry();

    pending.next(page([SECOND], null));

    expect(states.at(-1)).toMatchObject({
      items: [PHOTO],
      hasMore: true,
    });

    subscription.unsubscribe();
  });

  it('abre a foto correta no viewer com os itens já carregados', () => {
    const subscription = component.state$.subscribe();

    component.loadMorePhotos();
    component.openPhoto(1, SECOND);

    expect(viewer.open$).toHaveBeenCalledWith({
      items: [PHOTO, SECOND],
      selected: SECOND,
      source: 'profile',
    });

    subscription.unsubscribe();
  });

  it('não abre índices inválidos nem cartões obsoletos', () => {
    const subscription = component.state$.subscribe();

    component.openPhoto(-1);
    component.openPhoto(99);
    component.openPhoto(0, SECOND);
    component.openPhoto(0, {
      id: PHOTO.id,
      ownerUid: OTHER.ownerUid,
    });

    expect(viewer.open$).not.toHaveBeenCalled();

    component.openPhoto(0, PHOTO);

    expect(viewer.open$).toHaveBeenCalledTimes(1);

    subscription.unsubscribe();
  });

  it('descarta itens e não consulta o backend sem proprietário', () => {
    const states: Array<{
      status: string;
      items: readonly IPublicPhotoItem[];
    }> = [];

    const subscription = component.state$.subscribe(
      (state) => states.push(state)
    );

    routeParams.next(convertToParamMap({}));

    expect(states.at(-1)).toMatchObject({
      status: 'empty',
      items: [],
    });

    expect(pagination.loadPage$).toHaveBeenCalledTimes(1);

    subscription.unsubscribe();
  });

  it('recupera o carregamento inicial após uma falha', () => {
    pagination.loadPage$
      .mockImplementationOnce(() =>
        throwError(() => new Error('initial error'))
      );

    const states: Array<{
      status: string;
      items: readonly IPublicPhotoItem[];
    }> = [];

    const subscription = component.state$.subscribe(
      (state) => states.push(state)
    );

    expect(states.at(-1)?.status).toBe('error');

    component.retry();

    expect(states.at(-1)).toMatchObject({
      status: 'ready',
      items: [PHOTO],
    });

    expect(errors.report).toHaveBeenCalledTimes(1);

    subscription.unsubscribe();
  });
});
describe('PublicProfilePhotosComponent / inicialização da view', () => {
  it('mede o contêiner, usa a nova largura na próxima página e desconecta o observador', () => {
    const loadPage$ = vi.fn(() => of(page([PHOTO], CURSOR)));
    const observe = vi.fn();
    const disconnect = vi.fn();
    let onResize!: ResizeObserverCallback;
    const originalObserver = globalThis.ResizeObserver;
    const widthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockReturnValue(360);

    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) { onResize = callback; }
      observe = observe;
      unobserve = vi.fn();
      disconnect = disconnect;
    };

    try {
      TestBed.configureTestingModule({
        imports: [PublicProfilePhotosComponent],
        providers: [
          { provide: ActivatedRoute, useValue: {
            paramMap: of(convertToParamMap({ id: PHOTO.ownerUid })),
          } },
          { provide: PublicProfilePhotoPaginationService, useValue: { loadPage$ } },
          { provide: FirestoreUserQueryService, useValue: { getPublicUserById$: vi.fn(() => of(null)) } },
          { provide: PublicPhotoViewerLauncherService, useValue: { open$: vi.fn() } },
          { provide: MediaApplicationErrorService, useValue: { report: vi.fn() } },
          { provide: PrivacyDebugLoggerService, useValue: { log: vi.fn() } },
        ],
      });
      TestBed.overrideComponent(PublicProfilePhotosComponent, {
        set: { imports: [], template: '<section #galleryContainer></section>' },
      });
      const fixture = TestBed.createComponent(PublicProfilePhotosComponent);
      const subscription = fixture.componentInstance.state$.subscribe();

      try {
        expect(loadPage$).not.toHaveBeenCalled();
        fixture.detectChanges();
        expect(loadPage$).toHaveBeenCalledExactlyOnceWith(PHOTO.ownerUid, { pageSize: 8 });

        const container = fixture.nativeElement.querySelector('section');
        expect(observe).toHaveBeenCalledWith(container);
        onResize([{ target: container, contentRect: { width: 552 } } as ResizeObserverEntry],
          {} as ResizeObserver);
        expect(loadPage$).toHaveBeenCalledTimes(1);
        fixture.componentInstance.loadMorePhotos();
        expect(loadPage$).toHaveBeenLastCalledWith(PHOTO.ownerUid, { cursor: CURSOR, pageSize: 12 });
      } finally {
        subscription.unsubscribe();
        fixture.destroy();
      }
      expect(disconnect).toHaveBeenCalledTimes(1);
    } finally {
      widthSpy.mockRestore();
      globalThis.ResizeObserver = originalObserver;
    }
  });
});
