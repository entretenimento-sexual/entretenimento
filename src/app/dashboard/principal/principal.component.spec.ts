// src/app/dashboard/principal/principal.component.spec.ts
import { Auth } from '@angular/fire/auth';
import { Firestore } from '@angular/fire/firestore';
import { Functions } from '@angular/fire/functions';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RouterTestingModule } from '@angular/router/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { of } from 'rxjs';

import { IUserDados } from '../../core/interfaces/iuser-dados';
import { AuthSessionService } from '../../core/services/autentication/auth/auth-session.service';
import { UserIntentStatusService } from '../../core/services/discovery/user-intent-status.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';
import { HotPlacesService } from '../../core/services/places/hot-places.service';
import { PrivacyDebugLoggerService } from '../../core/services/privacy/privacy-debug-logger.service';
import { VenueService } from '../../core/services/venues/venue.service';
import { selectCurrentUser, selectCurrentUserUid } from '../../store/selectors/selectors.user/user.selectors';
import { PrincipalComponent } from './principal.component';
import { PrincipalFeedService } from './principal-feed.service';

const EMPTY_FEED_STATE = {
  status: 'empty' as const,
  items: [],
  photos: [],
  failedSources: [],
};

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
      imports: [RouterTestingModule, PrincipalComponent],
      providers: [
        { provide: Auth, useValue: { currentUser: null } },
        { provide: Firestore, useValue: {} },
        { provide: Functions, useValue: {} },
        {
          provide: PrincipalFeedService,
          useValue: {
            state$: of(EMPTY_FEED_STATE),
            refresh: vi.fn(),
          },
        },
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
          useValue: { log: vi.fn() },
        },
        provideMockStore({
          initialState: {
            user: { currentUser },
            friendship: {
              requests: [],
              friends: [],
              incoming: [],
              sent: [],
              loading: false,
              error: null,
            },
          },
        }),
      ],
    }).compileComponents();

    store = TestBed.inject(MockStore);
    store.overrideSelector(selectCurrentUser, currentUser);
    store.overrideSelector(selectCurrentUserUid, 'u1');
    store.refreshState();

    fixture = TestBed.createComponent(PrincipalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('não anuncia visualmente que a tela é um feed', () => {
    expect(fixture.debugElement.queryAll(By.css('h1'))).toHaveLength(0);
    expect(fixture.debugElement.query(By.css('.principal-feed'))).toBeTruthy();
    expect(fixture.debugElement.query(By.css('.feed-create-bar'))).toBeTruthy();
    expect(fixture.debugElement.query(By.css('.feed-header'))).toBeNull();
    expect(fixture.debugElement.query(By.css('.feed-shortcuts'))).toBeNull();
  });

  it('usa a rota canônica para adicionar foto', () => {
    const photoLink = fixture.debugElement.query(
      By.css('a[aria-label="Adicionar foto"]')
    )?.nativeElement as HTMLAnchorElement | undefined;

    expect(photoLink).toBeTruthy();
    expect(photoLink?.getAttribute('href')).toBe(
      '/media/perfil/u1/fotos/upload'
    );
  });

  it('materializa o editor de status somente quando solicitado', async () => {
    expect(
      fixture.debugElement.query(By.css('app-user-intent-status-composer'))
    ).toBeNull();

    const prompt = fixture.debugElement.query(
      By.css('.feed-create-bar__prompt')
    );
    prompt.triggerEventHandler('click');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(
      fixture.debugElement.query(By.css('app-user-intent-status-composer'))
    ).toBeTruthy();
  });

  it('mantém radar, locais atuais e fluxo misto na coluna principal', () => {
    expect(
      fixture.debugElement.query(By.css('app-user-intent-status-radar'))
    ).toBeTruthy();
    expect(
      fixture.debugElement.query(By.css('app-hot-places-widget'))
    ).toBeTruthy();
    expect(fixture.debugElement.query(By.css('.feed-stream'))).toBeTruthy();
  });
});
