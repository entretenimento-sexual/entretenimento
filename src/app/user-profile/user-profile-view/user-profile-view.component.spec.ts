// src/app/user-profile/user-profile-view/user-profile-view.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { BehaviorSubject, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserProfileViewComponent } from './user-profile-view.component';
import { AccessControlService } from '../../core/services/autentication/auth/access-control.service';
import { AuthSessionService } from '../../core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from '../../core/services/autentication/auth/current-user-store.service';
import { FirestoreUserQueryService } from '../../core/services/data-handling/firestore-user-query.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';
import { RoomManagementService } from '../../core/services/batepapo/room-services/room-management.service';
import { UserSocialLinksService } from '../../core/services/user-profile/user-social-links.service';
import {
  selectCurrentUser,
  selectCurrentUserStatus,
  selectCurrentUserUid,
} from '../../store/selectors/selectors.user/user.selectors';

const CURRENT_USER = {
  uid: 'test-uid',
  nickname: 'Alex',
  role: 'premium',
  isSubscriber: true,
  profileCompleted: true,
  photoURL: '',
};

class MockCurrentUserStoreService {
  user$ = new BehaviorSubject<any | null | undefined>(CURRENT_USER);
}

class MockAuthSessionService {
  private readonly authUserSubject = new BehaviorSubject<any | null>({
    uid: 'test-uid',
    email: 'alex@example.com',
    emailVerified: true,
  });

  private readonly uidSubject = new BehaviorSubject<string | null>('test-uid');

  authUser$ = this.authUserSubject.asObservable();
  uid$ = this.uidSubject.asObservable();
  ready$ = of(true);
  currentAuthUser: {
    uid: string;
    email?: string;
    emailVerified?: boolean;
  } | null = {
    uid: 'test-uid',
    email: 'alex@example.com',
    emailVerified: true,
  };

  signOut$ = vi.fn(() => of(void 0));

  setAuthUser(
    user: { uid: string; email?: string; emailVerified?: boolean } | null
  ): void {
    this.currentAuthUser = user;
    this.authUserSubject.next(user);
    this.uidSubject.next(user?.uid ?? null);
  }
}

class MockUserSocialLinksService {
  getSocialLinks = vi.fn(() => of(null));
  watchSocialLinks = vi.fn(() => of(null));
  saveSocialLinks = vi.fn(() => of(void 0));
  removeLink = vi.fn(() => of(void 0));
}

class MockFirestoreUserQueryService {
  getUser = vi.fn(() => of(CURRENT_USER));
  getUserWithObservable = vi.fn(() => of(CURRENT_USER));
}

class MockErrorNotificationService {
  showError = vi.fn();
  showSuccess = vi.fn();
  showWarning = vi.fn();
}

class MockRoomManagementService {
  createRoom = vi.fn(() => of({ id: 'room-1' }));
}

describe('UserProfileViewComponent', () => {
  let fixture: ComponentFixture<UserProfileViewComponent>;
  let component: UserProfileViewComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        UserProfileViewComponent,
        RouterTestingModule.withRoutes([]),
        NoopAnimationsModule,
      ],
      providers: [
        provideMockStore({
          selectors: [
            { selector: selectCurrentUserUid, value: 'test-uid' },
            { selector: selectCurrentUser, value: CURRENT_USER as any },
            { selector: selectCurrentUserStatus, value: 'ready' },
          ],
        }),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ id: 'test-uid' })),
          },
        },
        {
          provide: AccessControlService,
          useValue: {
            isSubscriber$: of(true),
          },
        },
        {
          provide: CurrentUserStoreService,
          useClass: MockCurrentUserStoreService,
        },
        { provide: AuthSessionService, useClass: MockAuthSessionService },
        {
          provide: UserSocialLinksService,
          useClass: MockUserSocialLinksService,
        },
        {
          provide: FirestoreUserQueryService,
          useClass: MockFirestoreUserQueryService,
        },
        {
          provide: ErrorNotificationService,
          useClass: MockErrorNotificationService,
        },
        {
          provide: RoomManagementService,
          useClass: MockRoomManagementService,
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(UserProfileViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('deve usar uma única superfície canônica para gerenciar redes', () => {
    const social = fixture.nativeElement.querySelector(
      'app-social-links-accordion'
    ) as HTMLElement | null;
    const text = fixture.nativeElement.textContent as string;
    const duplicateHeaderShortcut = fixture.nativeElement.querySelector(
      'a[aria-label="Gerenciar redes sociais"]'
    );

    expect(social).toBeTruthy();
    expect(text).toContain('Gerenciar redes');
    expect(duplicateHeaderShortcut).toBeNull();
    expect(fixture.nativeElement.querySelector('.inline-editor')).toBeNull();
    expect(fixture.nativeElement.querySelector('.edit-row')).toBeNull();
  });
});
