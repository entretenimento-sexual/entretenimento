// src/app/store/effects/effects.interactions/friends-requests.effects.ts
import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';
import { Store } from '@ngrx/store';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { of } from 'rxjs';
import { catchError, concatMap, filter, map, mergeMap, switchMap, takeUntil, tap, withLatestFrom, exhaustMap } from 'rxjs/operators';
import { AppState } from 'src/app/store/states/app.state';
import { selectCurrentUserUid } from 'src/app/store/selectors/selectors.user/user.selectors';
import * as A from '../../../actions/actions.interactions/actions.friends';
import { FirestoreUserQueryService, } from 'src/app/core/services/data-handling/firestore-user-query.service';
import { selectRequestersMap } from 'src/app/store/selectors/selectors.interactions/friends/feature';
import { selectInboundRequests } from 'src/app/store/selectors/selectors.interactions/friends/inbound.selectors';

const shorten = (uid?: string) => uid ? `${uid.slice(0, 6)}…${uid.slice(-4)}` : 'alguém';

@Injectable()
export class FriendsRequestsEffects {
  private snack = inject(MatSnackBar);
  private router = inject(Router);
  private seenInbound = new Set<string>(); // evita repetir snackbar

  constructor(
    private actions$: Actions,
    private svc: FriendshipService,
    private notifier: ErrorNotificationService,
    private userQuery: FirestoreUserQueryService,
    private store: Store<AppState>,
  ) { }

