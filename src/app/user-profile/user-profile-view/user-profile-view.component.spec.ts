// src/app/user-profile/user-profile-view/user-profile-view.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject, of } from 'rxjs';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';

import { UserProfileViewComponent } from './user-profile-view.component';

// imports relativos
import { CurrentUserStoreService } from '../../core/services/autentication/auth/current-user-store.service';
import { AuthSessionService } from '../../core/services/autentication/auth/auth-session.service';

import { UserSocialLinksService } from '../../core/services/user-profile/user-social-links.service';
import { FirestoreUserQueryService } from '../../core/services/data-handling/firestore-user-query.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';
import { RoomManagementService } from '../../core/services/batepapo/room-services/room-management.service';

import { provideMockStore } from '@ngrx/store/testing';

// ====== STUBS ======

class MockCurrentUserStoreService {
  user$ = new BehaviorSubject<any | null | undefined>({
    uid: 'test-uid',
    role: 'premium',
    isSubscriber: true,
  });
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
  currentAuthUser: { uid: string; email?: string; emailVerified?: boolean } | null = {
    uid: 'test-uid',
    email: 'alex@example.com',
    emailVerified: true,
  };

  signOut$ = vi.fn(() => of(void 0));

  setAuthUser(user: { uid: string; email?: string; emailVerified?: boolean } | null): void {
    this.currentAuthUser = user;
    this.authUserSubject.next(user);
    this.uidSubject.next(user?.uid ?? null);
  }
}

class MockSidebarService {
  isSidebarVisible$ = new BehaviorSubject<boolean>(false);
}

class MockUserSocialLinksService {
  getSocialLinks = vi.fn(() => of(null));
  saveSocialLinks = vi.fn(() => of(void 0));
  removeLink = vi.fn(() => of(void 0));
}

class MockFirestoreUserQueryService {
  getUser = vi.fn(() =>
    of({
      uid: 'test-uid',
      nickname: 'Alex',
      photoURL: '',
    })
  );

  getUserWithObservable = vi.fn(() =>
    of({
      uid: 'test-uid',
      nickname: 'Alex',
      photoURL: '',
    })
  );
}

class MockErrorNotificationService {
  showError = vi.fn();
  showSuccess = vi.fn();
}

class MockRoomManagementService {
  createRoom = vi.fn(() => of({ id: 'room-1' }));
}

describe('UserProfileViewComponent', () => {
  let fixture: ComponentFixture<UserProfileViewComponent>;
  let component: UserProfileViewComponent;

  const initialState = {
    users: {
      users: {
        'test-uid': {
          uid: 'test-uid',
          isSidebarOpen: false,
        },
      },
    },
    friends: {
      friends: [],
      requests: [],
    },
  } as any;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        UserProfileViewComponent,
        RouterTestingModule.withRoutes([]),
      ],
      providers: [
        provideMockStore({ initialState }),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ id: 'test-uid' })),
          },
        },

        { provide: CurrentUserStoreService, useClass: MockCurrentUserStoreService },
        { provide: AuthSessionService, useClass: MockAuthSessionService },
        { provide: UserSocialLinksService, useClass: MockUserSocialLinksService },
        { provide: FirestoreUserQueryService, useClass: MockFirestoreUserQueryService },
        { provide: ErrorNotificationService, useClass: MockErrorNotificationService },
        { provide: RoomManagementService, useClass: MockRoomManagementService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(UserProfileViewComponent);
    component = fixture.componentInstance;

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
