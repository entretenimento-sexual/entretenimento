// src/app/user-profile/user-profile-view/user-profile-sidebar/user-profile-sidebar.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject, of } from 'rxjs';
import { RouterTestingModule } from '@angular/router/testing';

import { UserProfileSidebarComponent } from './user-profile-sidebar.component';

// ✅ IMPORTS RELATIVOS (sem aliases tipo 'src/...'):
import { CurrentUserStoreService } from '../../../core/services/autentication/auth/current-user-store.service';
import { AuthSessionService } from '../../../core/services/autentication/auth/auth-session.service';
import { FirestoreUserQueryService } from '../../../core/services/data-handling/firestore-user-query.service';
import { ErrorNotificationService } from '../../../core/services/error-handler/error-notification.service';
import { RoomManagementService } from '../../../core/services/batepapo/room-services/room-management.service';

// ===== STUBS =====
class MockCurrentUserStoreService {
  user$ = new BehaviorSubject<any>({ uid: 'u1', role: 'premium' });
}
class MockAuthSessionService {
  signOut$ = jest.fn(() => of(void 0));
}
class MockFirestoreUserQueryService {
  getUser = jest.fn(() => of({ uid: 'u1', nickname: 'Alex', photoURL: '' }));
}
class MockErrorNotificationService {
  showError = jest.fn();
  showSuccess = jest.fn();
}
class MockRoomManagementService {
  createRoom = jest.fn(() => of({ id: 'room-1' }));
}

describe('UserProfileSidebarComponent', () => {
  let component: UserProfileSidebarComponent;
  let fixture: ComponentFixture<UserProfileSidebarComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        UserProfileSidebarComponent,     // standalone
        RouterTestingModule.withRoutes([]),
      ],
      providers: [
        { provide: CurrentUserStoreService, useClass: MockCurrentUserStoreService },
        { provide: AuthSessionService, useClass: MockAuthSessionService },
        { provide: FirestoreUserQueryService, useClass: MockFirestoreUserQueryService },
        { provide: ErrorNotificationService, useClass: MockErrorNotificationService },
        { provide: RoomManagementService, useClass: MockRoomManagementService },
        // MatDialog não é usado no teste (apenas injetado). Se precisar, stub:
        { provide: (class MatDialog { } as any), useValue: { open: jest.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(UserProfileSidebarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges(); // aciona o pipe da stream do usuário e o getUser()
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
