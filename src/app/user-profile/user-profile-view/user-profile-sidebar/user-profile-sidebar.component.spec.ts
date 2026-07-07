// src/app/user-profile/user-profile-view/user-profile-sidebar/user-profile-sidebar.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { RouterTestingModule } from '@angular/router/testing';
import { of } from 'rxjs';

import { UserProfileSidebarComponent } from './user-profile-sidebar.component';
import { ErrorNotificationService } from '../../../core/services/error-handler/error-notification.service';
import { RoomManagementService } from '../../../core/services/batepapo/room-services/room-management.service';
import { AuthenticatedNavigationService } from '../../../core/services/navigation/authenticated-navigation.service';

const navigationVm = {
  ready: true,
  uid: 'u1',
  usuario: {
    uid: 'u1',
    nickname: 'Alex',
    photoURL: '',
    role: 'premium',
  },
  currentUrl: '/perfil/u1',
  viewedUid: 'u1',
  isProfileRoute: true,
  isOwnProfileRoute: true,
};

describe('UserProfileSidebarComponent', () => {
  let component: UserProfileSidebarComponent;
  let fixture: ComponentFixture<UserProfileSidebarComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        UserProfileSidebarComponent,
        RouterTestingModule.withRoutes([]),
      ],
      providers: [
        {
          provide: AuthenticatedNavigationService,
          useValue: {
            vm$: of(navigationVm),
            items$: of([]),
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showError: vi.fn(),
            showSuccess: vi.fn(),
          },
        },
        {
          provide: RoomManagementService,
          useValue: {
            createRoom: vi.fn(() => of({ id: 'room-1' })),
          },
        },
        {
          provide: MatDialog,
          useValue: {
            open: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(UserProfileSidebarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
