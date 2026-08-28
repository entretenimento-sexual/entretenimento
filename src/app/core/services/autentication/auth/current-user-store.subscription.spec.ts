import { TestBed } from '@angular/core/testing';
import { Auth } from '@angular/fire/auth';
import { BehaviorSubject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IUserDados } from '../../../interfaces/iuser-dados';
import { CacheService } from '../../general/cache/cache.service';
import { PrivacyDebugLoggerService } from '../../privacy/privacy-debug-logger.service';
import { AuthSessionService } from './auth-session.service';
import { CurrentUserStoreService } from './current-user-store.service';

const START = 1_800_000_000_000;

function createUser(endsAt: number): IUserDados {
  return {
    uid: 'u1',
    email: 'u1@example.com',
    photoURL: null,
    nickname: 'Perfil',
    role: 'premium',
    tier: 'premium',
    lastLogin: START,
    descricao: '',
    profileCompleted: true,
    billingProjectionVersion: 1,
    isSubscriber: true,
    monthlyPayer: true,
    subscriptionStatus: 'active',
    subscriptionScope: 'platform_subscription',
    subscriptionStartedAt: START,
    subscriptionEndsAt: endsAt,
  };
}

describe('CurrentUserStoreService / subscription projection', () => {
  let service: CurrentUserStoreService;
  let cacheSet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    cacheSet = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        CurrentUserStoreService,
        {
          provide: CacheService,
          useValue: {
            set: cacheSet,
            delete: vi.fn(),
            getSync: vi.fn(() => null),
          },
        },
        {
          provide: AuthSessionService,
          useValue: {
            ready$: new BehaviorSubject(false),
            uid$: new BehaviorSubject<string | null>(null),
            currentAuthUser: null,
          },
        },
        { provide: Auth, useValue: { currentUser: null } },
        {
          provide: PrivacyDebugLoggerService,
          useValue: { log: vi.fn() },
        },
      ],
    });

    service = TestBed.inject(CurrentUserStoreService);
  });

  it('não descarta renovação do mesmo plano com novo término', () => {
    service.set(createUser(START + 60_000));
    cacheSet.mockClear();

    service.set(createUser(START + 120_000));

    expect(service.getSnapshot()?.subscriptionEndsAt).toBe(START + 120_000);
    expect(cacheSet).toHaveBeenCalledWith(
      'currentUser',
      expect.objectContaining({ subscriptionEndsAt: START + 120_000 }),
      undefined,
      { persist: false }
    );
  });
});
