//src\app\store\effects\effects.interactions\friends\requests-profiles.effects.ts
import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { catchError, filter, map, switchMap, tap, withLatestFrom } from 'rxjs/operators';
import * as A from '../../../actions/actions.interactions/actions.friends';
import * as RT from '../../../actions/actions.interactions/friends/friends-realtime.actions';
import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { selectRequestersMap } from 'src/app/store/selectors/selectors.interactions/friends/feature';
import { selectInboundRequests } from 'src/app/store/selectors/selectors.interactions/friends/inbound.selectors';

const shorten = (uid?: string) => uid ? `${uid.slice(0, 6)}…${uid.slice(-4)}` : 'alguém';

@Injectable()
export class FriendsRequestsProfilesEffects {
  private actions$ = inject(Actions);
  private userQuery = inject(FirestoreUserQueryService);
  private snack = inject(MatSnackBar);
  private router = inject(Router);
  private store = inject(Store<AppState>);
  private seenInbound = new Set<string>();

  // Inbound → perfis de quem solicitou
  loadInboundRequestsSuccess$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.loadInboundRequestsSuccess, RT.inboundRequestsChanged),
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
          map(mapData => A.loadRequesterProfilesSuccess({ map: mapData })),
          catchError(error => of(A.loadRequesterProfilesFailure({ error })))
        )
      )
    )
  );

  // Outbound → perfis de destino (resolve nickname/avatars)
  loadOutboundRequestsSuccess$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.loadOutboundRequestsSuccess, RT.outboundRequestsChanged),
      map(({ requests }) => {
        const uids = Array.from(new Set((requests ?? []).map(r => r.targetUid))).slice(0, 30);
        return A.loadTargetProfiles({ uids });
      })
    )
  );

  loadTargetProfiles$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.loadTargetProfiles),
      switchMap(({ uids }) =>
        this.userQuery.getUsersPublicMap$(uids).pipe(
          map(mapData => A.loadTargetProfilesSuccess({ map: mapData })),
          catchError(error => of(A.loadTargetProfilesFailure({ error })))
        )
      )
    )
  );

  // Snackbar: novas inbound
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
