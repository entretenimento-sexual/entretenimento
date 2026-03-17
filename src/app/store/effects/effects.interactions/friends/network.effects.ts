// src/app/store/effects/effects.interactions/friends/network.effects.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { of, combineLatest } from 'rxjs';
import { catchError, distinctUntilChanged, map, mergeMap, switchMap, tap } from 'rxjs/operators';

import * as A from '../../../actions/actions.interactions/actions.friends';
import * as RT from '../../../actions/actions.interactions/friends/friends-realtime.actions';
import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';
import { environment } from 'src/environments/environment';
import { AccessControlService } from '@core/services/autentication/auth/access-control.service';

@Injectable()
export class FriendsNetworkEffects {
  constructor(
    private actions$: Actions,
    private svc: FriendshipService,
    private access: AccessControlService,
  ) { }

  private dbg(msg: string, extra?: unknown) {
    if (!environment.production) {
      // eslint-disable-next-line no-console
      console.log(`[FRIENDS_NET] ${msg}`, extra ?? '');
    }
  }

  /**
   * Gate único da feature Friends.
   *
   * Regras:
   * - só inicia em core
   * - exige uid válido
   * - quando sai do core, para listeners e limpa estado derivado
   */
  private readonly gate$ = combineLatest([
    this.access.canEnterCore$,
    this.access.authUid$,
  ]).pipe(
    map(([canEnterCore, uid]) => {
      const cleanUid = (uid ?? '').trim() || null;

      return {
        canRun: canEnterCore === true && !!cleanUid,
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
          A.loadFriends({ uid: gate.uid }),
          A.loadInboundRequests({ uid: gate.uid }),
          A.loadOutboundRequests({ uid: gate.uid }),
          A.loadBlockedUsers({ uid: gate.uid }),
          RT.startInboundRequestsListener({ uid: gate.uid }),
          RT.startOutboundRequestsListener({ uid: gate.uid }),
        );
      })
    )
  );

  loadFriends$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.loadFriends),
      switchMap(({ uid }) =>
        this.svc.listFriends(uid).pipe(
          map(friends => A.loadFriendsSuccess({ friends })),
          catchError(err => of(A.loadFriendsFailure({ error: String(err?.message ?? err) })))
        )
      )
    )
  );

  blockUser$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.blockUser),
      mergeMap(({ ownerUid, targetUid, reason }) =>
        this.svc.blockUser(ownerUid, targetUid, reason).pipe(
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
      mergeMap(({ ownerUid, targetUid }) =>
        this.svc.unblockUser(ownerUid, targetUid).pipe(
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
      switchMap(({ uid }) =>
        this.svc.listBlocked(uid).pipe(
          map(blocked => A.loadBlockedUsersSuccess({ blocked })),
          catchError(err => of(A.loadBlockedUsersFailure({ error: String(err?.message ?? err) })))
        )
      )
    )
  );
}
