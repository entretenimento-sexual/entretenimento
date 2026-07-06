// src/app/layout/other-user-profile-view/other-user-profile-view.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
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
            select: vi.fn(() => of({ uid: viewerUid, role: 'free', isSubscriber: false })),
          },
        },
        {
          provide: FirestoreUserQueryService,
          useValue: {
            getPublicUserById$: vi.fn(() => of({
              uid: targetUid,
              email: null,
              photoURL: null,
              role: 'free',
              lastLogin: Date.now(),
              descricao: '',
              isSubscriber: false,
              gender: 'Homem',
              orientation: 'heterossexual',
              estado: 'RJ',
              municipio: 'Rio de Janeiro',
              preferences: [],
            })),
          },
        },
        {
          provide: MediaPublicQueryService,
          useValue: {
            getProfilePublicPhotos$: vi.fn(() => of([])),
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

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load the visited profile from route id', () => {
    expect(component.uid).toBe(targetUid);
    expect(component.userProfile?.uid).toBe(targetUid);
  });
});
