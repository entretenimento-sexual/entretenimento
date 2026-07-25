import { TestBed } from '@angular/core/testing';
import { clear, get, set } from 'idb-keyval';
import { firstValueFrom } from 'rxjs';

import {
  CACHE_PERSISTENCE_SCHEMA_VERSION,
  CachePersistenceService,
} from './cache-persistence.service';

describe('CachePersistenceService', () => {
  let service: CachePersistenceService;

  beforeEach(async () => {
    await clear();

    TestBed.configureTestingModule({});
    service = TestBed.inject(CachePersistenceService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('persiste e recupera valor com expiração absoluta no envelope v2', async () => {
    const expiresAt = Date.now() + 60_000;

    await firstValueFrom(
      service.setPersistentEntry('cache:profile', { nickname: 'perfil' }, expiresAt)
    );

    const entry = await firstValueFrom(
      service.getPersistentEntry<{ nickname: string }>('cache:profile')
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
    await firstValueFrom(
      service.setPersistentEntry(
        'cache:expired',
        { stale: true },
        Date.now() - 1
      )
    );

    const entry = await firstValueFrom(
      service.getPersistentEntry<{ stale: boolean }>('cache:expired')
    );

    expect(entry).toBeNull();
    expect(await get('cache:expired')).toBeUndefined();
  });

  it('descarta valor legado sem envelope na primeira leitura', async () => {
    await set('cache:legacy', { oldShape: true });

    const entry = await firstValueFrom(
      service.getPersistentEntry<{ oldShape: boolean }>('cache:legacy')
    );

    expect(entry).toBeNull();
    expect(await get('cache:legacy')).toBeUndefined();
  });

  it('preserva a ordem de escritas concorrentes da mesma chave', async () => {
    const firstWrite$ = service.setPersistentEntry(
      'cache:ordered',
      { version: 1 },
      Date.now() + 60_000
    );
    const secondWrite$ = service.setPersistentEntry(
      'cache:ordered',
      { version: 2 },
      Date.now() + 120_000
    );

    await Promise.all([
      firstValueFrom(firstWrite$),
      firstValueFrom(secondWrite$),
    ]);

    const entry = await firstValueFrom(
      service.getPersistentEntry<{ version: number }>('cache:ordered')
    );

    expect(entry?.value).toEqual({ version: 2 });
    expect(entry?.writeVersion).toBe(2);
  });

  it('mantém os métodos legados compatíveis com valores não expirantes', async () => {
    await firstValueFrom(
      service.setPersistent('cache:compat', { enabled: true })
    );

    await expect(
      firstValueFrom(
        service.getPersistent<{ enabled: boolean }>('cache:compat')
      )
    ).resolves.toEqual({ enabled: true });
  });
});
