// src/app/core/services/interactions/friendship/repo/requests.repo.ts
import { Injectable, EnvironmentInjector } from '@angular/core';
import {
  Firestore,
  doc,
  onSnapshot,
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
  combineLatest,
  distinctUntilChanged,
  scan,
  ReplaySubject,
  retry,
  concat,
  of,
  timeout,
  take,
} from 'rxjs';
import type { User } from 'firebase/auth';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { SessionReadInFlight } from '@core/services/autentication/auth/session-read-in-flight';
import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';

import { FirestoreRepoBase } from './base.repo';
import { FriendRequest } from '../../../../interfaces/friendship/friend-request.interface';

type PendingRequests = (FriendRequest & { id: string })[];
type RequestDirection = 'inbound' | 'outbound';
type Revisions = Record<RequestDirection, number | null>;
interface RevisionEpoch { readonly value: number | null; readonly key: number }
interface RevisionScope {
  readonly user: User;
  readonly version: number;
  readonly inbound: RevisionEpoch;
  readonly outbound: RevisionEpoch;
}
const UNKNOWN_REVISIONS: Revisions = { inbound: null, outbound: null };
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
  private readonly revisions$: Observable<RevisionScope | null>;
  private nextEpoch = 0;
  constructor(
    db: Firestore,
    env: EnvironmentInjector,
    private readonly functions: Functions,
    private readonly session: AuthSessionService,
    private readonly applicationError: ApplicationErrorService
  ) {
    super(db, env);
    this.inFlight = new SessionReadInFlight(this.session);
    this.revisions$ = this.session.authUser$.pipe(
      map(user => ({ user, version: this.session.terminationVersionSnapshot })),
      distinctUntilChanged((a, b) => a.user === b.user && a.version === b.version),
      switchMap(({ user, version }): Observable<RevisionScope | null> => {
        if (!user?.uid || this.session.isTerminatingSnapshot) return of(null);
        return this.observeRevisions$(user.uid).pipe(
          scan((previous: RevisionScope | null, revision): RevisionScope => ({
            user, version,
            inbound: previous?.inbound.value === revision.inbound
              ? previous.inbound : { value: revision.inbound, key: ++this.nextEpoch },
            outbound: previous?.outbound.value === revision.outbound
              ? previous.outbound : { value: revision.outbound, key: ++this.nextEpoch },
          }), null as RevisionScope | null)
        );
      }),
      share({ connector: () => new ReplaySubject<RevisionScope | null>(1),
        resetOnError: true, resetOnComplete: true, resetOnRefCountZero: true })
    );
  }

  private observeRevisions$(uid: string): Observable<Revisions> {
    const readRevision = (value: unknown): number | null =>
      value === undefined ? 0 : typeof value === 'number' &&
        Number.isSafeInteger(value) && value >= 0 ? value : null;
    return new Observable<Revisions>(sink => this.inCtxSync(() =>
      onSnapshot(doc(this.db, 'users', uid), { includeMetadataChanges: true }, snapshot => {
        // Ignore cache/pending writes; neither may invalidate from a forged
        // local value. On reconnect the confirmed snapshot is authoritative
        // only as an invalidation signal, never as permission or list data.
        if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
        const data = snapshot.data();
        sink.next(snapshot.exists() && data ? {
          inbound: readRevision(data['pendingFriendRequestsInboundRevision']),
          outbound: readRevision(data['pendingFriendRequestsOutboundRevision']),
        } : UNKNOWN_REVISIONS);
      }, error => sink.error(error))
    )).pipe(
      timeout({ first: 5_000 }),
      catchError(error => {
        this.applicationError.report(error, {
          feature: 'friendship', operation: 'RequestsRepo.observeRevisions',
          fallbackMessage: 'Não foi possível observar as alterações de solicitações.',
          presentation: { surface: 'none', severity: 'error' },
        });
        // Polling remains available; retry the signal with a bounded cadence.
        return concat(of(UNKNOWN_REVISIONS), throwError(() => error));
      }),
      retry({ delay: 60_000 }),
      distinctUntilChanged((a, b) => a.inbound === b.inbound && a.outbound === b.outbound)
    );
  }

  private directionEpoch$(user: User, version: number, direction: RequestDirection): Observable<RevisionEpoch> {
    return this.revisions$.pipe(
      filter((scope): scope is RevisionScope => scope !== null &&
        scope.user === user && scope.version === version),
      map(scope => scope[direction]),
      distinctUntilChanged(),
      filter(() => this.session.currentAuthUser === user &&
        this.session.terminationVersionSnapshot === version && !this.session.isTerminatingSnapshot)
    );
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

  private loadPendingRequests$(uid: string, direction: RequestDirection, epoch: number): Observable<PendingRequests> {
    return this.inFlight.read$(JSON.stringify([direction, epoch]), () =>
      defer(() => from(this.getPendingRequestsCallable()({ direction, limit: 60 })))
        .pipe(map((response) => response.data.items ?? [])),
      uid
    );
  }

  private listPendingRequests$(uid: string, direction: RequestDirection): Observable<PendingRequests> {
    return defer(() => {
      const user = this.session.currentAuthUser;
      const version = this.session.terminationVersionSnapshot;
      if (!user || user.uid !== uid || this.session.isTerminatingSnapshot) {
        return this.loadPendingRequests$(uid, direction, -1); // existing typed session error
      }
      return this.directionEpoch$(user, version, direction).pipe(
        switchMap(epoch => this.loadPendingRequests$(uid, direction, epoch.key)),
        take(1),
        takeUntil(this.session.authUser$.pipe(filter(active =>
          active?.uid !== uid || this.session.currentAuthUser !== user ||
          this.session.terminationVersionSnapshot !== version || this.session.isTerminatingSnapshot)))
      );
    });
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
        const stream$ = combineLatest([refresh, this.directionEpoch$(user, version, direction)]).pipe(
          switchMap(([, epoch]) => timer(0, 60_000).pipe(
            exhaustMap(() => isCurrent()
              ? this.loadPendingRequests$(uid, direction, epoch.key)
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
