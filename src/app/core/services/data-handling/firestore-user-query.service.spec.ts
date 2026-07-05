import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { FirestoreUserQueryService } from './firestore-user-query.service';
import { FirestoreErrorHandlerService } from '../error-handler/firestore-error-handler.service';
import { UserStateCacheService } from './firestore/state/user-state-cache.service';
import { UserRepositoryService } from './firestore/repositories/user-repository.service';
import { UserDiscoveryQueryService } from './queries/user-discovery.query.service';
import { UsersReadRepository } from './firestore/repositories/users-read.repository';

describe('FirestoreUserQueryService', () => {
  let service: FirestoreUserQueryService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        FirestoreUserQueryService,
        {
          provide: FirestoreErrorHandlerService,
          useValue: {
            handleFirestoreError: vi.fn(),
          },
        },
        {
          provide: UsersReadRepository,
          useValue: {
            getUserOnce$: vi.fn(() => of(null)),
          },
        },
        {
          provide: UserStateCacheService,
          useValue: {
            upsertUser: vi.fn(),
          },
        },
        {
          provide: UserRepositoryService,
          useValue: {
            checkUserExistsFromServer: vi.fn(() => Promise.resolve(false)),
            getUser$: vi.fn(() => of(null)),
            getUserById$: vi.fn(() => of(null)),
            getUserById: vi.fn(() => of(null)),
            watchUser$: vi.fn(() => of(null)),
            invalidateUserCache: vi.fn(),
            updateUserInStateAndCache: vi.fn(),
            watchUserDocDeleted$: vi.fn(() => of(false)),
          },
        },
        {
          provide: UserDiscoveryQueryService,
          useValue: {
            getProfilesByUids$: vi.fn(() => of([])),
          },
        },
      ],
    });
    service = TestBed.inject(FirestoreUserQueryService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
