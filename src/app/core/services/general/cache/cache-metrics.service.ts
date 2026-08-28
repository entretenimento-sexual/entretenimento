import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, distinctUntilChanged, map } from 'rxjs';

export type CacheMetricCounter =
  | 'memoryHits'
  | 'indexedDbHits'
  | 'misses'
  | 'coalescedReads'
  | 'writes'
  | 'deletes'
  | 'expirations'
  | 'lruEvictions'
  | 'persistenceErrors';

export interface CacheMaintenanceMetrics {
  readonly scanned: number;
  readonly removed: number;
  readonly invalid: number;
  readonly expired: number;
  readonly durationMs: number;
  readonly completedAt: number;
}

export interface CacheMetricsSnapshot {
  readonly memoryHits: number;
  readonly indexedDbHits: number;
  readonly misses: number;
  readonly coalescedReads: number;
  readonly writes: number;
  readonly deletes: number;
  readonly expirations: number;
  readonly lruEvictions: number;
  readonly persistenceErrors: number;
  readonly memoryEntries: number;
  readonly maxMemoryEntries: number;
  readonly rehydrationCount: number;
  readonly averageRehydrationMs: number;
  readonly lastRehydrationMs: number | null;
  readonly lastMaintenance: CacheMaintenanceMetrics | null;
}

const INITIAL_METRICS: CacheMetricsSnapshot = {
  memoryHits: 0,
  indexedDbHits: 0,
  misses: 0,
  coalescedReads: 0,
  writes: 0,
  deletes: 0,
  expirations: 0,
  lruEvictions: 0,
  persistenceErrors: 0,
  memoryEntries: 0,
  maxMemoryEntries: 0,
  rehydrationCount: 0,
  averageRehydrationMs: 0,
  lastRehydrationMs: null,
  lastMaintenance: null,
};

/**
 * Métricas locais e anônimas do cache.
 *
 * Não recebe chaves, UIDs ou valores armazenados. O snapshot existe somente em
 * memória e pode ser observado por ferramentas de debug sem gerar telemetria.
 */
@Injectable({ providedIn: 'root' })
export class CacheMetricsService {
  private readonly subject = new BehaviorSubject<CacheMetricsSnapshot>(INITIAL_METRICS);

  readonly metrics$: Observable<CacheMetricsSnapshot> = this.subject.asObservable();
  readonly hitRate$: Observable<number> = this.metrics$.pipe(
    map((metrics) => {
      const hits = metrics.memoryHits + metrics.indexedDbHits;
      const reads = hits + metrics.misses;
      return reads > 0 ? hits / reads : 0;
    }),
    distinctUntilChanged()
  );

  increment(counter: CacheMetricCounter, amount = 1): void {
    if (!Number.isFinite(amount) || amount <= 0) return;

    const current = this.subject.value;
    this.subject.next({
      ...current,
      [counter]: current[counter] + Math.floor(amount),
    });
  }

  recordMemorySize(memoryEntries: number, maxMemoryEntries: number): void {
    const current = this.subject.value;
    const normalizedEntries = this.normalizeNonNegative(memoryEntries);
    const normalizedMax = this.normalizeNonNegative(maxMemoryEntries);

    if (
      current.memoryEntries === normalizedEntries &&
      current.maxMemoryEntries === normalizedMax
    ) {
      return;
    }

    this.subject.next({
      ...current,
      memoryEntries: normalizedEntries,
      maxMemoryEntries: normalizedMax,
    });
  }

  recordRehydration(durationMs: number): void {
    const normalizedDuration = Math.max(0, Number.isFinite(durationMs) ? durationMs : 0);
    const current = this.subject.value;
    const nextCount = current.rehydrationCount + 1;
    const totalBefore = current.averageRehydrationMs * current.rehydrationCount;

    this.subject.next({
      ...current,
      rehydrationCount: nextCount,
      averageRehydrationMs: (totalBefore + normalizedDuration) / nextCount,
      lastRehydrationMs: normalizedDuration,
    });
  }

  recordMaintenance(metrics: CacheMaintenanceMetrics): void {
    this.subject.next({
      ...this.subject.value,
      lastMaintenance: {
        scanned: this.normalizeNonNegative(metrics.scanned),
        removed: this.normalizeNonNegative(metrics.removed),
        invalid: this.normalizeNonNegative(metrics.invalid),
        expired: this.normalizeNonNegative(metrics.expired),
        durationMs: Math.max(0, Number(metrics.durationMs) || 0),
        completedAt: Number(metrics.completedAt) || Date.now(),
      },
    });
  }

  snapshot(): CacheMetricsSnapshot {
    return this.subject.value;
  }

  reset(): void {
    const { memoryEntries, maxMemoryEntries } = this.subject.value;
    this.subject.next({
      ...INITIAL_METRICS,
      memoryEntries,
      maxMemoryEntries,
    });
  }

  private normalizeNonNegative(value: number): number {
    return Math.max(0, Number.isFinite(value) ? Math.floor(value) : 0);
  }
}
