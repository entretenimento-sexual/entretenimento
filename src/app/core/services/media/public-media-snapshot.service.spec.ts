import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { CacheService } from 'src/app/core/services/general/cache/cache.service';
import { PublicMediaSnapshotService } from './public-media-snapshot.service';

describe('PublicMediaSnapshotService', () => {
  function setup(cached: unknown = null) {
    const get = vi.fn(() => of(cached));
    const set = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        PublicMediaSnapshotService,
        {
          provide: CacheService,
          useValue: { get, set },
        },
      ],
    });

    return {
      service: TestBed.inject(PublicMediaSnapshotService),
      get,
      set,
    };
  }

  it('normaliza e remove itens duplicados do snapshot', async () => {
    const { service } = setup([
      { id: 'photo-1', url: 'one' },
      { id: 'photo-1', url: 'updated' },
      { id: '', url: 'invalid' },
      null,
    ]);

    const items = await firstValueFrom(service.read$('top-photos'));

    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe('photo-1');
    expect((items[0] as any)?.url).toBe('updated');
  });

  it('limita o snapshot público a 48 itens', async () => {
    const cached = Array.from({ length: 80 }, (_, index) => ({
      id: `photo-${index}`,
    }));
    const { service } = setup(cached);

    const items = await firstValueFrom(service.read$('boosted-photos'));

    expect(items).toHaveLength(48);
  });

  it('persiste somente a projeção normalizada com TTL curto', () => {
    const { service, set } = setup();

    service.write('top-photos', [
      { id: 'photo-1' } as any,
      { id: 'photo-1' } as any,
      { id: '' } as any,
    ]);

    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(
      'media:public:snapshot:top-photos',
      [{ id: 'photo-1' }],
      300_000,
      { persist: true }
    );
  });

  it('retorna lista vazia quando o cache não contém um array', async () => {
    const { service } = setup({ id: 'not-an-array' });

    await expect(
      firstValueFrom(service.read$('top-photos'))
    ).resolves.toEqual([]);
  });
});
