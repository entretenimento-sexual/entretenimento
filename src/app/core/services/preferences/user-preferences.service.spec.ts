import { TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { firstValueFrom, of } from 'rxjs';
import { vi } from 'vitest';

import { UserPreferencesService } from './user-preferences.service';
import { AppCacheService } from '../general/cache/app-cache.service';
import { FirestoreContextService } from '../data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../error-handler/error-notification.service';
import {
  createStoreTestingMock,
  provideStoreTestingMock,
} from '../../../../test/ngrx-store-testing.providers';

describe('UserPreferencesService', () => {
  let service: UserPreferencesService;
  let cache: {
    get$: ReturnType<typeof vi.fn>;
    set$: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    const storeMock = createStoreTestingMock();
    cache = {
      get$: vi.fn().mockReturnValue(of({ status: 'miss' })),
      set$: vi.fn().mockReturnValue(of(void 0)),
    };

    TestBed.configureTestingModule({
      providers: [
        ...provideStoreTestingMock(storeMock),
        {
          provide: Firestore,
          useValue: {},
        },
        {
          provide: AppCacheService,
          useValue: cache,
        },
        {
          provide: FirestoreContextService,
          useValue: {
            deferPromise$: () =>
              of({
                forEach: () => undefined,
              }),
            run: async (task: () => Promise<void>) => task(),
          },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: {
            handleError: vi.fn(),
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showError: vi.fn(),
            showSuccess: vi.fn(),
            showWarning: vi.fn(),
            showInfo: vi.fn(),
          },
        },
      ],
    });

    service = TestBed.inject(UserPreferencesService);
  });

  it('é criado com a nova fachada tipada', () => {
    expect(service).toBeTruthy();
  });

  it('consulta preferências com política restrita somente em memória', async () => {
    const value = await firstValueFrom(
      service.getUserPreferences$('uid-1')
    );

    expect(value).toEqual({
      genero: [],
      praticaSexual: [],
      preferenciaFisica: [],
      relacionamento: [],
    });

    expect(cache.get$).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'preferences',
        scope: 'user',
        ownerUid: 'uid-1',
        sensitivity: 'restricted',
        storage: 'memory',
        version: 1,
      })
    );

    expect(cache.set$).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'user',
        sensitivity: 'restricted',
        storage: 'memory',
      }),
      {
        genero: [],
        praticaSexual: [],
        preferenciaFisica: [],
        relacionamento: [],
      }
    );
  });
});
