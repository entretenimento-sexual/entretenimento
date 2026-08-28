import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { Observable, of } from 'rxjs';
import { vi } from 'vitest';

import { FriendSearchComponent } from './friend-search.component';
import { IUserDados } from '../../../core/interfaces/iuser-dados';
import { AuthSessionService } from '../../../core/services/autentication/auth/auth-session.service';
import { CacheService } from '../../../core/services/general/cache/cache.service';
import { ErrorNotificationService } from '../../../core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../../../core/services/error-handler/global-error-handler.service';
import { FriendshipService } from '../../../core/services/interactions/friendship/friendship.service';

describe('FriendSearchComponent', () => {
  let component: FriendSearchComponent;
  let fixture: ComponentFixture<FriendSearchComponent>;

  const storeDispatch = vi.fn();
  const cacheGet = vi.fn(
    (): Observable<IUserDados[] | null> => of(null)
  );
  const cacheSet = vi.fn();
  const searchUsers = vi.fn((): Observable<IUserDados[]> => of([]));
  const showError = vi.fn();
  const handleError = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    cacheGet.mockReturnValue(of(null));
    searchUsers.mockReturnValue(of([]));

    await TestBed.configureTestingModule({
      imports: [FriendSearchComponent],
      providers: [
        {
          provide: AuthSessionService,
          useValue: {
            readyUid$: of('user-123'),
          },
        },
        {
          provide: FriendshipService,
          useValue: {
            searchUsers,
          },
        },
        {
          provide: Store,
          useValue: {
            dispatch: storeDispatch,
            select: vi.fn(() => of([])),
          },
        },
        {
          provide: CacheService,
          useValue: {
            get: cacheGet,
            set: cacheSet,
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showError,
          },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: {
            handleError,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FriendSearchComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('stores search results in an ephemeral UID-scoped cache key', () => {
    const results = [{ uid: 'result-1' }] as IUserDados[];
    searchUsers.mockReturnValue(of(results));

    (component as unknown as {
      searchFriends: (term: string) => Observable<void>;
    }).searchFriends('alex').subscribe();

    expect(cacheGet).toHaveBeenCalledWith('search:user-123:1rpur0l');
    expect(cacheSet).toHaveBeenCalledWith(
      'search:user-123:1rpur0l',
      results,
      300_000,
      { persist: false }
    );
    expect(
      cacheSet.mock.calls.some(([key]) => key === 'loadingSearch')
    ).toBe(false);
  });

  it('treats an empty cached result as a valid cache hit', () => {
    cacheGet.mockReturnValue(of([]));

    (component as unknown as {
      searchFriends: (term: string) => Observable<void>;
    }).searchFriends('alex').subscribe();

    expect(searchUsers).not.toHaveBeenCalled();
    expect(cacheSet).not.toHaveBeenCalled();
  });
});
