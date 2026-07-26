import { TestBed } from '@angular/core/testing';
import { createStore, get, set } from 'idb-keyval';
import { firstValueFrom } from 'rxjs';

import {
  CACHE_PERSISTENCE_SCHEMA_VERSION,
  CACHE_PERSISTENCE_STORE,
  CachePersistenceService,
  type CachePersistenceStore,
} from './cache-persistence.service';

const SUITE_DB_PREFIX = [
  'cache-persistence-spec',
  Date.now(),
  Math.random().toString(36).slice(2),
].join(':');

let testSequence = 0;

describe('CachePersistenceService', () => {
  let service: CachePersistenceService;
  let persistenceStore: CachePersistenceStore;
  let testKeyPrefix: string;

  beforeEach(() => {
    const testId = ++testSequence;
    testKeyPrefix = `case:${testId}`;
    persistenceStore = createStore(`${SUITE_DB_PREFIX}:${testId}`, 'keyval');

    TestBed.configureTestingModule({
      providers: [
        {
          provide: CACHE_PERSISTENCE_STORE,
          useValue: persistenceStore,
        },
      ],
    });
    service = TestBed.inject(CachePersistenceService);
  });

  const key = (suffix: string): string => `${testKeyPrefix}:${suffix}`;

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('persiste e recupera valor com expiração absoluta no envelope v2', async () => {
    const cacheKey = key('profile');
    const expiresAt = Date.now() + 60_000;

    await firstValueFrom(
      service.setPersistentEntry(cacheKey, { nickname: 'perfil' }, expiresAt)
    );

    const entry = await firstValueFrom(
      service.getPersistentEntry<{ nickname: string }>(cacheKey)
    );

    expect(entry).toMatchObject({
      schemaVersion: CACHE_PERSISTENCE_SCHEMA_VERSION,
      value: { nickname: 'perfil' },
      expiresAt,
      writeVersion: 1,
    });
    expect(entry?.createdAt).toEqual(expect.any(Number));
    expect(entry?.updatedAt).toEqual(expect.any(Number));
  });

  it('remove entrada expirada do IndexedDB em vez de renová-la', async () => {
    const cacheKey = key('expired');

    await firstValueFrom(
      service.setPersistentEntry(
        cacheKey,
        { stale: true },
        Date.now() - 1
      )
    );

    const entry = await firstValueFrom(
      service.getPersistentEntry<{ stale: boolean }>(cacheKey)
    );

    expect(entry).toBeNull();
    expect(await get(cacheKey, persistenceStore)).toBeUndefined();
  });

  it('descarta valor legado sem envelope na primeira leitura', async () => {
    const cacheKey = key('legacy');

    await set(cacheKey, { oldShape: true }, persistenceStore);

    const entry = await firstValueFrom(
      service.getPersistentEntry<{ oldShape: boolean }>(cacheKey)
    );

    expect(entry).toBeNull();
    expect(await get(cacheKey, persistenceStore)).toBeUndefined();
  });

  it('preserva a ordem de escritas concorrentes da mesma chave', async () => {
    const cacheKey = key('ordered');
    const firstWrite$ = service.setPersistentEntry(
      cacheKey,
      { version: 1 },
      Date.now() + 60_000
    );
    const secondWrite$ = service.setPersistentEntry(
      cacheKey,
      { version: 2 },
      Date.now() + 120_000
    );

    await Promise.all([
      firstValueFrom(firstWrite$),
      firstValueFrom(secondWrite$),
    ]);

    const entry = await firstValueFrom(
      service.getPersistentEntry<{ version: number }>(cacheKey)
    );

    expect(entry?.value).toEqual({ version: 2 });
    expect(entry?.writeVersion).toBe(2);
  });

  it('mantém os métodos legados compatíveis com valores não expirantes', async () => {
    const cacheKey = key('compat');

    await firstValueFrom(
      service.setPersistent(cacheKey, { enabled: true })
    );

    await expect(
      firstValueFrom(
        service.getPersistent<{ enabled: boolean }>(cacheKey)
      )
    ).resolves.toEqual({ enabled: true });
  });

  it('limpa lote expirado ou legado sem remover entrada válida', async () => {
    const validKey = key('cleanup-valid');
    const expiredKey = key('cleanup-expired');
    const legacyKey = key('cleanup-legacy');

    await firstValueFrom(
      service.setPersistentEntry(validKey, { valid: true }, Date.now() + 60_000)
    );
    await firstValueFrom(
      service.setPersistentEntry(expiredKey, { expired: true }, Date.now() - 1)
    );
    await set(legacyKey, { oldShape: true }, persistenceStore);

    const result = await firstValueFrom(
      service.cleanupExpiredEntries({ batchSize: 100, cursor: 0 })
    );

    expect(result).toMatchObject({
      totalKeys: 3,
      scanned: 3,
      removed: 2,
      invalid: 1,
      expired: 1,
      nextCursor: 0,
    });
    expect(await get(validKey, persistenceStore)).toBeTruthy();
    expect(await get(expiredKey, persistenceStore)).toBeUndefined();
    expect(await get(legacyKey, persistenceStore)).toBeUndefined();
  });
});
