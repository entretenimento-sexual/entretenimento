// src/app/layout/other-user-profile-view/other-user-profile-view.component.spec.ts
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Firestore } from '@angular/fire/firestore';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OtherUserProfileViewComponent } from './other-user-profile-view.component';
import { AccessControlService } from '../../core/services/autentication/auth/access-control.service';
import { AuthSessionService } from '../../core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from '../../core/services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../../core/services/error-handler/global-error-handler.service';
import { FriendshipService } from '../../core/services/interactions/friendship/friendship.service';
import { MediaPublicQueryService } from '../../core/services/media/media-public-query.service';
import { PrivacyDebugLoggerService } from '../../core/services/privacy/privacy-debug-logger.service';
import { PublicProfileViewService } from '../../core/services/user-profile/public-profile-view.service';
import { UserSocialLinksService } from '../../core/services/user-profile/user-social-links.service';
import { DirectChatService } from '../../messaging/direct-chat/services/direct-chat.service';
import { SocialLinksAccordionComponent } from '../../user-profile/user-profile-view/user-social-links-accordion/user-social-links-accordion.component';

describe('OtherUserProfileViewComponent', () => {
  let fixture: ComponentFixture<OtherUserProfileViewComponent>;
  let component: OtherUserProfileViewComponent;

  const targetUid = 'target-uid';
  const viewerUid = 'viewer-uid';

  beforeEach(async () => {
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
          provide: PublicProfileViewService,
          useValue: {
            watchProfile$: vi.fn(() =>
              of({
                uid: targetUid,
                nickname: 'Pessoa alvo',
                email: null,
                photoURL: 'https://example.test/profile.jpg',
                role: 'premium',
                lastLogin: Date.now(),
                createdAt: new Date('2022-01-01T00:00:00Z').getTime(),
                descricao: 'Descrição direta do perfil.',
                isSubscriber: true,
                isOnline: true,
                gender: 'Mulher',
                age: 32,
                idade: 32,
                orientation: 'bissexual',
                estado: 'RJ',
                municipio: 'Rio de Janeiro',
                distanciaKm: 8,
                preferenceBadgesVisible: true,
                publicRelationshipIntents: ['dating', 'swing'],
                publicSexualPractices: ['bdsm', 'voyeurism'],
                publicBodyTraits: ['tattoos', 'curvy'],
                preferences: ['Encontros', 'Casais'],
              })
            ),
          },
        },
        {
          provide: MediaPublicQueryService,
          useValue: {
            getProfilePublicMedia$: vi.fn(() => of([])),
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
          },
        },
        {
          provide: DirectChatService,
          useValue: {
            ensureDirectChatIdWithUser$: vi.fn(() => of('chat-id')),
          },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: {
            handleError: vi.fn(),
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
            user$: of({ uid: viewerUid }),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OtherUserProfileViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
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
      By.css('.other-profile-page__action--primary')
    ).nativeElement as HTMLButtonElement;

    expect(hero).toBeTruthy();
    expect(photo.src).toContain('profile.jpg');
    expect(title.textContent).toContain('Pessoa alvo');
    expect(primaryAction.textContent).toContain('Mostrar interesse');
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

  it('mantém a vitrine pública como conteúdo principal sem coluna lateral desconectada', () => {
    const main = fixture.debugElement.query(
      By.css('.other-profile-page__main')
    ).nativeElement as HTMLElement;
    const showcase = main.querySelector('app-profile-media-showcase');

    expect(showcase).toBeTruthy();
    expect(main.getAttribute('aria-label')).toBe('Conteúdo público do perfil');
    expect(
      fixture.debugElement.query(By.css('.other-profile-page__content'))
    ).toBeNull();
    expect(
      fixture.debugElement.query(By.css('.other-profile-page__sidebar'))
    ).toBeNull();
  });

  it('exibe descrição, idade, localização e distância no hero', () => {
    const hero = fixture.debugElement.query(
      By.css('.other-profile-page__hero')
    ).nativeElement as HTMLElement;

    expect(hero.textContent).toContain('Descrição direta do perfil.');
    expect(hero.textContent).toContain('32 anos');
    expect(hero.textContent).toContain('Rio de Janeiro, RJ');
    expect(hero.textContent).toContain('8 km de você');
  });

  it('organiza os dados públicos completos em grupos acessíveis', () => {
    const overview = fixture.debugElement.query(
      By.css('.other-profile-page__overview')
    ).nativeElement as HTMLElement;
    const cards = fixture.debugElement.queryAll(
      By.css('.other-profile-page__info-card')
    );

    expect(overview.textContent).toContain('Informações públicas');
    expect(overview.textContent).toContain('Na plataforma desde 2022');
    expect(overview.textContent).toContain('Conhecer pessoas');
    expect(overview.textContent).toContain('Swing');
    expect(overview.textContent).toContain('BDSM');
    expect(overview.textContent).toContain('Voyeurismo');
    expect(overview.textContent).toContain('Tatuagens');
    expect(overview.textContent).toContain('Curvilíneo');
    expect(overview.textContent).toContain('Encontros');
    expect(overview.textContent).toContain('Casais');
    expect(cards.length).toBeGreaterThanOrEqual(4);
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

  it('não expõe dados privados nem inventa promoções de plano', () => {
    const text = fixture.nativeElement.textContent as string;

    expect(text).not.toContain('viewer@example.test');
    expect(text).not.toContain('Dados básicos');
    expect(text).not.toContain('Interagir com segurança');
    expect(text).not.toContain('Assinantes recebem');
    expect(text).not.toContain('Em destaque');
    expect(
      fixture.debugElement.query(By.css('.other-profile-page__actions-card'))
    ).toBeNull();
  });
});
