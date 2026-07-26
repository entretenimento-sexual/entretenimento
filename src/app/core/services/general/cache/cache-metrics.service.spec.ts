import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { CacheMetricsService } from './cache-metrics.service';

describe('CacheMetricsService', () => {
  let service: CacheMetricsService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CacheMetricsService);
  });

  it('calcula hit rate a partir de hits e misses', async () => {
    service.increment('memoryHits', 2);
    service.increment('indexedDbHits');
    service.increment('misses');

    await expect(firstValueFrom(service.hitRate$)).resolves.toBe(0.75);
  });

  it('registra tamanho de memória e tempo médio de reidratação', () => {
    service.recordMemorySize(12, 250);
    service.recordRehydration(10);
    service.recordRehydration(30);

    expect(service.snapshot()).toMatchObject({
      memoryEntries: 12,
      maxMemoryEntries: 250,
      rehydrationCount: 2,
      averageRehydrationMs: 20,
      lastRehydrationMs: 30,
    });
  });

  it('registra manutenção sem chaves ou conteúdo de cache', () => {
    service.recordMaintenance({
      scanned: 40,
      removed: 3,
      invalid: 1,
      expired: 2,
      durationMs: 12,
      completedAt: 1_000,
    });

    const snapshot = service.snapshot();
    expect(snapshot.lastMaintenance).toEqual({
      scanned: 40,
      removed: 3,
      invalid: 1,
      expired: 2,
      durationMs: 12,
      completedAt: 1_000,
    });
    expect(Object.keys(snapshot)).not.toContain('keys');
  });
});
