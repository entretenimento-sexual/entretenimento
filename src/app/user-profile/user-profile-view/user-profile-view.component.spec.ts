// src/app/user-profile/user-profile-view/user-profile-view.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject, of } from 'rxjs';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';

import { UserProfileViewComponent } from './user-profile-view.component';

// ✅ imports RELATIVOS (sem aliases)
import { CurrentUserStoreService } from '../../core/services/autentication/auth/current-user-store.service';
import { AuthSessionService } from '../../core/services/autentication/auth/auth-session.service';
import { SidebarService } from '../../core/services/sidebar.service';
import { UserSocialLinksService } from '../../core/services/user-profile/user-social-links.service';
import { FirestoreUserQueryService } from '../../core/services/data-handling/firestore-user-query.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';
import { RoomManagementService } from '../../core/services/batepapo/room-services/room-management.service';

import { provideMockStore } from '@ngrx/store/testing';

// ====== STUBS ======
class MockCurrentUserStoreService {
  // Emite um usuário logado mínimo
  user$ = new BehaviorSubject<any>({ uid: 'test-uid', role: 'premium', isSubscriber: true });
}
class MockAuthSessionService {
  signOut$ = jest.fn(() => of(void 0));
}
class MockSidebarService {
  isSidebarVisible$ = new BehaviorSubject<boolean>(false);
}
class MockUserSocialLinksService {
  getSocialLinks = jest.fn(() => of(null));
}
class MockFirestoreUserQueryService {
  getUser = jest.fn(() => of({ uid: 'test-uid', nickname: 'Alex', photoURL: '' }));
}
class MockErrorNotificationService {
  showError = jest.fn();
  showSuccess = jest.fn();
}
class MockRoomManagementService {
  createRoom = jest.fn(() => of({ id: 'room-1' }));
}

describe('UserProfileViewComponent', () => {
  let fixture: ComponentFixture<UserProfileViewComponent>;

  // Estado mínimo para o MockStore; o selector selectUserById não será exercitado aqui,
  // mas mantemos uma estrutura segura.
  const initialState = {
    users: { users: { 'test-uid': { uid: 'test-uid', isSidebarOpen: false } } },
    friends: { friends: [], requests: [] },
  } as any;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        UserProfileViewComponent,     // standalone
        RouterTestingModule.withRoutes([]),
      ],
      providers: [
        provideMockStore({ initialState }),
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: 'test-uid' })) } },

        // ===== DI realocados para nova base (sem AuthService)
        { provide: CurrentUserStoreService, useClass: MockCurrentUserStoreService },
        { provide: AuthSessionService, useClass: MockAuthSessionService },
        { provide: SidebarService, useClass: MockSidebarService },

        // ===== serviços usados por filhos standalone
        { provide: UserSocialLinksService, useClass: MockUserSocialLinksService },
        { provide: FirestoreUserQueryService, useClass: MockFirestoreUserQueryService },
        { provide: ErrorNotificationService, useClass: MockErrorNotificationService },
        { provide: RoomManagementService, useClass: MockRoomManagementService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(UserProfileViewComponent);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });
});
