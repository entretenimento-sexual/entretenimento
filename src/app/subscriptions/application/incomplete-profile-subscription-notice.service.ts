// src\app\subscriptions\application\incomplete-profile-subscription-notice.service.ts
// Serviço para controlar avisos de perfil incompleto no fluxo de assinatura.
//
// Responsabilidades:
// - decidir quando exibir avisos em subscription-plan, checkout e conta
// - controlar snooze/"lembrar depois"
// - marcar exibição após pagamento
//
// NÃO é service de autenticação.
// NÃO decide acesso.
// NÃO substitui guards.
// Atua apenas na camada de aviso/UX do domínio de assinatura.
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, combineLatest } from 'rxjs';
import { distinctUntilChanged, map, shareReplay } from 'rxjs/operators';

import { IUserDados } from '@core/interfaces/iuser-dados';

export type SubscriptionNoticeContext =
  | 'subscription-plan'
  | 'checkout'
  | 'post-payment'
  | 'account'
  | 'feature-block';

export interface IncompleteProfileSubscriptionNoticeState {
  dismissedAt: number | null;
  snoozeUntil: number | null;
  lastShownAt: number | null;
  shownAfterLastPayment: boolean;
  lastPaymentAt: number | null;
}

const INITIAL_STATE: IncompleteProfileSubscriptionNoticeState = {
  dismissedAt: null,
  snoozeUntil: null,
  lastShownAt: null,
  shownAfterLastPayment: false,
  lastPaymentAt: null,
};

@Injectable({ providedIn: 'root' })
export class IncompleteProfileSubscriptionNoticeService {
  private readonly stateSubject =
    new BehaviorSubject<IncompleteProfileSubscriptionNoticeState>(INITIAL_STATE);

  readonly state$ = this.stateSubject.asObservable().pipe(
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  hydrate(uid: string | null | undefined): void {
    const safeUid = (uid ?? '').trim();

    if (!safeUid) {
      this.stateSubject.next(INITIAL_STATE);
      return;
    }

    try {
      const raw = localStorage.getItem(this.buildStorageKey(safeUid));

      if (!raw) {
        this.stateSubject.next(INITIAL_STATE);
        return;
      }

      const parsed = JSON.parse(raw) as Partial<IncompleteProfileSubscriptionNoticeState>;

      this.stateSubject.next({
        ...INITIAL_STATE,
        ...(parsed ?? {}),
      });
    } catch {
      this.stateSubject.next(INITIAL_STATE);
    }
  }

  clear(uid: string | null | undefined): void {
    const safeUid = (uid ?? '').trim();

    if (!safeUid) {
      this.stateSubject.next(INITIAL_STATE);
      return;
    }

    try {
      localStorage.removeItem(this.buildStorageKey(safeUid));
    } catch {
      // noop
    }

    this.stateSubject.next(INITIAL_STATE);
  }

  markPaymentSuccess(uid: string | null | undefined): void {
    const safeUid = (uid ?? '').trim();
    if (!safeUid) return;

    const nextState: IncompleteProfileSubscriptionNoticeState = {
      ...this.stateSubject.value,
      lastPaymentAt: Date.now(),
      shownAfterLastPayment: false,
      snoozeUntil: null,
    };

    this.persist(safeUid, nextState);
  }

  markShown(uid: string | null | undefined): void {
    const safeUid = (uid ?? '').trim();
    if (!safeUid) return;

    const nextState: IncompleteProfileSubscriptionNoticeState = {
      ...this.stateSubject.value,
      lastShownAt: Date.now(),
      shownAfterLastPayment: true,
    };

    this.persist(safeUid, nextState);
  }

  snooze(uid: string | null | undefined, days = 7): void {
    const safeUid = (uid ?? '').trim();
    if (!safeUid) return;

    const now = Date.now();

    const nextState: IncompleteProfileSubscriptionNoticeState = {
      ...this.stateSubject.value,
      dismissedAt: now,
      snoozeUntil: now + days * 24 * 60 * 60 * 1000,
    };

    this.persist(safeUid, nextState);
  }

  shouldShow$(
    user$: Observable<IUserDados | null>,
    context$: Observable<SubscriptionNoticeContext>
  ): Observable<boolean> {
    return combineLatest([user$, context$, this.state$]).pipe(
      map(([user, context, state]) => {
        if (!user?.uid) return false;
        if (user.emailVerified !== true) return false;
        if (user.profileCompleted === true) return false;

        const now = Date.now();

        if (context === 'subscription-plan') return true;
        if (context === 'checkout') return true;
        if (context === 'feature-block') return true;

        if (context === 'post-payment') {
          return state.shownAfterLastPayment !== true;
        }

        if (context === 'account') {
          if (state.snoozeUntil && state.snoozeUntil > now) {
            return false;
          }

          if (!state.lastShownAt) {
            return true;
          }

          const sevenDays = 7 * 24 * 60 * 60 * 1000;
          return now - state.lastShownAt >= sevenDays;
        }

        return false;
      }),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private persist(
    uid: string,
    state: IncompleteProfileSubscriptionNoticeState
  ): void {
    this.stateSubject.next(state);

    try {
      localStorage.setItem(this.buildStorageKey(uid), JSON.stringify(state));
    } catch {
      // noop
    }
  }

  private buildStorageKey(uid: string): string {
    return `subscriptions:incomplete-profile-notice:${uid}`;
  }
}