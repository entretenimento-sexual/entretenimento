// src/app/store/effects/effects.interactions/friends/network.effects.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { of, combineLatest } from 'rxjs';
import { catchError, distinctUntilChanged, filter, map, mergeMap, switchMap, takeUntil, tap, withLatestFrom } from 'rxjs/operators';

import * as A from '../../../actions/actions.interactions/actions.friends';
import * as RT from '../../../actions/actions.interactions/friends/friends-realtime.actions';
import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';
import { AccessControlService } from '@core/services/autentication/auth/access-control.service';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import * as P from '../../../actions/actions.interactions/friends/friends-pagination.actions';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';

@Injectable()
export class FriendsNetworkEffects {
  constructor(
    private actions$: Actions,
    private svc: FriendshipService,
    private access: AccessControlService,
    private notifier: ErrorNotificationService,
    private privacyDebug: PrivacyDebugLoggerService,
    private session: AuthSessionService
  ) {}

private dbg(msg: string, extra?: unknown): void {
  this.privacyDebug.log('friends', `NET: ${msg}`, extra);
}

  /**
   * Gate único da feature Friends.
   *
   * Regras:
   * - só inicia em core
   * - exige elegibilidade social adulta já confirmada
   * - exige uid válido
   * - quando qualquer gate fecha, para listeners e limpa estado derivado
   */
  private readonly gate$ = combineLatest([
    this.access.canEnterCore$,
    this.access.canUseAdultSocial$,
    this.access.authUid$,
  ]).pipe(
    map(([canEnterCore, canUseAdultSocial, uid]) => {
      const cleanUid = (uid ?? '').trim() || null;

      return {
        canRun:
          canEnterCore === true &&
          canUseAdultSocial === true &&
          !!cleanUid,
        uid: cleanUid,
      };
    }),
    distinctUntilChanged((a, b) =>
      a.canRun === b.canRun &&
      a.uid === b.uid
    )
  );

  bootstrapOnEligibleUser$ = createEffect(() =>
    this.gate$.pipe(
      tap((gate) => this.dbg('bootstrap gate', gate)),

      switchMap((gate) => {
        if (!gate.canRun || !gate.uid) {
          this.dbg('gate=false -> stop/clear');

          return of(
            RT.stopFriendsListener(),
            RT.stopInboundRequestsListener(),
            RT.stopOutboundRequestsListener(),

            A.loadFriendsSuccess({ friends: [] }),
            A.loadInboundRequestsSuccess({ requests: [] }),
            A.loadOutboundRequestsSuccess({ requests: [] }),
            A.loadBlockedUsersSuccess({ blocked: [] }),
          );
        }

        this.dbg('gate=true -> bootstrap feature', { uid: gate.uid });

        return of(
          // Os listeners de amigos e solicitações já realizam a leitura inicial.
          // Não iniciar uma listagem pontual concorrente no bootstrap.
          A.loadBlockedUsers({ uid: gate.uid }),
          RT.startFriendsListener({ uid: gate.uid }),
          RT.startInboundRequestsListener({ uid: gate.uid }),
          RT.startOutboundRequestsListener({ uid: gate.uid }),
        );
      })
    )
  );

  loadFriends$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.loadFriends),
      withLatestFrom(this.access.authUid$, this.session.authUser$),
      filter(([{ uid }, currentUid, user]) => uid === currentUid && user?.uid === uid),
      switchMap(([{ uid }, , user]) =>
        this.svc.listFriends(uid).pipe(
          takeUntil(this.session.authUser$.pipe(filter(current => current !== user))),
          takeUntil(this.access.authUid$.pipe(filter(currentUid => currentUid !== uid))),
          map(friends => A.loadFriendsSuccess({ friends })),
          catchError(err => of(A.loadFriendsFailure({ error: String(err?.message ?? err) })))
        )
      )
    )
  );

  endFriendship$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.endFriendship),
      withLatestFrom(this.access.authUid$, this.session.authUser$),
      filter(([{ ownerUid }, currentUid, user]) => ownerUid === currentUid && user?.uid === ownerUid),
      mergeMap(([{ ownerUid, friendUid }, , user]) =>
        this.svc.endFriendship(ownerUid, friendUid).pipe(
          takeUntil(this.session.authUser$.pipe(filter(current => current !== user))),
          takeUntil(this.access.authUid$.pipe(filter(currentUid => currentUid !== ownerUid))),
          mergeMap(endedThrough => {
            this.notifier.showSuccess('Amizade desfeita.');
            return of(
              A.endFriendshipSuccess({ ownerUid, friendUid, endedThrough }),
              P.removeFriendFromFriendsPage({ uid: ownerUid, friendUid, endedThrough })
            );
          }),
          catchError(err => {
            const msg = String(err?.message ?? 'Não foi possível desfazer a amizade.');
            this.notifier.showError(msg);
            return of(A.endFriendshipFailure({ error: msg }));
          })
        )
      )
    )
  );

  blockUser$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.blockUser),
    withLatestFrom(this.access.authUid$),
    filter(([{ ownerUid }, currentUid]) => ownerUid === currentUid),
    mergeMap(([{ ownerUid, targetUid, reason }]) =>
        this.svc.blockUser(ownerUid, targetUid, reason).pipe(
        takeUntil(this.access.authUid$.pipe(filter(currentUid => currentUid !== ownerUid))),
          mergeMap(() => of(
            A.blockUserSuccess({ ownerUid, targetUid }),
            A.loadBlockedUsers({ uid: ownerUid })
          )),
          catchError(err => of(A.blockUserFailure({ error: String(err?.message ?? err) })))
        )
      )
    )
  );

  unblockUser$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.unblockUser),
    withLatestFrom(this.access.authUid$),
    filter(([{ ownerUid }, currentUid]) => ownerUid === currentUid),
    mergeMap(([{ ownerUid, targetUid }]) =>
        this.svc.unblockUser(ownerUid, targetUid).pipe(
        takeUntil(this.access.authUid$.pipe(filter(currentUid => currentUid !== ownerUid))),
          mergeMap(() => of(
            A.unblockUserSuccess({ ownerUid, targetUid }),
            A.loadBlockedUsers({ uid: ownerUid })
          )),
          catchError(err => of(A.unblockUserFailure({ error: String(err?.message ?? err) })))
        )
      )
    )
  );

  loadBlocked$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.loadBlockedUsers),
      withLatestFrom(this.access.authUid$),
      filter(([{ uid }, currentUid]) => uid === currentUid),
      switchMap(([{ uid }]) =>
        this.svc.listBlocked(uid).pipe(
          takeUntil(this.access.authUid$.pipe(filter(currentUid => currentUid !== uid))),
          map(blocked => A.loadBlockedUsersSuccess({ blocked })),
          catchError(err => of(A.loadBlockedUsersFailure({ error: String(err?.message ?? err) })))
        )
      )
    )
  );

}
