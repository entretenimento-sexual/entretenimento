import 'fake-indexeddb/auto';

import { TestBed } from '@angular/core/testing';
import { clear as clearIndexedDb } from 'idb-keyval';
import { firstValueFrom } from 'rxjs';

import { CacheEnvelope } from './cache-contracts';
import { CachePersistenceService } from './cache-persistence.service';

describe('CachePersistenceService', () => {
  let service: CachePersistenceService;

  beforeEach(async () => {
    await clearIndexedDb();
    TestBed.configureTestingModule({});
    service = TestBed.inject(CachePersistenceService);
  });

  afterEach(async () => {
    await clearIndexedDb();
  });

  it('persiste e recupera o envelope completo', async () => {
    const envelope: CacheEnvelope<string> = {
      value: 'catalog-value',
      createdAt: 1_000,
      expiresAt: 31_000,
      staleUntil: 41_000,
      version: 2,
      scope: 'global',
      sensitivity: 'public',
    };

    await firstValueFrom(
      service.setEnvelopePersistent('app-cache:global:catalog', envelope)
    );

    const restored = await firstValueFrom(
      service.getEnvelopePersistent<string>(
        'app-cache:global:catalog'
      )
    );

    expect(restored).toEqual(envelope);
  });

  it('retorna null quando a chave não existe', async () => {
    const restored = await firstValueFrom(
      service.getEnvelopePersistent<string>('missing')
    );

    expect(restored).toBeNull();
  });

  it('remove vários prefixos com uma única API', async () => {
    await firstValueFrom(
      service.setPersistent('app-cache:user:uid-1:profile', { id: 1 })
    );
    await firstValueFrom(
      service.setPersistent('app-cache:user:uid-1:preferences', { id: 2 })
    );
    await firstValueFrom(
      service.setPersistent('app-cache:session:validation', { id: 3 })
    );
    await firstValueFrom(
      service.setPersistent('unrelated:key', { id: 4 })
    );

    const deleted = await firstValueFrom(
      service.deletePersistentByPrefixes([
        'app-cache:user:uid-1:',
        'app-cache:session:',
      ])
    );

    expect(deleted).toBe(3);
    expect(
      await firstValueFrom(
        service.getPersistent('app-cache:user:uid-1:profile')
      )
    ).toBeNull();
    expect(
      await firstValueFrom(service.getPersistent('unrelated:key'))
    ).toEqual({ id: 4 });
  });
});
