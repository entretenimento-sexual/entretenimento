import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { AppCacheService } from './app-cache.service';
import {
  CacheDefinition,
  CacheEnvelope,
} from './cache-contracts';
import { CachePersistenceService } from './cache-persistence.service';

describe('AppCacheService', () => {
  let service: AppCacheService;
  let persistence: jasmine.SpyObj<CachePersistenceService>;
  let globalError: jasmine.SpyObj<GlobalErrorHandlerService>;

  const memoryDefinition = <T>(
    overrides: Partial<CacheDefinition<T>> = {}
  ): CacheDefinition<T> => ({
    key: 'test:item',
    scope: 'session',
    sensitivity: 'private',
    storage: 'memory',
    ttlMs: 60_000,
    version: 1,
    ...overrides,
  });

  beforeEach(() => {
    persistence = jasmine.createSpyObj<CachePersistenceService>(
      'CachePersistenceService',
      [
        'getEnvelopePersistent',
        'setEnvelopePersistent',
        'deletePersistent',
        'deletePersistentByPrefix',
      ]
    );
    persistence.getEnvelopePersistent.and.returnValue(of(null));
    persistence.setEnvelopePersistent.and.returnValue(of(void 0));
    persistence.deletePersistent.and.returnValue(of(void 0));
    persistence.deletePersistentByPrefix.and.returnValue(of(0));

    globalError = jasmine.createSpyObj<GlobalErrorHandlerService>(
      'GlobalErrorHandlerService',
      ['handleError']
    );

    TestBed.configureTestingModule({
      providers: [
        AppCacheService,
        { provide: CachePersistenceService, useValue: persistence },
        { provide: GlobalErrorHandlerService, useValue: globalError },
      ],
    });

    service = TestBed.inject(AppCacheService);
  });

  it('mantém null como valor legítimo sem confundir com miss', (done) => {
    const definition = memoryDefinition<null>({
      validate: (value: unknown): value is null => value === null,
    });

    service.set$(definition, null).subscribe(() => {
      service.get$(definition).subscribe((result) => {
        expect(result).toEqual({ status: 'fresh', value: null });
        expect(persistence.setEnvelopePersistent).not.toHaveBeenCalled();
        done();
      });
    });
  });

  it('persiste o envelope completo quando storage é persistent', (done) => {
    spyOn(Date, 'now').and.returnValue(1_000);

    const definition = memoryDefinition<string>({
      key: 'catalog:public',
      scope: 'global',
      sensitivity: 'public',
      storage: 'persistent',
      ttlMs: 30_000,
      staleWhileRevalidateMs: 10_000,
    });

    service.set$(definition, 'ok').subscribe(() => {
      expect(persistence.setEnvelopePersistent).toHaveBeenCalledTimes(1);

      const [, envelope] =
        persistence.setEnvelopePersistent.calls.mostRecent().args;

      expect(envelope).toEqual(
        jasmine.objectContaining({
          value: 'ok',
          createdAt: 1_000,
          expiresAt: 31_000,
          staleUntil: 41_000,
          version: 1,
          scope: 'global',
          sensitivity: 'public',
        })
      );
      done();
    });
  });

  it('rehidrata um envelope fresh do IndexedDB', (done) => {
    spyOn(Date, 'now').and.returnValue(2_000);

    const definition = memoryDefinition<string>({
      key: 'catalog:rehydrate',
      scope: 'global',
      sensitivity: 'public',
      storage: 'persistent',
    });
    const envelope: CacheEnvelope<string> = {
      value: 'persisted',
      createdAt: 1_000,
      expiresAt: 10_000,
      staleUntil: 10_000,
      version: 1,
      scope: 'global',
      sensitivity: 'public',
    };

    persistence.getEnvelopePersistent.and.returnValue(of(envelope));

    service.get$(definition).subscribe((result) => {
      expect(result).toEqual({
        status: 'fresh',
        value: 'persisted',
      });
      done();
    });
  });

  it('retorna stale dentro da janela SWR', (done) => {
    spyOn(Date, 'now').and.returnValue(15_000);

    const definition = memoryDefinition<string>({
      key: 'catalog:stale',
      scope: 'global',
      sensitivity: 'public',
      storage: 'persistent',
      staleWhileRevalidateMs: 10_000,
    });
    const envelope: CacheEnvelope<string> = {
      value: 'stale-value',
      createdAt: 1_000,
      expiresAt: 10_000,
      staleUntil: 20_000,
      version: 1,
      scope: 'global',
      sensitivity: 'public',
    };

    persistence.getEnvelopePersistent.and.returnValue(of(envelope));

    service.get$(definition).subscribe((result) => {
      expect(result).toEqual({
        status: 'stale',
        value: 'stale-value',
      });
      done();
    });
  });

  it('remove envelope expirado e retorna miss', (done) => {
    spyOn(Date, 'now').and.returnValue(30_000);

    const definition = memoryDefinition<string>({
      key: 'catalog:expired',
      scope: 'global',
      sensitivity: 'public',
      storage: 'persistent',
    });
    const envelope: CacheEnvelope<string> = {
      value: 'expired',
      createdAt: 1_000,
      expiresAt: 10_000,
      staleUntil: 20_000,
      version: 1,
      scope: 'global',
      sensitivity: 'public',
    };

    persistence.getEnvelopePersistent.and.returnValue(of(envelope));

    service.get$(definition).subscribe((result) => {
      expect(result).toEqual({ status: 'miss' });
      expect(persistence.deletePersistent).toHaveBeenCalledTimes(1);
      done();
    });
  });

  it('impede persistência de dado classificado como restricted', (done) => {
    const definition = memoryDefinition<string>({
      key: 'preferences:intimate',
      scope: 'user',
      ownerUid: 'uid-1',
      sensitivity: 'restricted',
      storage: 'persistent',
    });

    service.set$(definition, 'private').subscribe({
      next: () => fail('A configuração inválida deveria falhar.'),
      error: (error: Error) => {
        expect(error.name).toBe('CacheConfigurationError');
        expect(persistence.setEnvelopePersistent).not.toHaveBeenCalled();
        done();
      },
    });
  });

  it('limpa o escopo persistido de um UID sem expor outros usuários', (done) => {
    service.clearUserScope$('uid 1').subscribe(() => {
      expect(persistence.deletePersistentByPrefix).toHaveBeenCalledWith(
        'app-cache:user:uid%201:'
      );
      done();
    });
  });
});
