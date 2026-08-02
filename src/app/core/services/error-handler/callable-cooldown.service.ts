import { Injectable, inject } from '@angular/core';
import {
  BehaviorSubject,
  Observable,
  distinctUntilChanged,
  map,
  of,
  shareReplay,
  switchMap,
  tap,
  timer,
} from 'rxjs';

import {
  ICallableCooldownState,
  buildCallableCooldownState,
  isCallableResourceExhausted,
  resolveCallableRetryAfterMs,
} from './callable-cooldown.policy';
import { ErrorNotificationService } from './error-notification.service';

const EMPTY_EXPIRATIONS: Readonly<Record<string, number>> = Object.freeze({});

@Injectable({ providedIn: 'root' })
export class CallableCooldownService {
  private readonly notification = inject(ErrorNotificationService);
  private readonly expirationsSubject = new BehaviorSubject<
    Readonly<Record<string, number>>
  >(EMPTY_EXPIRATIONS);
  private readonly handledErrors = new WeakSet<object>();

  state$(scope: string): Observable<ICallableCooldownState> {
    const safeScope = this.normalizeScope(scope);

    return this.expirationsSubject.pipe(
      map((expirations) => expirations[safeScope] ?? 0),
      distinctUntilChanged(),
      switchMap((expiresAt) => {
        const initial = buildCallableCooldownState(safeScope, expiresAt);

        if (!initial.active) {
          return of(initial);
        }

        return timer(0, 1_000).pipe(
          map(() => buildCallableCooldownState(safeScope, expiresAt)),
          tap((state) => {
            if (!state.active) {
              this.clearExpiredScope(safeScope, expiresAt);
            }
          }),
          distinctUntilChanged(
            (previous, current) =>
              previous.active === current.active &&
              previous.remainingSeconds === current.remainingSeconds &&
              previous.expiresAt === current.expiresAt
          )
        );
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  captureResourceExhausted(
    error: unknown,
    scope: string,
    fallbackMs = 5_000
  ): boolean {
    if (!isCallableResourceExhausted(error)) {
      return false;
    }

    const safeScope = this.normalizeScope(scope);
    const retryAfterMs = resolveCallableRetryAfterMs(error, fallbackMs);
    const currentExpiration = this.expirationsSubject.value[safeScope] ?? 0;
    const expiresAt = Math.max(currentExpiration, Date.now() + retryAfterMs);

    this.expirationsSubject.next({
      ...this.expirationsSubject.value,
      [safeScope]: expiresAt,
    });
    this.markHandled(error);

    const seconds = Math.max(1, Math.ceil(retryAfterMs / 1_000));
    this.notification.showWarning(
      `Limite temporário atingido. Aguarde ${seconds} segundo(s) antes de tentar novamente.`
    );

    return true;
  }

  notifyIfActive(scope: string): boolean {
    const state = this.snapshot(scope);

    if (!state.active) {
      return false;
    }

    this.notification.showInfo(
      `Esta ação estará disponível novamente em ${state.remainingSeconds} segundo(s).`
    );

    return true;
  }

  snapshot(scope: string): ICallableCooldownState {
    const safeScope = this.normalizeScope(scope);
    return buildCallableCooldownState(
      safeScope,
      this.expirationsSubject.value[safeScope] ?? 0
    );
  }

  wasHandled(error: unknown): boolean {
    return typeof error === 'object' && error !== null
      ? this.handledErrors.has(error)
      : false;
  }

  private markHandled(error: unknown): void {
    if (typeof error === 'object' && error !== null) {
      this.handledErrors.add(error);
    }
  }

  private clearExpiredScope(scope: string, expectedExpiration: number): void {
    const current = this.expirationsSubject.value;

    if (current[scope] !== expectedExpiration) {
      return;
    }

    const next = { ...current };
    delete next[scope];
    this.expirationsSubject.next(next);
  }

  private normalizeScope(value: unknown): string {
    const normalized = String(value ?? '').trim();
    return normalized || 'callable';
  }
}
