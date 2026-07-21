// src/app/dashboard/principal/principal.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { Auth } from '@angular/fire/auth';
import { Firestore } from '@angular/fire/firestore';
import { Functions } from '@angular/fire/functions';
import { of } from 'rxjs';
import { By } from '@angular/platform-browser';

import { PrincipalComponent } from './principal.component';
import {
  selectCurrentUser,
  selectCurrentUserStatus,
  selectCurrentUserUid,
} from '../../store/selectors/selectors.user/user.selectors';
import {
  selectFriendsCount,
  selectInboundRequestsCount,
} from '../../store/selectors/selectors.interactions/friend.selector';
import { IUserDados } from '../../core/interfaces/iuser-dados';
import { AuthSessionService } from '../../core/services/autentication/auth/auth-session.service';
import { UserIntentStatusService } from '../../core/services/discovery/user-intent-status.service';
import { VenueService } from '../../core/services/venues/venue.service';
import { HotPlacesService } from '../../core/services/places/hot-places.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';
import { PrivacyDebugLoggerService } from '../../core/services/privacy/privacy-debug-logger.service';

describe('PrincipalComponent', () => {
  let component: PrincipalComponent;
  let fixture: ComponentFixture<PrincipalComponent>;
  let store: MockStore;

  const currentUser = {
    uid: 'u1',
    email: 'x@y.com',
    nickname: 'Alex',
    profileCompleted: true,
    role: 'premium',
    estado: 'RJ',
    municipio: 'Niterói',
  } as unknown as IUserDados;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        RouterTestingModule,
        PrincipalComponent,
      ],
      providers: [
        { provide: Auth, useValue: { currentUser: null } },
        { provide: Firestore, useValue: {} },
        { provide: Functions, useValue: {} },
        {
          provide: AuthSessionService,
          useValue: {
            ready$: of(true),
            uid$: of('u1'),
            readyUid$: of('u1'),
          },
        },
        {
          provide: UserIntentStatusService,
          useValue: {
            watchCurrentStatus$: vi.fn(() => of(null)),
            watchActiveStatusesForUserRegion$: vi.fn(() => of([])),
            publishStatus$: vi.fn(() => of(void 0)),
            hideCurrentStatus$: vi.fn(() => of(void 0)),
          },
        },
        {
          provide: VenueService,
          useValue: {
            watchVenuesForRegion$: vi.fn(() => of([])),
          },
        },
        {
          provide: HotPlacesService,
          useValue: {
            watchHotPlacesForUserRegion$: vi.fn(() => of([])),
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showWarning: vi.fn(),
            showError: vi.fn(),
            showSuccess: vi.fn(),
          },
        },
        {
          provide: PrivacyDebugLoggerService,
          useValue: {
            log: vi.fn(),
          },
        },
        provideMockStore({
          initialState: {
            user: { currentUser },
            friendship: { requests: [], friends: [], incoming: [], sent: [], loading: false, error: null },
          },
        }),
      ],
    }).compileComponents();

    store = TestBed.inject(MockStore);
    store.overrideSelector(selectCurrentUser, currentUser);
    store.overrideSelector(selectCurrentUserUid, 'u1');
    store.overrideSelector(selectCurrentUserStatus, 'ready');
    store.overrideSelector(selectFriendsCount, 0);
    store.overrideSelector(selectInboundRequestsCount, 0);
    store.refreshState();

    fixture = TestBed.createComponent(PrincipalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('mantém uma hierarquia única e sem hero redundante', () => {
    const headings = fixture.debugElement.queryAll(By.css('h1'));
    const title = headings[0]?.nativeElement as HTMLHeadingElement;

    expect(headings).toHaveLength(1);
    expect(title.textContent?.trim()).toBe('Hoje');
    expect(fixture.debugElement.query(By.css('.principal-hero'))).toBeNull();
    expect(
      fixture.debugElement.queryAll(By.css('.principal-social-summary a'))
    ).toHaveLength(2);
  });
});
