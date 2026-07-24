import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { Subject, of } from 'rxjs';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { CacheEffects } from './cache.effects';
import * as CacheActions from '../actions/cache.actions';
import { CachePersistenceService } from '../../core/services/general/cache/cache-persistence.service';
import { GlobalErrorHandlerService } from '../../core/services/error-handler/global-error-handler.service';

describe('CacheEffects', () => {
  let actionsSubject: Subject<unknown>;
  let effects: CacheEffects;
  let persistence: {
    setPersistent: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();

    actionsSubject = new Subject<unknown>();
    persistence = {
      setPersistent: vi.fn().mockReturnValue(of(void 0)),
    };

    TestBed.configureTestingModule({
      providers: [
        CacheEffects,
        {
          provide: Actions,
          useValue: new Actions(actionsSubject),
        },
        {
          provide: CachePersistenceService,
          useValue: persistence,
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: { handleError: vi.fn() },
        },
      ],
    });

    effects = TestBed.inject(CacheEffects);
    effects.setCache$.subscribe();
  });

  afterEach(() => {
    actionsSubject.complete();
    localStorage.clear();
    vi.useRealTimers();
  });

  it('nunca espelha o perfil completo currentUser no localStorage', async () => {
    const profile = {
      uid: 'uid-1',
      email: 'private@example.com',
      role: 'premium',
    };

    actionsSubject.next(
      CacheActions.setCache({ key: 'currentUser', value: profile })
    );
    await vi.advanceTimersByTimeAsync(120);

    expect(persistence.setPersistent).toHaveBeenCalledWith(
      'currentUser',
      profile
    );
    expect(localStorage.getItem('currentUser')).toBeNull();
  });

  it('mantém somente o UID mínimo como compatibilidade de bootstrap', async () => {
    actionsSubject.next(
      CacheActions.setCache({
        key: 'currentUserUid',
        value: 'uid-1',
      })
    );
    await vi.advanceTimersByTimeAsync(120);

    expect(localStorage.getItem('currentUserUid')).toBe(
      JSON.stringify('uid-1')
    );
  });
});
