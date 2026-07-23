import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FriendSearchComponent } from './friend-search.component';
import { AppCacheService } from '../../../core/services/general/cache/app-cache.service';
import { CurrentUserStoreService } from '../../../core/services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from '../../../core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../../../core/services/error-handler/global-error-handler.service';
import { FriendshipService } from '../../../core/services/interactions/friendship/friendship.service';

describe('FriendSearchComponent', () => {
  let component: FriendSearchComponent;
  let fixture: ComponentFixture<FriendSearchComponent>;
  let cache: {
    get$: ReturnType<typeof vi.fn>;
    set$: ReturnType<typeof vi.fn>;
  };
  let friendship: {
    searchUsers: ReturnType<typeof vi.fn>;
  };
  let store: {
    dispatch: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.useFakeTimers();

    cache = {
      get$: vi.fn().mockReturnValue(of({ status: 'miss' })),
      set$: vi.fn().mockReturnValue(of(void 0)),
    };
    friendship = {
      searchUsers: vi.fn().mockReturnValue(
        of([{ uid: 'uid-result', nickname: 'alice' }])
      ),
    };
    store = {
      dispatch: vi.fn(),
      select: vi.fn(() => of([])),
    };

    await TestBed.configureTestingModule({
      imports: [FriendSearchComponent],
      providers: [
        { provide: FriendshipService, useValue: friendship },
        { provide: Store, useValue: store },
        { provide: AppCacheService, useValue: cache },
        {
          provide: CurrentUserStoreService,
          useValue: {
            getLoggedUserUIDSnapshot: vi.fn(() => 'uid-owner'),
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: { showError: vi.fn() },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: { handleError: vi.fn() },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FriendSearchComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('mantém consulta e resultados em cache user-scoped somente em memória', async () => {
    component.searchControl.setValue('  Alice  ');
    await vi.advanceTimersByTimeAsync(500);

    expect(friendship.searchUsers).toHaveBeenCalledWith('alice');
    expect(cache.get$).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'friend-search:alice',
        scope: 'user',
        ownerUid: 'uid-owner',
        sensitivity: 'private',
        storage: 'memory',
      })
    );
    expect(cache.set$).toHaveBeenCalledWith(
      expect.objectContaining({ storage: 'memory' }),
      [{ uid: 'uid-result', nickname: 'alice' }]
    );
    expect(store.dispatch).toHaveBeenCalled();
  });
});
