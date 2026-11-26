// src/app/core/services/interactions/friendship/repo/requests.repo.ts
import { Injectable, EnvironmentInjector } from '@angular/core';
import {
  Firestore,
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import {
  Observable,
  defer,
  from,
  map,
  switchMap,
  timer,
  filter,
  takeUntil,
  Subject,
  share,
  finalize,
  exhaustMap,
  catchError,
  throwError,
  EMPTY,
  merge,
} from 'rxjs';
import type { User } from 'firebase/auth';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { SessionReadInFlight } from '@core/services/autentication/auth/session-read-in-flight';

import { FirestoreRepoBase } from './base.repo';
import { FriendRequest } from '../../../../interfaces/friendship/friend-request.interface';

type PendingRequests = (FriendRequest & { id: string })[];
type RequestDirection = 'inbound' | 'outbound';
interface PendingWatch {
  readonly user: User;
  readonly version: number;
  readonly refresh: Subject<void>;
  readonly stream$: Observable<PendingRequests>;
}

/**
 * Repositório de leitura das solicitações de amizade.
 *
 * Escritas são backend-only e passam pelos callables expostos por
 * FriendshipService. Manter writes Firestore aqui recriaria uma segunda
 * autoridade de lifecycle no cliente.
 */
@Injectable({ providedIn: 'root' })
export class RequestsRepo extends FirestoreRepoBase {
  private readonly inFlight: SessionReadInFlight<PendingRequests>;
  private readonly watches = new Map<string, PendingWatch>();
  constructor(
    db: Firestore,
    env: EnvironmentInjector,
    private readonly functions: Functions,
    private readonly session: AuthSessionService
  ) {
    super(db, env);
    this.inFlight = new SessionReadInFlight(this.session);
  }

  private getPendingRequestsCallable() {
    return this.inCtxSync(() =>
      httpsCallable<
        { direction: 'inbound' | 'outbound'; limit: number },
        {
          items: (FriendRequest & { id: string })[];
          fetchedAt: number;
          scanned: number;
        }
      >(this.functions, 'getPendingFriendRequests')
    );
  }

  /* =========================
   * LISTAGENS (pendentes)
   * ========================= */
  listInboundRequests(uid: string) {
    return this.listPendingRequests$(uid, 'inbound');
  }

  listOutboundRequests(uid: string) {
    return this.listPendingRequests$(uid, 'outbound');
  }

  private listPendingRequests$(uid: string, direction: 'inbound' | 'outbound') {
    return this.inFlight.read$(direction, () =>
      defer(() => from(this.getPendingRequestsCallable()({ direction, limit: 60 })))
        .pipe(map((response) => response.data.items ?? [])),
      uid
    );
  }

  /* =========================
   * REALTIME WATCHERS
   * ========================= */
  watchInboundRequests(uid: string): Observable<(FriendRequest & { id: string })[]> {
    return this.watchPendingRequests$(uid, 'inbound');
  }

  watchOutboundRequests(uid: string): Observable<(FriendRequest & { id: string })[]> {
    return this.watchPendingRequests$(uid, 'outbound');
  }

  private watchPendingRequests$(uid: string, direction: RequestDirection): Observable<PendingRequests> {
    return defer(() => {
      const user = this.session.currentAuthUser;
      const version = this.session.terminationVersionSnapshot;
      if (!user || user.uid !== uid || this.session.isTerminatingSnapshot) {
        // Preserve the existing session boundary and its typed error.
        return this.listPendingRequests$(uid, direction);
      }

      const key = JSON.stringify([uid, direction]);
      const isCurrent = () => this.session.currentAuthUser === user &&
        this.session.terminationVersionSnapshot === version &&
        !this.session.isTerminatingSnapshot;
      let entry = this.watches.get(key);
      if (!entry || entry.user !== user || entry.version !== version) {
        const refresh = new Subject<void>();
        const revoked$ = merge(
          this.session.uid$.pipe(filter(activeUid => activeUid !== uid || !isCurrent())),
          this.session.authUser$.pipe(filter(activeUser => activeUser?.uid !== uid || !isCurrent()))
        );
        const release = () => {
          if (this.watches.get(key) === created) this.watches.delete(key);
        };
        // One clock per live session and direction. Joining starts a fresh
        // check (or joins an in-flight callable), never replays a completed
        // response as authorization. The next periodic tick is measured from
        // that check instead of creating another independent timer.
        const stream$ = refresh.pipe(
          switchMap(() => timer(0, 60_000).pipe(
            exhaustMap(() => isCurrent()
              ? this.listPendingRequests$(uid, direction)
              : EMPTY)
          )),
          takeUntil(revoked$),
          filter(() => isCurrent()),
          catchError(error => isCurrent() ? throwError(() => error) : EMPTY),
          finalize(release),
          share({ connector: () => new Subject<PendingRequests>(),
            resetOnError: true, resetOnComplete: true, resetOnRefCountZero: true })
        );
        const created: PendingWatch = { user, version, refresh, stream$ };
        entry = created;
        this.watches.set(key, created);
      }

      const watch = entry;
      return new Observable<PendingRequests>(subscriber => {
        const subscription = watch.stream$.subscribe(subscriber);
        if (!subscriber.closed) watch.refresh.next();
        return subscription;
      });
    });
  }
}
