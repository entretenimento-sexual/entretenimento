import { TestBed } from '@angular/core/testing';
import { Subject, firstValueFrom, of } from 'rxjs';
import { vi } from 'vitest';

import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { AppCacheService } from './app-cache.service';
import {
  CacheDefinition,
  CacheEnvelope,
} from './cache-contracts';
import { CachePersistenceService } from './cache-persistence.service';

type PersistenceMock = {
  getEnvelopePersistent: ReturnType<typeof vi.fn>;
  setEnvelopePersistent: ReturnType<typeof vi.fn>;
  deletePersistent: ReturnType<typeof vi.fn>;
  deletePersistentByPrefix: ReturnType<typeof vi.fn>;
};

describe('AppCacheService', () => {
  let service: AppCacheService;
  let persistence: PersistenceMock;
  let globalError: { handleError: ReturnType<typeof vi.fn> };

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

  const persistedEnvelope = <T>(value: T): CacheEnvelope<T> => ({
    value,
    createdAt: 1_000,
    expiresAt: 120_000,
    staleUntil: 120_000,
    version: 1,
    scope: 'session',
    sensitivity: 'private',
  });

  beforeEach(() => {
    persistence = {
      getEnvelopePersistent: vi.fn().mockReturnValue(of(null)),
      setEnvelopePersistent: vi.fn().mockReturnValue(of(void 0)),
      deletePersistent: vi.fn().mockReturnValue(of(void 0)),
      deletePersistentByPrefix: vi.fn().mockReturnValue(of(0)),
    };
    globalError = {
      handleError: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        AppCacheService,
        { provide: CachePersistenceService, useValue: persistence },
        { provide: GlobalErrorHandlerService, useValue: globalError },
      ],
    });

    service = TestBed.inject(AppCacheService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('mantém null como valor legítimo sem confundir com miss', async () => {
    const definition = memoryDefinition<null>({
      validate: (value: unknown): value is null => value === null,
    });

    await firstValueFrom(service.set$(definition, null));

    expect(await firstValueFrom(service.get$(definition))).toEqual({
      status: 'fresh',
      value: null,
    });
    expect(persistence.setEnvelopePersistent).not.toHaveBeenCalled();
  });

  it('peek retorna snapshot fresh exclusivamente da memória', async () => {
    const definition = memoryDefinition<string>();

    await firstValueFrom(service.set$(definition, 'runtime'));

    expect(service.peek(definition)).toEqual({
      status: 'fresh',
      value: 'runtime',
    });
    expect(persistence.getEnvelopePersistent).not.toHaveBeenCalled();
  });

  it('peek retorna miss sem consultar IndexedDB', () => {
    const definition = memoryDefinition<string>({
      key: 'catalog:persistent-but-not-loaded',
      scope: 'global',
      sensitivity: 'public',
      storage: 'persistent',
    });

    expect(service.peek(definition)).toEqual({ status: 'miss' });
    expect(persistence.getEnvelopePersistent).not.toHaveBeenCalled();
  });

  it('peek remove valor expirado da memória', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const definition = memoryDefinition<string>({ ttlMs: 10 });

    await firstValueFrom(service.set$(definition, 'short-lived'));
    now.mockReturnValue(2_000);

    expect(service.peek(definition)).toEqual({ status: 'miss' });
    expect(service.peek(definition)).toEqual({ status: 'miss' });
  });

  it('rejeita definição runtime incompleta sem TTL', async () => {
    const invalid = {
      key: 'invalid:missing-ttl',
      scope: 'session',
      sensitivity: 'private',
      storage: 'memory',
      version: 1,
    } as unknown as CacheDefinition<string>;

    await expect(
      firstValueFrom(service.set$(invalid, 'value'))
    ).rejects.toMatchObject({ name: 'CacheConfigurationError' });

    expect(persistence.setEnvelopePersistent).not.toHaveBeenCalled();
  });

  it('persiste o envelope completo quando storage é persistent', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);

    const definition = memoryDefinition<string>({
      key: 'catalog:public',
      scope: 'global',
      sensitivity: 'public',
      storage: 'persistent',
      ttlMs: 30_000,
      staleWhileRevalidateMs: 10_000,
    });

    await firstValueFrom(service.set$(definition, 'ok'));

    expect(persistence.setEnvelopePersistent).toHaveBeenCalledTimes(1);

    const envelope = persistence.setEnvelopePersistent.mock.calls[0]?.[1] as
      | CacheEnvelope<string>
      | undefined;

    expect(envelope).toEqual(
      expect.objectContaining({
        value: 'ok',
        createdAt: 1_000,
        expiresAt: 31_000,
        staleUntil: 41_000,
        version: 1,
        scope: 'global',
        sensitivity: 'public',
      })
    );
  });

  it('rehidrata um envelope fresh do IndexedDB', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000);

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

    persistence.getEnvelopePersistent.mockReturnValue(of(envelope));

    expect(await firstValueFrom(service.get$(definition))).toEqual({
      status: 'fresh',
      value: 'persisted',
    });
    expect(service.peek(definition)).toEqual({
      status: 'fresh',
      value: 'persisted',
    });
  });

  it('retorna stale dentro da janela SWR', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(15_000);

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

    persistence.getEnvelopePersistent.mockReturnValue(of(envelope));

    expect(await firstValueFrom(service.get$(definition))).toEqual({
      status: 'stale',
      value: 'stale-value',
    });
  });

  it('remove envelope expirado e retorna miss', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(30_000);

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

    persistence.getEnvelopePersistent.mockReturnValue(of(envelope));

    expect(await firstValueFrom(service.get$(definition))).toEqual({
      status: 'miss',
    });
    expect(persistence.deletePersistent).toHaveBeenCalledTimes(1);
  });

  it('impede persistência de dado classificado como restricted', async () => {
    const definition = memoryDefinition<string>({
      key: 'preferences:intimate',
      scope: 'user',
      ownerUid: 'uid-1',
      sensitivity: 'restricted',
      storage: 'persistent',
    });

    await expect(
      firstValueFrom(service.set$(definition, 'private'))
    ).rejects.toMatchObject({ name: 'CacheConfigurationError' });

    expect(persistence.setEnvelopePersistent).not.toHaveBeenCalled();
  });

  it('limpa o escopo persistido de um UID sem expor outros usuários', async () => {
    await firstValueFrom(service.clearUserScope$('uid 1'));

    expect(persistence.deletePersistentByPrefix).toHaveBeenCalledWith(
      'app-cache:user:uid%201:'
    );
  });

  it('uma escrita nova vence reidratação antiga ainda em voo', async () => {
    const definition = memoryDefinition<string>({
      key: 'race:set-wins',
      storage: 'persistent',
    });
    const persistentRead = new Subject<CacheEnvelope<string> | null>();
    persistence.getEnvelopePersistent.mockReturnValue(
      persistentRead.asObservable()
    );

    const oldReadResult = firstValueFrom(service.get$(definition));

    await firstValueFrom(service.set$(definition, 'new-value'));

    persistentRead.next(persistedEnvelope('old-value'));
    persistentRead.complete();

    expect(await oldReadResult).toEqual({ status: 'miss' });
    expect(service.peek(definition)).toEqual({
      status: 'fresh',
      value: 'new-value',
    });
  });

  it('limpeza de sessão impede reidratação posterior de leitura antiga', async () => {
    const definition = memoryDefinition<string>({
      key: 'race:logout',
      storage: 'persistent',
    });
    const persistentRead = new Subject<CacheEnvelope<string> | null>();
    persistence.getEnvelopePersistent.mockReturnValue(
      persistentRead.asObservable()
    );

    const oldReadResult = firstValueFrom(service.get$(definition));

    await firstValueFrom(service.clearSessionScope$());

    persistentRead.next(persistedEnvelope('stale-session-value'));
    persistentRead.complete();

    expect(await oldReadResult).toEqual({ status: 'miss' });
    expect(service.peek(definition)).toEqual({ status: 'miss' });
  });
});
