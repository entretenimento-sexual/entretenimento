import type { User } from 'firebase/auth';
import { Observable, ReplaySubject, Subject, defer, filter, finalize, map, merge, share, switchMap, takeUntil, throwError } from 'rxjs';
import type { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';

type SessionScope = Pick<AuthSessionService, 'authUser$' | 'uid$' | 'currentAuthUser' |
  'terminationVersionSnapshot' | 'isTerminatingSnapshot'>;

interface Entry {
  user: User;
  version: number;
  id: number;
  stream$: Observable<Observable<unknown>>;
}

/**
 * One active relationship query per authenticated identity and page size.
 * Only its latest live snapshot descriptor is replayed; completed public
 * profile hydration is never cached. New consumers must revalidate profiles,
 * unless they join the exact same hydration already in flight.
 */
export class SharedFriendsWatch {
  private readonly entries = new Map<string, Entry>();
  private sequence = 0;

  constructor(private readonly session: SessionScope,
    private readonly trace: (entry: number, pageSize: number, resource: 'listener' | 'consumer' | 'hydration', event: 'open' | 'close', snapshot: number) => void = () => {}) {}

  watch$<S, T>(uid: string, pageSize: number, load: () => Observable<S>,
    hydrate: (snapshot: S) => Observable<T>): Observable<T> {
    return defer(() => {
      const user = this.session.currentAuthUser;
      const version = this.session.terminationVersionSnapshot;
      const revokedError = () => Object.assign(new Error('Sessão indisponível para observar conexões.'),
        { code: 'friends/session-revoked' });
      if (!user || user.uid !== uid || this.session.isTerminatingSnapshot) {
        return throwError(revokedError);
      }
      const current = () => this.session.currentAuthUser === user &&
        this.session.terminationVersionSnapshot === version && !this.session.isTerminatingSnapshot;
      const key = JSON.stringify([uid, pageSize]);
      let entry = this.entries.get(key);
      if (!entry || entry.user !== user || entry.version !== version) {
        const revoked$ = merge(
          this.session.authUser$.pipe(filter(active => active !== user || !current())),
          this.session.uid$.pipe(filter(active => active !== uid || !current()))
        ).pipe(switchMap(() => throwError(revokedError)));
        let created: Entry;
        const release = () => {
          if (this.entries.get(key) === created) this.entries.delete(key);
        };
        const id = ++this.sequence;
        let snapshotSequence = 0;
        const stream$ = defer(() => {
          this.trace(id, pageSize, 'listener', 'open', 0);
          return defer(load).pipe(finalize(() => this.trace(id, pageSize, 'listener', 'close', 0)));
        }).pipe(
          takeUntil(revoked$),
          filter(current),
          map(snapshot => {
            const snapshotId = ++snapshotSequence;
            return defer(() => {
              if (!current()) return throwError(revokedError);
              this.trace(id, pageSize, 'hydration', 'open', snapshotId);
              return defer(() => hydrate(snapshot)).pipe(
                finalize(() => this.trace(id, pageSize, 'hydration', 'close', snapshotId)));
            }).pipe(
              filter(current),
              // Only simultaneous hydration, no completed result replay.
              share({ connector: () => new Subject<T>(), resetOnError: true,
                resetOnComplete: true, resetOnRefCountZero: true })
            );
          }),
          finalize(release),
          share({ connector: () => new ReplaySubject<Observable<T>>(1),
            resetOnError: true, resetOnComplete: true, resetOnRefCountZero: true })
        );
        created = { user, version, id, stream$ };
        this.entries.set(key, created);
        entry = created;
      }
      // The key and instance identify a single typed query in FriendsRepo.
      const entryId = entry.id;
      this.trace(entryId, pageSize, 'consumer', 'open', 0);
      return (entry.stream$ as Observable<Observable<T>>).pipe(
        switchMap(hydration$ => hydration$),
        filter(current),
        finalize(() => this.trace(entryId, pageSize, 'consumer', 'close', 0))
      );
    });
  }
}
