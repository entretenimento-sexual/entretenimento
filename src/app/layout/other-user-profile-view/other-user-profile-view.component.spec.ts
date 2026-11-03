// src/app/layout/other-user-profile-view/other-user-profile-view.component.spec.ts
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Firestore } from '@angular/fire/firestore';
import { ActivatedRoute, Router, convertToParamMap, type ParamMap } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { Store } from '@ngrx/store';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IUserDados } from '../../core/interfaces/iuser-dados';
import { CommunityPreviewRepository } from '../../community/data-access/community-preview.repository';
import { CommunityProfilePublicCommunitiesRepository } from '../../community/data-access/community-profile-public-communities.repository';
import { ProfileOfficialCommunitiesComponent } from '../../community/profile-official-communities/profile-official-communities.component';
import { OtherUserProfileViewComponent } from './other-user-profile-view.component';
import { AccessControlService } from '../../core/services/autentication/auth/access-control.service';
import { AuthSessionService } from '../../core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from '../../core/services/autentication/auth/current-user-store.service';
import { FirestoreUserQueryService } from '../../core/services/data-handling/firestore-user-query.service';
import { ApplicationErrorService } from '../../core/services/error-handler/application-error.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';
import { FriendshipService } from '../../core/services/interactions/friendship/friendship.service';
import { MediaPublicPreviewQueryService } from '../../core/services/media/media-public-preview-query.service';
import { PrivacyDebugLoggerService } from '../../core/services/privacy/privacy-debug-logger.service';
import { UserSocialLinksService } from '../../core/services/user-profile/user-social-links.service';
import { PublicMixedMediaViewerLauncherService } from '../../media/shared/services/public-mixed-media-viewer-launcher.service';
import { DirectChatService } from '../../messaging/direct-chat/services/direct-chat.service';
import { UserIntentStatusService } from '../../core/services/discovery/user-intent-status.service';
import { SocialLinksAccordionComponent } from '../../user-profile/user-profile-view/user-social-links-accordion/user-social-links-accordion.component';

