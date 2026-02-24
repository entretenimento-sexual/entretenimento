// src/app/core/services/autentication/auth/auth-app-block.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { distinctUntilChanged, shareReplay } from 'rxjs/operators';
import type { TerminateReason } from './auth.types';

@Injectable({ providedIn: 'root' })
export class AuthAppBlockService {
  private readonly _reason$ = new BehaviorSubject<TerminateReason | null>(null);

  /** null = não bloqueado; TerminateReason = app bloqueado (sem logout) */
  readonly reason$: Observable<TerminateReason | null> = this._reason$.asObservable().pipe(
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  get snapshot(): TerminateReason | null {
    return this._reason$.value;
  }

  set(reason: TerminateReason | null): void {
    this._reason$.next(reason);
  }

  clear(): void {
    this._reason$.next(null);
  }
}
/*
src/app/core/services/autentication/auth/auth-session.service.ts
src/app/core/services/autentication/auth/current-user-store.service.ts
src/app/core/services/autentication/auth/auth-orchestrator.service.ts
src/app/core/services/autentication/auth/auth.facade.ts
src/app/core/services/autentication/auth/logout.service.ts
*/
