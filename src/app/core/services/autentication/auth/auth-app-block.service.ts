// src/app/core/services/autentication/auth/auth-app-block.service.ts
// Não esquecer comentários explicativos e ferramentas de debug
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { distinctUntilChanged, shareReplay } from 'rxjs/operators';
import type { SessionEndReason, TerminateReason } from './auth.types';
import { clearAuthInvalidUid, markAuthInvalidUid } from '@core/firebase/auth-invalid-session-marker';

interface AuthInvalidation {
  uid: string;
  reason: SessionEndReason;
}

@Injectable({ providedIn: 'root' })
export class AuthAppBlockService {
  private domainBlockUid: string | null = null;
  private readonly _reason$ = new BehaviorSubject<TerminateReason | null>(null);

  private readonly invalidationSubject = new BehaviorSubject<AuthInvalidation | null>(null);
  readonly invalidation$ = this.invalidationSubject.asObservable();

  get invalidationSnapshot(): AuthInvalidation | null {
    return this.invalidationSubject.value;
  }

  recordInvalidation(uid: string, reason: SessionEndReason, block: boolean): void {
    markAuthInvalidUid(uid, reason);
    this.applyInvalidation(uid, reason, block);
  }

  applyInvalidation(uid: string, reason: SessionEndReason, block: boolean): void {
    const current = this.invalidationSnapshot;
    if (current?.uid !== uid || current.reason !== reason) {
      this.invalidationSubject.next({ uid, reason });
    }
    if (block && this.snapshot !== 'auth-invalid') this.set('auth-invalid');
  }

  resolveInvalidation(uid: string): void {
    clearAuthInvalidUid(uid);
    if (this.invalidationSnapshot?.uid === uid) this.forgetInvalidation();
  }

  forgetInvalidation(): void {
    this.invalidationSubject.next(null);
    if (this.snapshot === 'auth-invalid') this.clear();
  }

  /** null = não bloqueado; TerminateReason = app bloqueado (sem logout) */
  readonly reason$: Observable<TerminateReason | null> = this._reason$.asObservable().pipe(
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  get snapshot(): TerminateReason | null {
    return this._reason$.value;
  }

  domainBlockFor(uid: string | null | undefined): Exclude<TerminateReason, 'auth-invalid'> | null {
    const reason = this.snapshot;
    return uid && uid === this.domainBlockUid && reason !== 'auth-invalid' ? reason : null;
  }

  set(reason: TerminateReason | null, uid?: string): void {
    this.domainBlockUid = reason && reason !== 'auth-invalid' ? uid ?? null : null;
    this._reason$.next(reason);
  }

  clear(): void {
    this.set(null);
  }
}
/*
src/app/core/services/autentication/auth/auth-session.service.ts
src/app/core/services/autentication/auth/current-user-store.service.ts
src/app/core/services/autentication/auth/auth-orchestrator.service.ts
src/app/core/services/autentication/auth/auth.facade.ts
src/app/core/services/autentication/auth/logout.service.ts
*/
// Verificar migrações de responsabilidades para o:
// 1 - auth-route-context.service.ts, e;
// 2 - auth-user-document-watch.service.ts, e;
// 3 - auth-session-monitor.service.ts.
