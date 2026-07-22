// src/app/core/services/subscriptions/platform-subscription-access.service.ts
// -----------------------------------------------------------------------------
// PLATFORM SUBSCRIPTION ACCESS SERVICE
// -----------------------------------------------------------------------------
// Fonte única de capacidades pagas no Angular.
//
// - consome somente a projeção canônica do usuário atual;
// - reavalia no início e no fim do período sem exigir reload;
// - faz checagens intermediárias para evitar limites longos de setTimeout;
// - sincroniza aliases de runtime para consumidores legados;
// - não grava Firestore nem substitui o entitlement como verdade financeira.
// -----------------------------------------------------------------------------

import { Injectable, inject } from '@angular/core';
import {
  Observable,
  Subscription,
  concat,
  defer,
  of,
  timer,
} from 'rxjs';
import {
  distinctUntilChanged,
  map,
  shareReplay,
  switchMap,
  tap,
} from 'rxjs/operators';

import type { IUserDados } from '../../interfaces/iuser-dados';
import { CurrentUserStoreService } from '../autentication/auth/current-user-store.service';
import {
  PlatformSubscriptionAccessState,
  PlatformSubscriptionRole,
  evaluatePlatformSubscriptionProjection,
  hasMinimumPlatformSubscriptionRole,
} from './platform-subscription-access.model';

const MAX_BOUNDARY_CHECK_MS = 6 * 60 * 60 * 1000;
const BOUNDARY_TOLERANCE_MS = 50;

@Injectable({ providedIn: 'root' })
export class PlatformSubscriptionAccessService {
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private runtimeSubscription: Subscription | null = null;

  readonly state$: Observable<PlatformSubscriptionAccessState> =
    this.currentUserStore.user$.pipe(
      switchMap((user) => this.observeProjectionWindow$(user)),
      tap((state) => this.synchronizeRuntimeAliases(state)),
      distinctUntilChanged((previous, current) =>
        previous.active === current.active &&
        previous.role === current.role &&
        previous.startsAt === current.startsAt &&
        previous.endsAt === current.endsAt &&
        previous.projectionVersion === current.projectionVersion &&
        previous.reason === current.reason
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly isSubscriber$ = this.state$.pipe(
    map((state) => state.active),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly isFree$ = this.isSubscriber$.pipe(
    map((active) => !active),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly role$ = this.state$.pipe(
    map((state) => state.role),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly endsAt$ = this.state$.pipe(
    map((state) => state.endsAt),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /** Ativa o relógio canônico uma única vez durante o bootstrap do app. */
  start(): void {
    if (this.runtimeSubscription && !this.runtimeSubscription.closed) return;
    this.runtimeSubscription = this.state$.subscribe();
  }

  hasAtLeast$(
    minimumRole: PlatformSubscriptionRole
  ): Observable<boolean> {
    return this.role$.pipe(
      map((role) => hasMinimumPlatformSubscriptionRole(role, minimumRole)),
      distinctUntilChanged()
    );
  }

  private observeProjectionWindow$(
    user: IUserDados | null | undefined
  ): Observable<PlatformSubscriptionAccessState> {
    return defer(() => {
      const now = Date.now();
      const state = evaluatePlatformSubscriptionProjection(user, now);
      const nextBoundary = state.active
        ? state.endsAt
        : state.reason === 'not-started'
          ? state.startsAt
          : null;

      if (nextBoundary === null) {
        return of(state);
      }

      const remaining = Math.max(
        0,
        nextBoundary - now + BOUNDARY_TOLERANCE_MS
      );
      const delay = Math.min(remaining, MAX_BOUNDARY_CHECK_MS);

      return concat(
        of(state),
        timer(delay).pipe(
          switchMap(() => this.observeProjectionWindow$(user))
        )
      );
    });
  }

  private synchronizeRuntimeAliases(
    state: PlatformSubscriptionAccessState
  ): void {
    const current = this.currentUserStore.getSnapshot();
    if (!current || current === null) return;

    const preserveAdmin = current.role === 'admin';
    const nextRole = preserveAdmin
      ? 'admin'
      : state.active
        ? state.role!
        : 'free';
    const nextTier = state.active ? state.role : 'free';
    const nextStatus = state.active ? 'active' : 'inactive';
    const nextScope = state.active ? 'platform_subscription' : null;

    const alreadySynchronized =
      current.role === nextRole &&
      current.tier === nextTier &&
      current.isSubscriber === state.active &&
      current.monthlyPayer === state.active &&
      current.subscriptionStatus === nextStatus &&
      current.subscriptionScope === nextScope;

    if (alreadySynchronized) return;

    this.currentUserStore.patch({
      role: nextRole,
      tier: nextTier,
      isSubscriber: state.active,
      monthlyPayer: state.active,
      subscriptionStatus: nextStatus,
      subscriptionScope: nextScope,
    });
  }
}
