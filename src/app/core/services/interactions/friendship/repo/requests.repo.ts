// src/app/core/services/interactions/friendship/repo/requests.repo.ts
import { Injectable, EnvironmentInjector, Optional, Inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import {
  Firestore,
  doc,
  onSnapshot,
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import {
  Observable,
  defer,
  fromEvent,
  startWith,
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
  tap,
} from 'rxjs';
import type { User } from 'firebase/auth';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { SessionReadInFlight } from '@core/services/autentication/auth/session-read-in-flight';
import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';
import { PrivacyDebugLoggerService } from '@core/services/privacy/privacy-debug-logger.service';

import { NetworkStatusService } from '@core/services/network/network-status.service';

import { FirestoreRepoBase } from './base.repo';
import { FriendRequest } from '../../../../interfaces/friendship/friend-request.interface';

type PendingRequests = (FriendRequest & { id: string })[];
type RequestDirection = 'inbound' | 'outbound';
export type PendingRequestConsumer = 'session' | 'profile' | 'post-mutation' | 'explicit' | 'other';
type ReadReason = PendingRequestConsumer | 'session-retry' | 'subscriber-join' | 'canonical-event' | 'listener-recovery' | 'poll';
type Revisions = Record<RequestDirection, number | null>;
const DEGRADED_POLL_MS = 60_000;
const VISIBLE_POLL_MS = 120_000;
const HIDDEN_POLL_MS = 180_000;
const WAKE_COALESCE_MS = 5_000;
// Only a successful read in this same live epoch can suppress a foreground wake.
const RECENT_CONFIRMED_READ_MS = 60_000;
interface RevisionObservation { readonly revisions: Revisions | null; readonly confirmed: boolean }
interface PollingPolicy { readonly online: boolean; readonly visible: boolean; readonly healthy: boolean; readonly interval: number }
interface RevisionEpoch { readonly value: number | null; readonly key: number }
interface RevisionScope {
  readonly user: User;
  readonly version: number;
  readonly inbound: RevisionEpoch;
  readonly outbound: RevisionEpoch;
  readonly confirmed: boolean;
}
const UNKNOWN_REVISIONS: Revisions = { inbound: null, outbound: null };
interface PendingWatch {
  readonly user: User;
  readonly version: number;
  readonly refresh: Subject<ReadReason>;
  readonly pending: () => boolean;
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
    private readonly applicationError: ApplicationErrorService,
    @Optional() private readonly privacyDebug?: PrivacyDebugLoggerService,
    @Optional() private readonly network?: NetworkStatusService,
    @Optional() @Inject(DOCUMENT) private readonly document?: Document
  ) {
    super(db, env);
    this.inFlight = new SessionReadInFlight(this.session);
    this.revisions$ = this.session.authUser$.pipe(
      map(user => ({ user, version: this.session.terminationVersionSnapshot })),
      distinctUntilChanged((a, b) => a.user === b.user && a.version === b.version),
      switchMap(({ user, version }): Observable<RevisionScope | null> => {
        if (!user?.uid || this.session.isTerminatingSnapshot) return of(null);
        return this.observeRevisions$(user.uid).pipe(
          scan((previous: RevisionScope | null, observation): RevisionScope => {
            // Metadata changes affect health, never manufacture a new revision.
            const revision = observation.revisions ?? {
              inbound: previous?.inbound.value ?? null,
              outbound: previous?.outbound.value ?? null,
            };
            return {
              user, version, confirmed: observation.confirmed,
              inbound: previous?.inbound.value === revision.inbound
                ? previous.inbound : { value: revision.inbound, key: ++this.nextEpoch },
              outbound: previous?.outbound.value === revision.outbound
                ? previous.outbound : { value: revision.outbound, key: ++this.nextEpoch },
            };
          }, null as RevisionScope | null)
        );
      }),
      share({ connector: () => new ReplaySubject<RevisionScope | null>(1),
        resetOnError: true, resetOnComplete: true, resetOnRefCountZero: true })
    );
  }

  private trace(event: 'start' | 'subscribe' | 'join' | 'signal' | 'unsubscribe', direction: RequestDirection, reason: ReadReason): void {
    // Fixed allowlisted labels only. Never log UID, revision, request data or token.
    this.privacyDebug?.log('friends', 'pending-read ' + event + ' ' + direction + ' ' + reason);
  }

  private traceResource(resource: 'listener' | RequestDirection, event: 'open' | 'close'): void {
    this.privacyDebug?.log('friends', 'pending-resource ' + resource + ' ' + event);
  }

  private observeRevisions$(uid: string): Observable<RevisionObservation> {
    const readRevision = (value: unknown): number | null =>
      value === undefined ? 0 : typeof value === 'number' &&
        Number.isSafeInteger(value) && value >= 0 ? value : null;
    return new Observable<RevisionObservation>(sink => {
      let unconfirmed = false;
      let confirmedOnce = false;
      const unsubscribe = this.inCtxSync(() =>
      onSnapshot(doc(this.db, 'users', uid), { includeMetadataChanges: true }, snapshot => {
        // Ignore cache/pending writes; neither may invalidate from a forged
        // local value. On reconnect the confirmed snapshot is authoritative
        // only as an invalidation signal, never as permission or list data.
        if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) {
          unconfirmed = true;
          if (confirmedOnce) sink.next({ revisions: null, confirmed: false });
          return;
        }
        if (unconfirmed) {
          this.trace('signal', 'inbound', 'listener-recovery');
          this.trace('signal', 'outbound', 'listener-recovery');
          unconfirmed = false;
        }
        const data = snapshot.data();
        confirmedOnce = true;
        sink.next({ confirmed: snapshot.exists() && !!data, revisions: snapshot.exists() && data ? {
          inbound: readRevision(data['pendingFriendRequestsInboundRevision']),
          outbound: readRevision(data['pendingFriendRequestsOutboundRevision']),
        } : UNKNOWN_REVISIONS });
      }, error => sink.error(error))
      );
      this.traceResource('listener', 'open');
      return () => {
        unsubscribe();
        this.traceResource('listener', 'close');
      };
    }).pipe(
      timeout({ first: 5_000 }),
      catchError(error => {
        this.trace('signal', 'inbound', 'listener-recovery');
        this.trace('signal', 'outbound', 'listener-recovery');
        this.applicationError.report(error, {
          feature: 'friendship', operation: 'RequestsRepo.observeRevisions',
          fallbackMessage: 'Não foi possível observar as alterações de solicitações.',
          presentation: { surface: 'none', severity: 'error' },
        });
        // Polling remains available; retry the signal with a bounded cadence.
        return concat(of<RevisionObservation>({ revisions: UNKNOWN_REVISIONS, confirmed: false }), throwError(() => error));
      }),
      retry({ delay: 60_000 }),
      distinctUntilChanged((a, b) => a.confirmed === b.confirmed &&
        a.revisions?.inbound === b.revisions?.inbound && a.revisions?.outbound === b.revisions?.outbound)
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

  private pollingPolicy$(user: User, version: number, direction: RequestDirection): Observable<PollingPolicy> {
    const healthy$ = this.revisions$.pipe(
      filter((scope): scope is RevisionScope => scope !== null && scope.user === user && scope.version === version),
      map(scope => scope.confirmed && scope[direction].value !== null),
      distinctUntilChanged()
    );
    const online$ = this.network?.isOnline$ ?? of(true);
    const visible$ = defer(() => this.document
      ? fromEvent(this.document, 'visibilitychange').pipe(
          map(() => this.document?.visibilityState !== 'hidden'),
          startWith(this.document.visibilityState !== 'hidden'),
          distinctUntilChanged()
        )
      : of(true));
    return combineLatest([healthy$, online$, visible$]).pipe(
      map(([healthy, online, visible]) => ({
        online, visible, healthy,
        interval: !healthy ? DEGRADED_POLL_MS : visible ? VISIBLE_POLL_MS : HIDDEN_POLL_MS,
      })),
      distinctUntilChanged((a, b) => a.online === b.online && a.visible === b.visible && a.healthy === b.healthy && a.interval === b.interval)
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
  listInboundRequests(uid: string, consumer: PendingRequestConsumer = 'explicit') {
    return this.listPendingRequests$(uid, 'inbound', consumer);
  }

  listOutboundRequests(uid: string, consumer: PendingRequestConsumer = 'explicit') {
    return this.listPendingRequests$(uid, 'outbound', consumer);
  }

  private loadPendingRequests$(uid: string, direction: RequestDirection, epoch: number, reason: ReadReason): Observable<PendingRequests> {
    return this.inFlight.read$(JSON.stringify([direction, epoch]), () =>
      defer(() => {
        this.trace('start', direction, reason);
        return from(this.getPendingRequestsCallable()({ direction, limit: 60 }));
      })
        .pipe(map((response) => response.data.items ?? [])),
      uid
    );
  }

  private listPendingRequests$(uid: string, direction: RequestDirection, consumer: PendingRequestConsumer): Observable<PendingRequests> {
    return defer(() => {
      const user = this.session.currentAuthUser;
      const version = this.session.terminationVersionSnapshot;
      if (!user || user.uid !== uid || this.session.isTerminatingSnapshot) {
        return this.loadPendingRequests$(uid, direction, -1, consumer); // existing typed session error
      }
      return this.directionEpoch$(user, version, direction).pipe(
        switchMap(epoch => this.loadPendingRequests$(uid, direction, epoch.key, consumer)),
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
  watchInboundRequests(uid: string, consumer: PendingRequestConsumer = 'other'): Observable<(FriendRequest & { id: string })[]> {
    return this.watchPendingRequests$(uid, 'inbound', consumer);
  }

  watchOutboundRequests(uid: string, consumer: PendingRequestConsumer = 'other'): Observable<(FriendRequest & { id: string })[]> {
    return this.watchPendingRequests$(uid, 'outbound', consumer);
  }

  private watchPendingRequests$(uid: string, direction: RequestDirection, consumer: PendingRequestConsumer): Observable<PendingRequests> {
    let subscriptions = 0;
    return defer(() => {
      const reason: ReadReason = ++subscriptions > 1 && consumer === 'session' ? 'session-retry' : consumer;
      const user = this.session.currentAuthUser;
      const version = this.session.terminationVersionSnapshot;
      if (!user || user.uid !== uid || this.session.isTerminatingSnapshot) {
        // Preserve the existing session boundary and its typed error.
        return this.listPendingRequests$(uid, direction, consumer);
      }

      const key = JSON.stringify([uid, direction]);
      const isCurrent = () => this.session.currentAuthUser === user &&
        this.session.terminationVersionSnapshot === version &&
        !this.session.isTerminatingSnapshot;
      let entry = this.watches.get(key);
      if (!entry || entry.user !== user || entry.version !== version) {
        const refresh = new Subject<ReadReason>();
        let pending = false;
        let previousEpoch: RevisionEpoch | undefined;
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
          switchMap(([trigger, epoch]) => {
            const initial: ReadReason = previousEpoch && previousEpoch.key !== epoch.key
              ? (previousEpoch.value === null || epoch.value === null ? 'listener-recovery' : 'canonical-event')
              : trigger;
            previousEpoch = epoch;
            pending = true; // scheduled or actively reading, not a response cache
            let lastStarted: number | null = null;
            let lastSucceeded: number | null = null;
            let previousPolicy: PollingPolicy | undefined;
            let wakeDeadline: number | null = null;
            return this.pollingPolicy$(user, version, direction).pipe(
              switchMap(policy => {
                const now = Date.now();
                if (previousPolicy && policy.online) {
                  const reconnect = !previousPolicy.online;
                  const foreground = !previousPolicy.visible && policy.visible;
                  const recentlyConfirmed = previousPolicy.healthy && policy.healthy &&
                    lastSucceeded !== null && now - lastSucceeded < RECENT_CONFIRMED_READ_MS;
                  // Never suppress reconnection, canonical changes, degraded health,
                  // bootstrap or explicit reads. A recent result is timing metadata
                  // only: no response replay, no permission decision, no cross-tab cache.
                  if (reconnect || (foreground && !recentlyConfirmed)) {
                    const nextWake = Math.max(now, (lastStarted ?? now) + WAKE_COALESCE_MS);
                    wakeDeadline = Math.min(wakeDeadline ?? Infinity, nextWake);
                  }
                }
                previousPolicy = policy;
                if (!policy.online) return EMPTY;
                const deadline = lastStarted === null ? now :
                  Math.min(lastStarted + policy.interval, wakeDeadline ?? Infinity);
                return defer(() => {
                  this.traceResource(direction, 'open');
                  return timer(Math.max(0, deadline - now), policy.interval).pipe(
                    finalize(() => this.traceResource(direction, 'close'))
                  );
                });
              }),
              // Policy changes replace only the clock, not the in-flight callable.
              exhaustMap(() => {
                if (!isCurrent()) return EMPTY;
                const readReason = lastStarted === null ? initial : 'poll';
                lastStarted = Date.now();
                wakeDeadline = null;
                pending = true;
                return this.loadPendingRequests$(uid, direction, epoch.key, readReason).pipe(
                  // Clear before forwarding; a late consumer must get a fresh read.
                  tap({ next: () => { lastSucceeded = Date.now(); pending = false; } }),
                  finalize(() => { pending = false; })
                );
              }),
              finalize(() => { pending = false; })
            );
          }),
          takeUntil(revoked$),
          filter(() => isCurrent()),
          catchError(error => isCurrent() ? throwError(() => error) : EMPTY),
          finalize(release),
          share({ connector: () => new Subject<PendingRequests>(),
            resetOnError: true, resetOnComplete: true, resetOnRefCountZero: true })
        );
        const created: PendingWatch = { user, version, refresh, stream$, pending: () => pending };
        entry = created;
        this.watches.set(key, created);
      }

      const watch = entry;
      return new Observable<PendingRequests>(subscriber => {
        const joining = watch.pending();
        this.trace('subscribe', direction, reason);
        const subscription = watch.stream$.subscribe(subscriber);
        if (!subscriber.closed) {
          if (joining) this.trace('join', direction, reason);
          else watch.refresh.next(reason);
        }
        return () => {
          subscription.unsubscribe();
          this.trace('unsubscribe', direction, reason);
        };
      });
    });
  }
}