describe('OtherUserProfileViewComponent', () => {
  let fixture: ComponentFixture<OtherUserProfileViewComponent>;
  let component: OtherUserProfileViewComponent;
  let routeParamMap$: BehaviorSubject<ParamMap>;

  const targetUid = 'target-uid';
  const targetProfileId = 'profile-12345678-1234-4123-8123-123456789abc';
  const viewerUid = 'viewer-uid';

  beforeEach(async () => {
    routeParamMap$ = new BehaviorSubject<ParamMap>(convertToParamMap({ id: targetUid }));
    await TestBed.configureTestingModule({
      imports: [
        OtherUserProfileViewComponent,
        RouterTestingModule,
        NoopAnimationsModule,
      ],
      providers: [
        { provide: Firestore, useValue: {} },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: routeParamMap$,
            snapshot: {
              paramMap: convertToParamMap({ id: targetUid }),
            },
          },
        },
        {
          provide: Store,
          useValue: {
            select: vi.fn(() =>
              of({ uid: viewerUid, role: 'free', isSubscriber: false })
            ),
          },
        },
        {
          provide: FirestoreUserQueryService,
          useValue: {
            getPublicUserById$: vi.fn(() =>
              of({
                uid: targetUid,
                profileId: targetProfileId,
                nickname: 'Pessoa alvo',
                email: null,
                photoURL: 'https://example.test/profile.jpg',
                role: 'premium',
                lastLogin: Date.now(),
                descricao: 'Descrição direta do perfil.',
                isSubscriber: true,
                isOnline: true,
                gender: 'Mulher',
                idade: 32,
                orientation: 'bissexual',
                estado: 'RJ',
                municipio: 'Rio de Janeiro',
                distanciaKm: 8,
                preferenceBadgesVisible: true,
                publicRelationshipIntents: ['serious'],
                publicSexualPractices: ['bdsm'],
                publicBodyTraits: ['tattoos'],
              })
            ),
          },
        },
        {
          provide: CommunityPreviewRepository,
          useValue: {
            getOfficialCommunitiesForTarget$: vi.fn(() =>
              of({ items: [], nextCursor: null, generatedAt: Date.now() })
            ),
          },
        },
        {
          provide: CommunityProfilePublicCommunitiesRepository,
          useValue: {
            getProfilePublicCommunities$: vi.fn(() =>
              of({ items: [], nextCursor: null, generatedAt: Date.now() })
            ),
          },
        },
        {
          provide: ApplicationErrorService,
          useValue: {
            report: vi.fn(),
          },
        },
        {
          provide: MediaPublicPreviewQueryService,
          useValue: {
            getProfilePublicMediaPreview$: vi.fn(() => of({
              items: [],
              photosCount: 0,
              videosCount: 0,
              totalCount: 0,
            })),
          },
        },
        {
          provide: PublicMixedMediaViewerLauncherService,
          useValue: {
            open$: vi.fn(() => of(void 0)),
          },
        },
        {
          provide: AuthSessionService,
          useValue: {
            uid$: of(viewerUid),
            authUser$: of({ uid: viewerUid }),
            ready$: of(true),
          },
        },
        {
          provide: AccessControlService,
          useValue: {
            isSubscriber$: of(false),
          },
        },
        {
          provide: FriendshipService,
          useValue: {
            sendRequest: vi.fn(() => of(void 0)),
            watchOutboundRequests: vi.fn(() => of([])),
            watchFriends: vi.fn(() => of([])),
            watchBlocked: vi.fn(() => of(false)),
          },
        },
        {
          provide: DirectChatService,
          useValue: {
            ensureDirectChatIdWithUser$: vi.fn(() => of('chat-id')),
          },
        },
        {
          provide: UserIntentStatusService,
          useValue: {
            watchActiveStatusesForUserRegion$: vi.fn(() => of([])),
            watchActiveStatusesForRegion$: vi.fn(() =>
              of([
                {
                  id: 'current_target-uid',
                  uid: targetUid,
                  profile: { uid: targetUid, nickname: 'Pessoa alvo' },
                  availability: 'available_now',
                  visibility: 'public_discovery',
                  destination: {
                    kind: 'region',
                    label: 'Rio de Janeiro',
                    region: { uf: 'RJ', city: 'rio de janeiro' },
                  },
                  moderation: { state: 'active' },
                  startsAt: Date.now() - 1_000,
                  expiresAt: Date.now() + 60_000,
                  ageEligibilityValidUntil: Date.now() + 60_000,
                  destinationLabel: 'Rio de Janeiro',
                  availabilityLabel: 'Disponível agora',
                  expiresInLabel: 'Expira em até 1h',
                  isActive: true,
                },
              ])
            ),
            watchCurrentStatus$: vi.fn(() =>
              of({
                id: 'current_viewer-uid',
                uid: viewerUid,
                profile: { uid: viewerUid, nickname: 'Viewer' },
                availability: 'available_now',
                visibility: 'public_discovery',
                destination: {
                  kind: 'region',
                  label: 'Rio de Janeiro',
                  region: { uf: 'RJ', city: 'rio de janeiro' },
                },
                moderation: { state: 'active' },
                startsAt: Date.now() - 1_000,
                expiresAt: Date.now() + 60_000,
                ageEligibilityValidUntil: Date.now() + 60_000,
                destinationLabel: 'Rio de Janeiro',
                availabilityLabel: 'Disponível agora',
                expiresInLabel: 'Expira em até 1h',
                isActive: true,
              })
            ),
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showSuccess: vi.fn(),
            showError: vi.fn(),
            showWarning: vi.fn(),
          },
        },
        {
          provide: PrivacyDebugLoggerService,
          useValue: {
            log: vi.fn(),
          },
        },
        {
          provide: UserSocialLinksService,
          useValue: {
            watchSocialLinks: vi.fn(() => of(null)),
          },
        },
        {
          provide: CurrentUserStoreService,
          useValue: {
            user$: of({
              uid: viewerUid,
              role: 'basic',
              isSubscriber: true,
              billingProjectionVersion: 1,
              subscriptionStatus: 'active',
              subscriptionScope: 'platform_subscription',
              subscriptionStartedAt: Date.now() - 60_000,
              subscriptionEndsAt: Date.now() + 60_000,
              discoveryPreferences: {
                genderInterests: [],
                relationshipIntents: ['serious'],
                acceptsCouples: true,
                acceptsSingles: true,
                acceptsTransProfiles: null,
                ageRange: null,
                maxDistanceKm: null,
                locationRequired: false,
                relationshipIntentMode: 'prefer',
                sexualPractices: ['bdsm'],
                sexualPracticeMode: 'prefer',
                bodyPreferences: ['tattoos'],
                bodyPreferenceMode: 'prefer',
                updatedAt: 1,
              },
            }),
            getSnapshot: () => ({
              uid: viewerUid,
              role: 'basic',
              isSubscriber: true,
              billingProjectionVersion: 1,
              subscriptionStatus: 'active',
              subscriptionScope: 'platform_subscription',
              subscriptionStartedAt: Date.now() - 60_000,
              subscriptionEndsAt: Date.now() + 60_000,
              discoveryPreferences: {
                genderInterests: [],
                relationshipIntents: ['serious'],
                acceptsCouples: true,
                acceptsSingles: true,
                acceptsTransProfiles: null,
                ageRange: null,
                maxDistanceKm: null,
                locationRequired: false,
                relationshipIntentMode: 'prefer',
                sexualPractices: ['bdsm'],
                sexualPracticeMode: 'prefer',
                bodyPreferences: ['tattoos'],
                bodyPreferenceMode: 'prefer',
                updatedAt: 1,
              },
            }),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OtherUserProfileViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('troca de perfil na mesma instância limpa a identidade antiga e preserva a rota atual', () => {
    const query = TestBed.inject(FirestoreUserQueryService);
    const profileA = component.userProfile!;
    const pendingB$ = new Subject<IUserDados | null>();
    vi.mocked(query.getPublicUserById$).mockImplementation((uid) =>
      uid === 'profile-b'
        ? pendingB$.asObservable()
        : of({ ...profileA, uid, nickname: 'Pessoa C' })
    );

    routeParamMap$.next(convertToParamMap({ id: 'profile-b' }));
    fixture.detectChanges();

    expect(component.uid).toBe('profile-b');
    expect(component.userProfile).toBeNull();
    expect(component.isLoading).toBe(true);
    expect(fixture.nativeElement.querySelector('.other-profile-page__hero')).toBeNull();

    routeParamMap$.next(convertToParamMap({ id: 'profile-c' }));
    fixture.detectChanges();

    expect(component.uid).toBe('profile-c');
    expect(component.userProfile?.nickname).toBe('Pessoa C');

    // An obsolete request may finish after the router has changed owners.
    pendingB$.next({ ...profileA, uid: 'profile-b', nickname: 'Pessoa B' });
    pendingB$.complete();
    fixture.detectChanges();

    expect(component.uid).toBe('profile-c');
    expect(component.userProfile?.nickname).toBe('Pessoa C');
    expect(fixture.nativeElement.textContent).not.toContain('Pessoa B');
  });

  it('não oferece interesse se o estado da amizade falhar, e permite recarregar', () => {
    const friendship = TestBed.inject(FriendshipService);
    const applicationError = TestBed.inject(ApplicationErrorService);
    const query = TestBed.inject(FirestoreUserQueryService);
    const profile = component.userProfile!;
    vi.mocked(query.getPublicUserById$).mockImplementation((uid) =>
      of({ ...profile, uid, nickname: 'Pessoa B' })
    );
    vi.mocked(friendship.watchFriends)
      .mockImplementationOnce(() => throwError(() => new Error('network failed')))
      .mockImplementation(() => of([]));

    routeParamMap$.next(convertToParamMap({ id: 'profile-b' }));
    fixture.detectChanges();

    const actions = fixture.nativeElement.querySelector(
      '.other-profile-page__actions'
    ) as HTMLElement;
    const retry = actions.querySelector('button') as HTMLButtonElement;
    expect(retry.textContent).toContain('Verificar conexão');
    expect(retry.getAttribute('aria-label')).toContain('Pessoa B');
    expect(actions.textContent).not.toContain('Mostrar interesse');
    expect(applicationError.report).toHaveBeenCalled();

    retry.click();
    fixture.detectChanges();

    expect(actions.textContent).toContain('Mostrar interesse');
    expect(vi.mocked(friendship.watchFriends)).toHaveBeenCalledTimes(3);
  });

  it('cancela feedback de interesse antigo ao navegar para outro perfil', () => {
    const friendship = TestBed.inject(FriendshipService);
    const notifications = TestBed.inject(ErrorNotificationService);
    const query = TestBed.inject(FirestoreUserQueryService);
    const currentProfile = component.userProfile!;
    const pending$ = new Subject<void>();
    vi.mocked(friendship.sendRequest).mockReturnValue(pending$.asObservable());
    vi.mocked(query.getPublicUserById$).mockImplementation((uid) =>
      of({ ...currentProfile, uid, nickname: 'Pessoa B' })
    );

    component.sendFriendRequest();
    expect(component.friendRequestBusy$.value).toBe(true);
    expect(friendship.sendRequest).toHaveBeenCalledWith(
      viewerUid, targetUid, expect.any(String)
    );

    routeParamMap$.next(convertToParamMap({ id: 'profile-b' }));
    fixture.detectChanges();

    expect(component.uid).toBe('profile-b');
    expect(component.friendRequestBusy$.value).toBe(false);
    expect(pending$.observers.length).toBe(0);

    // A write initiated against A could still commit remotely; the component
    // must not claim that A's action was completed on B's screen.
    pending$.next();
    pending$.complete();
    expect(notifications.showSuccess).not.toHaveBeenCalled();
  });

  it('não abre conversa do perfil anterior após uma troca de rota', () => {
    const friendship = TestBed.inject(FriendshipService);
    vi.mocked(friendship.watchFriends).mockReturnValue(
      of([{ friendUid: targetUid }] as any)
    );
    fixture.destroy();
    fixture = TestBed.createComponent(OtherUserProfileViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    const chat = TestBed.inject(DirectChatService);
    const notifications = TestBed.inject(ErrorNotificationService);
    const query = TestBed.inject(FirestoreUserQueryService);
    const router = TestBed.inject(Router);
    const currentProfile = component.userProfile!;
    const pending$ = new Subject<string>();
    vi.mocked(chat.ensureDirectChatIdWithUser$)
      .mockReturnValue(pending$.asObservable());
    vi.mocked(query.getPublicUserById$).mockImplementation((uid) =>
      of({ ...currentProfile, uid, nickname: 'Pessoa B' })
    );
    const navigate = vi.spyOn(router, 'navigate');

    component.startDirectChat();
    expect(component.directChatBusy$.value).toBe(true);
    expect(chat.ensureDirectChatIdWithUser$).toHaveBeenCalledWith(targetUid);

    routeParamMap$.next(convertToParamMap({ id: 'profile-b' }));
    fixture.detectChanges();

    expect(component.uid).toBe('profile-b');
    expect(component.directChatBusy$.value).toBe(false);
    expect(pending$.observers.length).toBe(0);

    pending$.next('old-profile-chat-id');
    pending$.complete();
    expect(notifications.showSuccess).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalledWith(
      ['/chat'], expect.anything()
    );
  });

  it('revoga ações sociais imediatamente após bloqueio próprio e as restaura ao desbloquear', () => {
    const friendship = TestBed.inject(FriendshipService);
    const chat = TestBed.inject(DirectChatService);
    const blocked$ = new BehaviorSubject(false);
    vi.mocked(friendship.watchBlocked).mockReturnValue(blocked$.asObservable());

    fixture.destroy();
    fixture = TestBed.createComponent(OtherUserProfileViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    let actions = fixture.nativeElement.querySelector(
      '.other-profile-page__actions'
    ) as HTMLElement;
    expect(actions.textContent).toContain('Mostrar interesse');

    blocked$.next(true);
    fixture.detectChanges();
    actions = fixture.nativeElement.querySelector('.other-profile-page__actions');
    expect(actions.textContent).toContain('Interação indisponível');
    expect(actions.querySelector('button')).toBeNull();

    component.sendFriendRequest();
    component.startDirectChat();
    expect(friendship.sendRequest).not.toHaveBeenCalled();
    expect(chat.ensureDirectChatIdWithUser$).not.toHaveBeenCalled();

    blocked$.next(false);
    fixture.detectChanges();
    actions = fixture.nativeElement.querySelector('.other-profile-page__actions');
    expect(actions.textContent).toContain('Mostrar interesse');
  });

  it('cancela chat pendente se surgir bloqueio ou amizade for encerrada', () => {
    const friendship = TestBed.inject(FriendshipService);
    const chat = TestBed.inject(DirectChatService);
    const router = TestBed.inject(Router);
    const blocked$ = new BehaviorSubject(false);
    const friends$ = new BehaviorSubject([{ friendUid: targetUid }] as any);
    const pending$ = new Subject<string>();
    vi.mocked(friendship.watchBlocked).mockReturnValue(blocked$.asObservable());
    vi.mocked(friendship.watchFriends).mockReturnValue(friends$.asObservable());
    vi.mocked(chat.ensureDirectChatIdWithUser$).mockReturnValue(pending$.asObservable());
    const navigate = vi.spyOn(router, 'navigate');

    fixture.destroy();
    fixture = TestBed.createComponent(OtherUserProfileViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    component.startDirectChat();
    expect(chat.ensureDirectChatIdWithUser$).toHaveBeenCalledWith(targetUid);
    expect(pending$.observers.length).toBeGreaterThan(0);

    blocked$.next(true);
    fixture.detectChanges();
    expect(pending$.observers.length).toBe(0);
    expect(component.directChatBusy$.value).toBe(false);
    pending$.next('chat-revoked');
    expect(navigate).not.toHaveBeenCalled();

    blocked$.next(false);
    fixture.detectChanges();
    const second$ = new Subject<string>();
    vi.mocked(chat.ensureDirectChatIdWithUser$).mockReturnValue(second$.asObservable());
    component.startDirectChat();
    expect(second$.observers.length).toBeGreaterThan(0);

    friends$.next([]);
    fixture.detectChanges();
    expect(second$.observers.length).toBe(0);
    second$.next('chat-unfriended');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('permite repetir a leitura pública do perfil atual após erro transitório', () => {
    const query = TestBed.inject(FirestoreUserQueryService);
    const profileA = component.userProfile!;
    let attempts = 0;
    vi.mocked(query.getPublicUserById$).mockImplementation((uid) => {
      attempts += 1;
      return attempts === 1
        ? throwError(() => new Error('Falha transitória'))
        : of({ ...profileA, uid, nickname: 'Perfil recuperado' });
    });

    routeParamMap$.next(convertToParamMap({ id: 'profile-retry' }));
    fixture.detectChanges();
    expect(component.profileLoadError).toBe(true);
    expect(component.userProfile).toBeNull();

    component.retryProfile();
    fixture.detectChanges();

    expect(component.profileLoadError).toBe(false);
    expect(component.uid).toBe('profile-retry');
    expect(component.userProfile?.nickname).toBe('Perfil recuperado');
    expect(attempts).toBe(2);
  });

  it('deve criar e carregar o perfil visitado pela rota', () => {
    expect(component).toBeTruthy();
    expect(component.uid).toBe(targetUid);
    expect(component.userProfile?.uid).toBe(targetUid);
  });

  it('prioriza foto, identidade e ação principal', () => {
    const hero = fixture.debugElement.query(
      By.css('.other-profile-page__hero')
    );
    const photo = fixture.debugElement.query(
      By.css('.other-profile-page__photo')
    ).nativeElement as HTMLImageElement;
    const title = fixture.debugElement.query(
      By.css('.other-profile-page__title')
    ).nativeElement as HTMLElement;
    const primaryAction = fixture.debugElement.query(
      By.css('.app-action--primary')
    ).nativeElement as HTMLButtonElement;

    expect(hero).toBeTruthy();
    expect(photo.src).toContain('profile.jpg');
    expect(title.textContent).toContain('Pessoa alvo');
    expect(primaryAction.textContent).toContain('Mostrar interesse');
  });

  it('posiciona o retorno dentro do perfil e conserva acesso no estado vazio', () => {
    const hero = fixture.nativeElement.querySelector(
      '.other-profile-page__hero'
    ) as HTMLElement;
    const returnLink = hero.querySelector('.other-profile-page__back') as HTMLAnchorElement;
    expect(returnLink?.getAttribute('aria-label')).toBe('Voltar para os perfis');
    expect(returnLink?.getAttribute('href')).toBeTruthy();
    expect(hero.textContent).toContain('Pessoas');
    expect(fixture.nativeElement.querySelector('.other-profile-page__topbar')).toBeNull();

    const query = TestBed.inject(FirestoreUserQueryService);
    vi.mocked(query.getPublicUserById$).mockReturnValue(of(null));
    routeParamMap$.next(convertToParamMap({ id: 'indisponivel' }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.other-profile-page__hero')).toBeNull();
    expect(fixture.nativeElement.querySelector('.other-profile-page__back--standalone')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Perfil indisponível');
  });

  it('mantém ações no cabeçalho sem comprimir a coluna da identidade', () => {
    const hero = fixture.nativeElement.querySelector(
      '.other-profile-page__hero'
    ) as HTMLElement;
    const identity = hero.querySelector('.other-profile-page__identity');
    const actions = hero.querySelector('.other-profile-page__actions');

    expect(identity).not.toBeNull();
    expect(actions).not.toBeNull();
    expect(actions?.parentElement).toBe(hero);
    expect(identity?.contains(actions)).toBe(false);
    expect(actions?.querySelector('.app-action--primary')).not.toBeNull();
  });

  it('troca foto pública quebrada pelo fallback local sem toast', () => {
    const notifier = TestBed.inject(ErrorNotificationService);
    const photo = fixture.debugElement.query(
      By.css('.other-profile-page__photo')
    ).nativeElement as HTMLImageElement;

    photo.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    const refreshedPhoto = fixture.debugElement.query(
      By.css('.other-profile-page__photo')
    ).nativeElement as HTMLImageElement;

    expect(component.profilePhotoFailed).toBe(true);
    expect(refreshedPhoto.src).toContain('assets/imagem-padrao.webp');
    expect(notifier.showError).not.toHaveBeenCalled();
  });

  it('organiza conteúdo público em coluna principal e informações laterais', () => {
    const content = fixture.debugElement.query(
      By.css('.other-profile-page__content')
    ).nativeElement as HTMLElement;
    const main = content.querySelector(
      '.other-profile-page__main'
    ) as HTMLElement;
    const sidebar = content.querySelector(
      '.other-profile-page__sidebar'
    ) as HTMLElement;
    const showcase = main.querySelector('app-profile-media-showcase');

    expect(main).toBeTruthy();
    expect(sidebar).toBeTruthy();
    expect(showcase).toBeTruthy();
    expect(main.getAttribute('aria-label')).toBe('Mídias do perfil');
    expect(sidebar.getAttribute('aria-label')).toBe(
      'Informações do perfil'
    );
  });

  it('exibe navegação social real entre mídias e detalhes, sem abas fictícias', () => {
    const nav = fixture.nativeElement.querySelector(
      '.other-profile-page__sections'
    ) as HTMLElement;
    const links = Array.from(nav.querySelectorAll('a')) as HTMLAnchorElement[];
    expect(links.map((link) => link.textContent?.trim())).toEqual(['Fotos', 'Vídeos', 'Sobre']);
    expect(links[0].getAttribute('href')).toContain('fotos-publicas');
    expect(links[1].getAttribute('href')).toContain('videos-publicos');
    expect(links[2].getAttribute('href')).toBe('#profile-details');
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toContain('Perfil');
    expect(fixture.nativeElement.querySelector('#profile-media')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#profile-details')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#profile-details .other-profile-page__bio-text')?.textContent)
      .toContain('Descrição direta do perfil.');
    expect(nav.textContent).not.toContain('Seguidores');
  });

  it('consulta associação oficial pelo alvo canônico e participação pública opt-in', () => {
    const officialRepository = TestBed.inject(CommunityPreviewRepository);
    const publicMembershipRepository = TestBed.inject(
      CommunityProfilePublicCommunitiesRepository
    );
    const communitySurface = fixture.debugElement.query(
      By.directive(ProfileOfficialCommunitiesComponent)
    );

    expect(communitySurface).toBeTruthy();
    expect(
      officialRepository.getOfficialCommunitiesForTarget$
    ).toHaveBeenCalledWith(
      { type: 'profile', id: targetProfileId },
      4
    );
    expect(
      publicMembershipRepository.getProfilePublicCommunities$
    ).toHaveBeenCalledWith(targetProfileId, 4, null);
    expect(communitySurface.componentInstance).toBeInstanceOf(
      ProfileOfficialCommunitiesComponent
    );
  });

  it('mantém denúncia no cabeçalho utilitário e ação principal isolada', () => {
    const hero = fixture.nativeElement.querySelector(
      '.other-profile-page__hero'
    ) as HTMLElement;
    const utility = hero.querySelector('.other-profile-page__utility') as HTMLElement;
    const report = utility.querySelector(
      'app-report-content-button button'
    ) as HTMLButtonElement;
    const actions = hero.querySelector('.other-profile-page__actions') as HTMLElement;

    expect(report).not.toBeNull();
    expect(report.type).toBe('button');
    expect(report.classList.contains('report-button--icon')).toBe(true);
    expect(report.getAttribute('aria-label')).toBe('Denunciar Pessoa alvo');
    expect(actions.querySelector('app-report-content-button')).toBeNull();
    expect(actions.querySelector('.app-action--primary')).not.toBeNull();
    expect(utility.querySelector('a')?.getAttribute('aria-label'))
      .toBe('Voltar para os perfis');
  });

  it('exibe identidade normalizada sem repetir localização nem idade exata', () => {
    const hero = fixture.debugElement.query(
      By.css('.other-profile-page__hero')
    ).nativeElement as HTMLElement;
    const about = fixture.debugElement.query(
      By.css('.other-profile-page__introduction')
    ).nativeElement as HTMLElement;
    const identity = hero.querySelector('app-public-user-identity') as HTMLElement;
    const heading = hero.querySelector('#profile-heading') as HTMLElement;

    expect(heading.tagName).toBe('H1');
    expect(heading.textContent).toContain('Pessoa alvo');
    expect(identity.textContent).toContain('Mulher');
    expect(identity.textContent).toContain('Bi');
    expect(identity.textContent).toContain('Rio de Janeiro/RJ');
    expect(identity.textContent).not.toContain('Pessoa alvo');
    expect(hero.textContent).not.toContain('32 anos');
    expect(hero.textContent).not.toContain('Descrição direta do perfil.');
    expect(about.textContent).toContain('Descrição direta do perfil.');
    expect(about.textContent).not.toContain('Rio de Janeiro, RJ');
    expect(about.textContent).toContain('8 km');
  });

  it('não infere orientação de casal a partir de campo legado individual', () => {
    const userQuery = TestBed.inject(FirestoreUserQueryService);
    const casalProfile = {
      ...component.userProfile!,
      identityCode: 'casal-ele-ela',
      gender: 'casal-ele-ela',
      orientation: 'bissexual',
      partner1Orientation: 'heterossexual',
      partner2Orientation: 'bissexual',
    };
    vi.mocked(userQuery.getPublicUserById$).mockReturnValue(of(casalProfile));

    // Um perfil visitado é carregado pela consulta autorizada, não por
    // mutação manual de um componente OnPush já renderizado.
    fixture.destroy();
    fixture = TestBed.createComponent(OtherUserProfileViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect(component.publicIdentity?.identityShortLabel).toBe('Casal');
    expect(component.publicIdentity?.orientationShortLabel).toBeUndefined();

    const identity = fixture.nativeElement.querySelector(
      '.other-profile-page__canonical-identity'
    ) as HTMLElement;
    expect(identity.textContent).toContain('Casal');
    expect(identity.textContent).not.toContain('Bi');
    expect(identity.textContent).not.toContain('Hétero');
  });

  it('exibe apenas afinidades públicas sanitizadas autorizadas pelo perfil', () => {
    const affinityElements = (fixture.nativeElement as HTMLElement)
      .querySelectorAll<HTMLElement>('.other-profile-page__affinities');
    const affinityText = Array.from(affinityElements)
      .map((node) => node.textContent ?? '')
      .join(' ');

    expect(affinityText).toContain('Sério');
    expect(affinityText).toContain('BDSM');
    expect(affinityText).toContain('Tatuagens');
    expect(affinityText).not.toContain('preferences');
  });

  it('mostra disponibilidade temporária em comum sem contaminar afinidades estáveis', () => {
    fixture.detectChanges();

    const intentContext = fixture.debugElement.query(
      By.css('.other-profile-page__intent-context')
    ).nativeElement as HTMLElement;

    expect(intentContext.textContent).toContain(
      'Vocês estão disponíveis agora'
    );
    expect(intentContext.textContent).toContain(
      'Status temporário em comum'
    );
  });

  it('mostra o encaixe de desejos sem expor score bruto', () => {
    const desireMatch = fixture.debugElement.query(
      By.css('.other-profile-page__desire-match')
    ).nativeElement as HTMLElement;

    expect(desireMatch.textContent).toContain('Desejos');
    expect(desireMatch.textContent).toContain('Intenção');
    expect(desireMatch.textContent).toContain('Práticas');
    expect(desireMatch.textContent).toContain('Características');
    expect(desireMatch.textContent).not.toMatch(/\d+%/u);
  });

  it('configura redes como superfície compacta e ocultável', () => {
    const socialLinks = fixture.debugElement.query(
      By.directive(SocialLinksAccordionComponent)
    );
    const socialComponent =
      socialLinks.componentInstance as SocialLinksAccordionComponent;

    expect(socialComponent.uid()).toBe(targetUid);
    expect(socialComponent.isOwner()).toBe(false);
    expect(socialComponent.compact()).toBe(true);
    expect(socialComponent.hideWhenEmpty()).toBe(true);
    expect(socialLinks.nativeElement.hasAttribute('hidden')).toBe(true);
  });

  it('informa ausência de apresentação sem inventar preferências ou expor dados privados', () => {
    const userQuery = TestBed.inject(FirestoreUserQueryService);
    const emptyProfile = {
      ...component.userProfile!,
      descricao: '',
      preferenceBadgesVisible: false,
      publicRelationshipIntents: null,
      publicSexualPractices: null,
      publicBodyTraits: null,
    };
    vi.mocked(userQuery.getPublicUserById$).mockReturnValue(of(emptyProfile));

    fixture.destroy();
    fixture = TestBed.createComponent(OtherUserProfileViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    const intro = fixture.nativeElement.querySelector('#profile-details') as HTMLElement;
    const main = fixture.nativeElement.querySelector('#profile-media') as HTMLElement;
    expect(main.compareDocumentPosition(intro) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(intro.textContent).not.toContain('Sem apresentação por enquanto.');
    expect(intro.querySelector('.other-profile-page__bio-text')).toBeNull();
    expect(intro.querySelector('.other-profile-page__affinities')).toBeNull();
    expect(intro.querySelector('app-social-links-accordion')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('a[href="#profile-details"]')).not.toBeNull();
  });

  it('não reserva um painel de apresentação quando não há dados textuais', () => {
    const userQuery = TestBed.inject(FirestoreUserQueryService);
    vi.mocked(userQuery.getPublicUserById$).mockReturnValue(of({
      ...component.userProfile!,
      descricao: '',
      distanciaKm: undefined,
      preferenceBadgesVisible: false,
      publicRelationshipIntents: null,
      publicSexualPractices: null,
      publicBodyTraits: null,
    }));
    fixture.destroy();
    fixture = TestBed.createComponent(OtherUserProfileViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    const details = fixture.nativeElement.querySelector('#profile-details') as HTMLElement;
    expect(details.classList.contains('other-profile-page__introduction--links-only')).toBe(true);
    expect(details.querySelector('#profile-about-heading')?.classList.contains('visually-hidden')).toBe(true);
    expect(details.querySelector('app-social-links-accordion')).not.toBeNull();
    expect(details.textContent).not.toContain('Sem apresentação');
  });

  it('não inventa publicações nem repete segurança ou promoção de planos', () => {
    const text = fixture.nativeElement.textContent as string;

    expect(text).not.toContain('Publicações recentes');
    expect(text).not.toContain('Dados básicos');
    expect(text).not.toContain('Interagir com segurança');
    expect(text).not.toContain('Assinantes recebem');
    expect(text).not.toContain('Em destaque');
    expect(
      fixture.debugElement.query(By.css('.other-profile-page__actions-card'))
    ).toBeNull();
  });
});