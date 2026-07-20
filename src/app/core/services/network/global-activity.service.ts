// src/app/core/services/network/global-activity.service.ts
// -----------------------------------------------------------------------------
// GLOBAL ACTIVITY SERVICE
// -----------------------------------------------------------------------------
// Contador reativo para operações assíncronas relevantes. O indicador global só
// aparece quando a operação ultrapassa o limiar, evitando piscar em ações rápidas.
// -----------------------------------------------------------------------------
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, defer, of, timer } from 'rxjs';
import {
  distinctUntilChanged,
  finalize,
  map,
  shareReplay,
  startWith,
  switchMap,
} from 'rxjs/operators';

const SLOW_OPERATION_THRESHOLD_MS = 900;

@Injectable({ providedIn: 'root' })
export class GlobalActivityService {
  private readonly activeCountSubject = new BehaviorSubject(0);

  readonly activeCount$: Observable<number> =
    this.activeCountSubject.asObservable().pipe(
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly isBusy$: Observable<boolean> = this.activeCount$.pipe(
    map((count) => count > 0),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly isSlow$: Observable<boolean> = this.isBusy$.pipe(
    switchMap((busy) =>
      busy
        ? timer(SLOW_OPERATION_THRESHOLD_MS).pipe(
          map(() => true),
          startWith(false)
        )
        : of(false)
    ),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  track$<T>(operation$: Observable<T>): Observable<T> {
    return defer(() => {
      this.increment();
      let released = false;

      return operation$.pipe(
        finalize(() => {
          if (released) return;
          released = true;
          this.decrement();
        })
      );
    });
  }

  private increment(): void {
    this.activeCountSubject.next(this.activeCountSubject.value + 1);
  }

  private decrement(): void {
    this.activeCountSubject.next(
      Math.max(0, this.activeCountSubject.value - 1)
    );
  }
}
