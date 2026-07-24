import 'fake-indexeddb/auto';

import { TestBed } from '@angular/core/testing';
import {
  clear as clearIndexedDb,
  get as getRaw,
  set as setRaw,
} from 'idb-keyval';
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
      service.setEnvelopePersistent(
        'app-cache:global:catalog',
        envelope
      )
    );

    expect(
      await firstValueFrom(
        service.getEnvelopePersistent<string>(
          'app-cache:global:catalog'
        )
      )
    ).toEqual(envelope);
  });

  it('retorna null quando a chave não existe', async () => {
    expect(
      await firstValueFrom(
        service.getEnvelopePersistent<string>('missing')
      )
    ).toBeNull();
  });

  it('bloqueia persistência de chaves sensíveis do CacheService legado', async () => {
    await firstValueFrom(
      service.setPersistent('preferences:uid-1', {
        praticaSexual: ['private'],
      })
    );
    await firstValueFrom(
      service.setPersistent('discovery:public_profiles:all', [
        { uid: 'uid-2' },
      ])
    );
    await firstValueFrom(
      service.setPersistent('user:uid-1', {
        uid: 'uid-1',
        email: 'private@example.com',
      })
    );

    expect(
      await firstValueFrom(
        service.getPersistent('preferences:uid-1')
      )
    ).toBeNull();
    expect(
      await firstValueFrom(
        service.getPersistent('discovery:public_profiles:all')
      )
    ).toBeNull();
    expect(
      await firstValueFrom(service.getPersistent('user:uid-1'))
    ).toBeNull();
  });

  it('recusa e apaga dado sensível gravado por versão anterior', async () => {
    const legacyKey = 'discovery:public_profiles:all';
    await setRaw(legacyKey, [{ uid: 'legacy-user' }]);

    expect(await getRaw(legacyKey)).toEqual([
      { uid: 'legacy-user' },
    ]);

    expect(
      await firstValueFrom(
        service.getPersistent(legacyKey)
      )
    ).toBeNull();
    expect(await getRaw(legacyKey)).toBeUndefined();
  });

  it('mantém persistência legada permitida para dados não bloqueados', async () => {
    await firstValueFrom(
      service.setPersistent('catalog:ibge:states', [
        { id: 33, sigla: 'RJ' },
      ])
    );

    expect(
      await firstValueFrom(
        service.getPersistent('catalog:ibge:states')
      )
    ).toEqual([{ id: 33, sigla: 'RJ' }]);
  });

  it('remove vários prefixos com uma única API', async () => {
    await firstValueFrom(
      service.setPersistent('app-cache:user:uid-1:profile', { id: 1 })
    );
    await firstValueFrom(
      service.setPersistent('app-cache:user:uid-1:preferences', {
        id: 2,
      })
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
