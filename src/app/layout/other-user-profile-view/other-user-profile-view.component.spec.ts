// src/app/layout/other-user-profile-view/other-user-profile-view.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { Store } from '@ngrx/store';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Firestore } from '@angular/fire/firestore';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OtherUserProfileViewComponent } from './other-user-profile-view.component';
import { FirestoreUserQueryService } from '../../core/services/data-handling/firestore-user-query.service';
import { MediaPublicQueryService } from '../../core/services/media/media-public-query.service';
import { AuthSessionService } from '../../core/services/autentication/auth/auth-session.service';
import { FriendshipService } from '../../core/services/interactions/friendship/friendship.service';
import { DirectChatService } from '../../messaging/direct-chat/services/direct-chat.service';
import { GlobalErrorHandlerService } from '../../core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';
import { PrivacyDebugLoggerService } from '../../core/services/privacy/privacy-debug-logger.service';
import { UserSocialLinksService } from '../../core/services/user-profile/user-social-links.service';
import { CurrentUserStoreService } from '../../core/services/autentication/auth/current-user-store.service';


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
          provide: FirestoreUserQueryService,
          useValue: {
            getPublicUserById$: vi.fn(() =>
              of({
                uid: targetUid,
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

  it('renderiza a galeria logo após o hero', () => {
    const page = fixture.nativeElement.querySelector(
      '.other-profile-page'
    ) as HTMLElement;
    const hero = page.querySelector('.other-profile-page__hero');
    const showcase = page.querySelector('app-profile-media-showcase');

    expect(hero).toBeTruthy();
    expect(showcase).toBeTruthy();
    expect(
      Boolean(
        hero &&
          showcase &&
          hero.compareDocumentPosition(showcase) &
            Node.DOCUMENT_POSITION_FOLLOWING
      )
    ).toBe(true);
  });

  it('mantém afinidades declaradas sem cartões de sinais', () => {
    const affinityText = fixture.debugElement.query(
      By.css('.other-profile-page__affinities')
    ).nativeElement.textContent as string;

    expect(affinityText).toContain('Encontros');
    expect(affinityText).toContain('Casais');
    expect(
      fixture.debugElement.query(By.css('.other-profile-page__signal'))
    ).toBeNull();
  });

  it('não repete dados básicos, segurança ou promoção de planos', () => {
    const text = fixture.nativeElement.textContent as string;

    expect(text).not.toContain('Dados básicos');
    expect(text).not.toContain('Interagir com segurança');
    expect(text).not.toContain('Assinantes recebem');
    expect(text).not.toContain('Em destaque');
    expect(
      fixture.debugElement.query(By.css('.other-profile-page__actions-card'))
    ).toBeNull();
  });
});
