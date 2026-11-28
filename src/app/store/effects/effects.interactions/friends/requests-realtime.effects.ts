//src\app\store\effects\effects.interactions\friends\requests-realtime.effects.ts
import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { concat, defer, EMPTY, of, timer } from 'rxjs';
import { catchError, distinctUntilChanged, filter, map, switchMap, takeUntil, withLatestFrom } from 'rxjs/operators';
import * as A from '../../../actions/actions.interactions/actions.friends';
import * as RT from '../../../actions/actions.interactions/friends/friends-realtime.actions';
import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';
import { AccessControlService } from '@core/services/autentication/auth/access-control.service';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';
import { authSessionChanged } from 'src/app/store/actions/actions.user/auth.actions';

const PENDING_REQUEST_RETRY_FLOOR_MS = 60_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/** Quota hints extend, but never accelerate, the existing retry policy. */
export function pendingRequestsRetryDelay(error: unknown): number {
  if (!error || typeof error !== 'object') return PENDING_REQUEST_RETRY_FLOOR_MS;
  const { code, details } = error as { code?: unknown; details?: unknown };
  if (code !== 'functions/resource-exhausted' && code !== 'resource-exhausted') {
    return PENDING_REQUEST_RETRY_FLOOR_MS;
  }
  if (!details || typeof details !== 'object') return PENDING_REQUEST_RETRY_FLOOR_MS;
  const { retryAfterMs } = details as { retryAfterMs?: unknown };
  if (typeof retryAfterMs !== 'number' || !Number.isFinite(retryAfterMs) || retryAfterMs <= 0) {
    return PENDING_REQUEST_RETRY_FLOOR_MS;
  }
  return Math.max(PENDING_REQUEST_RETRY_FLOOR_MS,
    Math.min(MAX_TIMER_DELAY_MS, Math.ceil(retryAfterMs)));
}

@Injectable()
export class FriendsRequestsRealtimeEffects {
  private actions$ = inject(Actions);
  private svc = inject(FriendshipService);
  private access = inject(AccessControlService);
  private session = inject(AuthSessionService);
  private applicationError = inject(ApplicationErrorService);

  listenFriends$ = createEffect(() =>
  this.actions$.pipe(
    ofType(RT.startFriendsListener),
    withLatestFrom(this.access.authUid$),
    filter(([{ uid }, currentUid]) => uid === currentUid),
    switchMap(([{ uid }]) => {
      let observed = false;
      return this.session.authUser$.pipe(
        distinctUntilChanged(),
        switchMap(user => {
          if (user?.uid !== uid) return EMPTY;
          const reset = observed;
          observed = true;
          const watch$ = defer(() => this.svc.watchFriends(uid)).pipe(
            map(friends => RT.friendsChanged({ friends })),
            catchError((error, source) => {
              // Session replacement is a lifecycle signal, not a technical
              // incident. The outer auth stream immediately rearms the watch.
              if (error?.code === 'friends/session-revoked') {
                return of(RT.friendsChanged({ friends: [] }));
              }
              this.applicationError.report(error, {
                feature: 'friends', operation: 'FriendsRequestsRealtimeEffects.listenFriends$',
                fallbackMessage: 'Não foi possível atualizar suas conexões.',
                presentation: { surface: 'none', severity: 'error' },
              });
              return concat(
                of(RT.friendsChanged({ friends: [] })),
                of(A.loadFriendsFailure({ error: 'Não foi possível atualizar suas conexões.' })),
                timer(60_000).pipe(switchMap(() => source))
              );
            })
          );
          return reset ? concat(of(RT.friendsChanged({ friends: [] })), watch$) : watch$;
        }),
        takeUntil(this.actions$.pipe(ofType(RT.stopFriendsListener))),
        takeUntil(this.access.authUid$.pipe(filter(currentUid => currentUid !== uid)))
      );
    })
  )
);

  listenInboundRequests$ = createEffect(() =>
    this.actions$.pipe(
      ofType(RT.startInboundRequestsListener),
      withLatestFrom(this.access.authUid$),
      filter(([{ uid }, currentUid]) => uid === currentUid),
      switchMap(([{ uid }]) => {
        let observed = false;
        return this.session.authUser$.pipe(
          distinctUntilChanged(),
          switchMap(user => {
            if (user?.uid !== uid) return EMPTY;
            const reset = observed;
            observed = true;
            // Rebind even when the replacement AuthUser retains the same UID.
            // Preserve the observable across retries for session-retry accounting.
            const watch$ = this.svc.watchInboundRequests(uid, 'session').pipe(
              map(requests => RT.inboundRequestsChanged({ requests })),
              catchError((err, source) => concat(
                of(A.loadInboundRequestsFailure({ error: String(err?.message ?? err) })),
                timer(pendingRequestsRetryDelay(err)).pipe(switchMap(() => source))
              ))
            );
            return reset ? concat(of(RT.inboundRequestsChanged({ requests: [] })), watch$) : watch$;
          }),
          takeUntil(this.actions$.pipe(ofType(RT.stopInboundRequestsListener))),
          takeUntil(this.access.authUid$.pipe(filter(currentUid => currentUid !== uid)))
        );
      })
    )
  );

  listenOutboundRequests$ = createEffect(() =>
    this.actions$.pipe(
      ofType(RT.startOutboundRequestsListener),
      withLatestFrom(this.access.authUid$),
      filter(([{ uid }, currentUid]) => uid === currentUid),
      switchMap(([{ uid }]) => {
        let observed = false;
        return this.session.authUser$.pipe(
          distinctUntilChanged(),
          switchMap(user => {
            if (user?.uid !== uid) return EMPTY;
            const reset = observed;
            observed = true;
            // Rebind even when the replacement AuthUser retains the same UID.
            // Preserve the observable across retries for session-retry accounting.
            const watch$ = this.svc.watchOutboundRequests(uid, 'session').pipe(
              map(requests => RT.outboundRequestsChanged({ requests })),
              catchError((err, source) => concat(
                of(A.loadOutboundRequestsFailure({ error: String(err?.message ?? err) })),
                timer(pendingRequestsRetryDelay(err)).pipe(switchMap(() => source))
              ))
            );
            return reset ? concat(of(RT.outboundRequestsChanged({ requests: [] })), watch$) : watch$;
          }),
          takeUntil(this.actions$.pipe(ofType(RT.stopOutboundRequestsListener))),
          takeUntil(this.access.authUid$.pipe(filter(currentUid => currentUid !== uid)))
        );
      })
    )
  );

stopOnSessionNull$ = createEffect(() =>
  this.actions$.pipe(
    ofType(authSessionChanged),
    filter(({ uid }) => !uid),
    switchMap(() => of(
      RT.stopFriendsListener(),
      RT.stopInboundRequestsListener(),
      RT.stopOutboundRequestsListener(),
    ))
  )
);
}
