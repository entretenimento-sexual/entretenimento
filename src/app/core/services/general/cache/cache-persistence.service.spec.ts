import { TestBed } from '@angular/core/testing';
import { createStore, get, set } from 'idb-keyval';
import { firstValueFrom } from 'rxjs';
import { vi } from 'vitest';

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

  it('não deixa manutenção apagar escrita nova da mesma chave', async () => {
    const cacheKey = key('cleanup-race');

    await firstValueFrom(
      service.setPersistentEntry(cacheKey, { version: 'expired' }, Date.now() - 1)
    );

    const cleanupPromise = firstValueFrom(
      service.cleanupExpiredEntries({ batchSize: 10, cursor: 0 })
    );
    const freshWritePromise = firstValueFrom(
      service.setPersistentEntry(
        cacheKey,
        { version: 'fresh' },
        Date.now() + 60_000
      )
    );

    const [cleanupResult] = await Promise.all([
      cleanupPromise,
      freshWritePromise,
    ]);
    const stored = await get<{
      value: { version: string };
      expiresAt: number | null;
    }>(cacheKey, persistenceStore);

    expect(cleanupResult.removed).toBe(0);
    expect(stored?.value).toEqual({ version: 'fresh' });
    expect(stored?.expiresAt).toBeGreaterThan(Date.now());
  });
  it('bloqueia gravação de A enfileirada antes de purga, mesmo quando a chave não existia no IndexedDB', async () => {
    const cacheKey = key('preferences:delayed-a');
    const internal = service as unknown as {
      enqueueMutation: (key: string, action: () => Promise<void>) => Promise<void>;
    };
    const enqueue = internal.enqueueMutation.bind(service);
    let releaseOldWrite!: () => void;
    const oldWriteGate = new Promise<void>((resolve) => { releaseOldWrite = resolve; });
    let first = true;
    const spy = vi.spyOn(internal, 'enqueueMutation').mockImplementation((entryKey, action) => {
      if (entryKey === cacheKey && first) {
        first = false;
        return enqueue(entryKey, async () => {
          await oldWriteGate;
          await action();
        });
      }
      return enqueue(entryKey, action);
    });

    const oldWrite = firstValueFrom(service.setPersistentEntry(
      cacheKey, { owner: 'user-a' }, Date.now() + 60_000
    ));
    const purge = firstValueFrom(service.purgeSensitiveSessionEntries([], [key('preferences:')]));

    releaseOldWrite();
    await Promise.all([oldWrite, purge]);
    expect(await get(cacheKey, persistenceStore)).toBeUndefined();
    spy.mockRestore();
  });

  it('preserva escrita nova de B durante purga mesmo quando a chave é a mesma', async () => {
    const cacheKey = key('user:profile');
    await firstValueFrom(service.setPersistentEntry(
      cacheKey, { owner: 'user-a' }, Date.now() + 60_000
    ));

    const purge = firstValueFrom(service.purgeSensitiveSessionEntries([], [key('user:')]));
    const writeB = firstValueFrom(service.setPersistentEntry(
      cacheKey, { owner: 'user-b' }, Date.now() + 60_000
    ));
    await Promise.all([purge, writeB]);

    const fresh = await firstValueFrom(service.getPersistentEntry<{ owner: string }>(cacheKey));
    expect(fresh?.value).toEqual({ owner: 'user-b' });
  });

  it('uma segunda transição A→B→A invalida a primeira purga sem eliminar a sessão mais recente', async () => {
    const cacheKey = key('search:account');
    await firstValueFrom(service.setPersistentEntry(
      cacheKey, { owner: 'user-a', seq: 1 }, Date.now() + 60_000
    ));

    const purgeA = firstValueFrom(service.purgeSensitiveSessionEntries([], [key('search:')]));
    const pendingB = firstValueFrom(service.setPersistentEntry(
      cacheKey, { owner: 'user-b' }, Date.now() + 60_000
    ));
    const purgeB = firstValueFrom(service.purgeSensitiveSessionEntries([], [key('search:')]));
    const freshA = firstValueFrom(service.setPersistentEntry(
      cacheKey, { owner: 'user-a', seq: 2 }, Date.now() + 60_000
    ));

    await Promise.all([purgeA, pendingB, purgeB, freshA]);
    const entry = await firstValueFrom(service.getPersistentEntry<{ owner: string; seq: number }>(cacheKey));
    expect(entry?.value).toEqual({ owner: 'user-a', seq: 2 });
  });

  it('nega leitura iniciada antes da transição e não devolve envelope de A após a purga', async () => {
    const cacheKey = key('preferences:read');
    await firstValueFrom(service.setPersistentEntry(
      cacheKey, { owner: 'user-a' }, Date.now() + 60_000
    ));

    const staleRead = firstValueFrom(service.getPersistentEntry(cacheKey));
    const purge = firstValueFrom(service.purgeSensitiveSessionEntries([], [key('preferences:')]));

    expect(await staleRead).toBeNull();
    await purge;
    expect(await get(cacheKey, persistenceStore)).toBeUndefined();
  });

  it('falha parcial de purga mantém leituras sensíveis fechadas até uma limpeza bem-sucedida', async () => {
    const cacheKey = key('user:stale-profile');
    await firstValueFrom(service.setPersistentEntry(
      cacheKey, { owner: 'user-a' }, Date.now() + 60_000
    ));

    const internal = service as unknown as {
      enqueueMutation: (key: string, action: () => Promise<void>) => Promise<void>;
    };
    const enqueue = internal.enqueueMutation.bind(service);
    let rejectOnce = true;
    const spy = vi.spyOn(internal, 'enqueueMutation').mockImplementation((entryKey, action) => {
      if (entryKey === cacheKey && rejectOnce) {
        rejectOnce = false;
        return Promise.reject(new Error('indexeddb delete unavailable'));
      }
      return enqueue(entryKey, action);
    });

    await expect(firstValueFrom(
      service.purgeSensitiveSessionEntries([], [key('user:')])
    )).rejects.toThrow('indexeddb delete unavailable');
    expect(await get(cacheKey, persistenceStore)).toBeTruthy();

    // A sessão B não recebe o envelope antigo, apesar de ele ainda existir.
    expect(await firstValueFrom(service.getPersistentEntry(cacheKey))).toBeNull();
    spy.mockRestore();

    await firstValueFrom(service.purgeSensitiveSessionEntries([], [key('user:')]));
    expect(await get(cacheKey, persistenceStore)).toBeUndefined();
  });

});
