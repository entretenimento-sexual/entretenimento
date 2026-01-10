// src/app/core/services/data-handling/firestore/core/firestore-context.service.ts
import { Injectable, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { defer, from, Observable, of } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class FirestoreContextService {
  constructor(private readonly envInjector: EnvironmentInjector) { }

  run<T>(fn: () => T): T {
    return runInInjectionContext(this.envInjector, fn);
  }

  /** ✅ Sync dentro do injection context -> Observable */
  defer$<T>(fn: () => T): Observable<T> {
    return defer(() => this.run(() => of(fn())));
  }

  /** ✅ Promise dentro do injection context -> Observable (from nasce dentro do contexto) */
  deferPromise$<T>(fn: () => Promise<T>): Observable<T> {
    return defer(() => this.run(() => from(fn())));
  }

  /** ✅ Observable dentro do injection context -> Observable */
  deferObservable$<T>(fn: () => Observable<T>): Observable<T> {
    return defer(() => this.run(fn));
  }
}
