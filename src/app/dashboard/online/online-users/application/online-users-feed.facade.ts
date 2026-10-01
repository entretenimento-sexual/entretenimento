import { Injectable } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { Observable, combineLatest, interval, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  filter,
  map,
  shareReplay,
  startWith,
} from 'rxjs/operators';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { selectGlobalOnlineUsers } from 'src/app/store/selectors/selectors.user/online.selectors';
import { selectCurrentUser } from 'src/app/store/selectors/selectors.user/user.selectors';
import { AppState } from 'src/app/store/states/app.state';
import { DiscoveryCardEnrichmentService } from '../../discovery/application/discovery-card-enrichment.service';
import type { DiscoveryMode } from '../../discovery/models/discovery-mode.model';
import type { IUserWithDistance } from '../models/online-users.model';
import { OnlineUsersLocationFacade } from './online-users-location.facade';

const UI_REFRESH_MS = 15_000;

function shallowUserEqual(
  a: IUserDados | null,
  b: IUserDados | null
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;

  return (
    a.uid === b.uid &&
    a.emailVerified === b.emailVerified &&
    a.role === b.role &&
    a.profileCompleted === b.profileCompleted &&
    (a.municipio || '') === (b.municipio || '') &&
    (a.estado || '') === (b.estado || '')
  );
}

@Injectable()
export class OnlineUsersFeedFacade {
  private readonly currentUser$ = this.store.select(selectCurrentUser).pipe(
    startWith(undefined as IUserDados | null | undefined),
    filter((user): user is IUserDados | null => user !== undefined),
    distinctUntilChanged((a, b) => shallowUserEqual(a, b)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private readonly onlineRaw$ = this.store
    .select(selectGlobalOnlineUsers)
    .pipe(
      map((users) =>
        Array.isArray(users) ? (users as IUserDados[]) : []
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  private readonly location$ = toObservable(
    this.locationFacade.location
  );

  private readonly uiTick$ = interval(UI_REFRESH_MS).pipe(
    startWith(0)
  );

  constructor(
    private readonly store: Store<AppState>,
    private readonly cardEnrichment: DiscoveryCardEnrichmentService,
    private readonly locationFacade: OnlineUsersLocationFacade,
    private readonly applicationError: ApplicationErrorService
  ) {}

  observe$(
    mode$: Observable<DiscoveryMode>
  ): Observable<IUserWithDistance[]> {
    return combineLatest([
      mode$,
      this.locationFacade.distance$.pipe(
        startWith(
          this.locationFacade.uiDistanceKm() ??
            this.locationFacade.policyMaxDistanceKm()
        )
      ),
      this.uiTick$,
      this.onlineRaw$,
      this.currentUser$,
      this.location$,
    ]).pipe(
      map(
        ([
          mode,
          distanceKm,
          _tick,
          users,
          currentUser,
          fallbackLocation,
        ]) => {
          if (!currentUser?.uid) {
            return [] as IUserWithDistance[];
          }

          const capKm =
            this.locationFacade.normalizeDistanceCap(
              distanceKm
            );

          return this.cardEnrichment.buildCards({
            profiles: users,
            currentUser,
            currentUid: currentUser.uid,
            mode,
            capKm,
            fallbackLocation,
            applyVisibility: true,
          }) as IUserWithDistance[];
        }
      ),
      catchError((error) => {
        this.applicationError.report(error, {
          feature: 'online-users',
          operation: 'OnlineUsersFeedFacade.observe',
          fallbackMessage:
            'Não foi possível atualizar os perfis disponíveis.',
          presentation: { surface: 'none', severity: 'error' },
          metadata: {
            scope: 'OnlineUsersFeedFacade',
          },
        });

        return of([] as IUserWithDistance[]);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  count$(
    users$: Observable<readonly IUserWithDistance[]>
  ): Observable<number> {
    return users$.pipe(
      map((users) => users.length),
      startWith(0),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }
}