  /** Enviar solicitação */
  sendFriendRequest$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.sendFriendRequest),
      exhaustMap(({ requesterUid, targetUid, message }) =>
        this.svc.sendRequest(requesterUid, targetUid, message).pipe(
          map(() => A.sendFriendRequestSuccess()),
          catchError(err => {
            const msg = String(err?.message ?? 'Falha ao enviar solicitação.');
            this.notifier.showError(msg);
            return of(A.sendFriendRequestFailure({ error: msg }));
          })
        )
      )
    )
  );

  /** Outbound (listar) */
  loadOutboundRequests$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.loadOutboundRequests),
      filter(({ uid }) => !!uid),
      switchMap(({ uid }) =>
        this.svc.listOutboundRequests(uid).pipe(
          map(requests => A.loadOutboundRequestsSuccess({ requests })),
          catchError(err => of(A.loadOutboundRequestsFailure({ error: String(err?.message ?? err) })))
        )
      )
    )
  );

  /** Após enviar com sucesso → recarrega outbound */
  refreshOutboundAfterSend$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.sendFriendRequestSuccess),
      withLatestFrom(this.store.select(selectCurrentUserUid)),
      filter((pair): pair is [ReturnType<typeof A.sendFriendRequestSuccess>, string] => !!pair[1]),
      map(([, uid]) => A.loadOutboundRequests({ uid }))
    )
  );

  /** Cancelar enviada */
  cancelOutbound$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.cancelFriendRequest),
      switchMap(({ requestId }) =>
        this.svc.cancelOutboundRequest(requestId).pipe(
          map(() => A.cancelFriendRequestSuccess({ requestId })),
          catchError(err => of(A.cancelFriendRequestFailure({ error: String(err?.message ?? err) })))
        )
      )
    )
  );

  /** Após enviar/cancelar → recarrega outbound */
  refreshOutboundAfterSendOrCancel$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.sendFriendRequestSuccess, A.cancelFriendRequestSuccess),
      withLatestFrom(this.store.select(selectCurrentUserUid)),
      filter((pair): pair is [ReturnType<typeof A.sendFriendRequestSuccess> | ReturnType<typeof A.cancelFriendRequestSuccess>, string] => !!pair[1]),
      map(([, uid]) => A.loadOutboundRequests({ uid }))
    )
  );

  /** Inbound (listar) */
  loadInboundRequests$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.loadInboundRequests),
      filter(({ uid }) => !!uid),
      switchMap(({ uid }) =>
        this.svc.listInboundRequests(uid).pipe(
          map(requests => A.loadInboundRequestsSuccess({ requests })),
          catchError(err => of(A.loadInboundRequestsFailure({ error: String(err?.message ?? err) })))
        )
      )
    )
  );

  /** Aceitar / Recusar */
  acceptRequest$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.acceptFriendRequest),
      concatMap(({ requestId, requesterUid, targetUid }) =>
        this.svc.acceptRequest(requestId, requesterUid, targetUid).pipe(
          map(() => A.acceptFriendRequestSuccess({ requestId })),
          catchError(err => of(A.acceptFriendRequestFailure({ error: String(err?.message ?? err) })))
        )
      )
    )
  );

  declineRequest$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.declineFriendRequest),
      concatMap(({ requestId }) =>
        this.svc.declineRequest(requestId).pipe(
          map(() => A.declineFriendRequestSuccess({ requestId })),
          catchError(err => of(A.declineFriendRequestFailure({ error: String(err?.message ?? err) })))
        )
      )
    )
  );

  /** Após aceitar/recusar → recarrega inbound & amigos */
  afterAcceptOrDeclineRefresh$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.acceptFriendRequestSuccess, A.declineFriendRequestSuccess),
      withLatestFrom(this.store.select(selectCurrentUserUid)),
      filter((pair): pair is [ReturnType<typeof A.acceptFriendRequestSuccess> | ReturnType<typeof A.declineFriendRequestSuccess>, string] => !!pair[1]),
      mergeMap(([, uid]) => of(A.loadInboundRequests({ uid }), A.loadFriends({ uid })))
    )
  );

  /** Realtime: start/stop + mudanças */
  listenInboundRequests$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.startInboundRequestsListener),
      switchMap(({ uid }) =>
        this.svc.watchInboundRequests(uid).pipe(
          map(requests => A.inboundRequestsChanged({ requests })),
          catchError(err => of(A.loadInboundRequestsFailure({ error: String(err?.message ?? err) }))),
          takeUntil(this.actions$.pipe(ofType(A.stopInboundRequestsListener)))
        )
      )
    )
  );

  loadInboundRequestsSuccess$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.loadInboundRequestsSuccess),
      map(({ requests }) => {
        const uids = Array.from(new Set((requests ?? []).map(r => r.requesterUid))).slice(0, 30);
        return A.loadRequesterProfiles({ uids });
      })
    )
  );

  loadRequesterProfiles$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.loadRequesterProfiles),
      switchMap(({ uids }) =>
        this.userQuery.getUsersPublicMap$(uids).pipe(
          // mapData já vem tipado como Record<string, UserPublic>
          map((mapData) => A.loadRequesterProfilesSuccess({ map: mapData })),
          catchError(error => of(A.loadRequesterProfilesFailure({ error })))
        )
      )
    )
  );

  showNotifyAfterProfiles$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(A.loadRequesterProfilesSuccess),
        withLatestFrom(
          this.store.select(selectInboundRequests),
          this.store.select(selectRequestersMap)
        ),
        map(([{ map: arrived }, reqs, currentMap]) => {
          const map = { ...currentMap, ...arrived };
          const fresh = (reqs ?? []).filter(r => r.id && !this.seenInbound.has(r.id!));
          return { fresh, map };
        }),
        // só notifica se tiver algo realmente novo
        filter(({ fresh }) => fresh.length > 0),
        tap(({ fresh, map }) => {
          fresh.forEach(r => this.seenInbound.add(r.id!));

          const first = fresh[0];
          const name = map[first.requesterUid]?.nickname || shorten(first.requesterUid);
          const msg = fresh.length === 1
            ? `Nova solicitação de amizade: ${name}`
            : `${fresh.length} novas solicitações de amizade`;

          const ref = this.snack.open(msg, 'Ver', { duration: 6000 });
          ref.onAction().subscribe(() => this.router.navigate(['/friends', 'requests']));
        })
      ),
    { dispatch: false }
  );
}
