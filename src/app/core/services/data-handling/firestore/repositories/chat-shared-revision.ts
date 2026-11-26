import { Observable, ReplaySubject, combineLatest, defer, of } from 'rxjs';
import { distinctUntilChanged, map, share, startWith, switchMap } from 'rxjs/operators';

export interface SharedChatRevision {
  ownerUid: string | null;
  revision: number | null;
}

// Share only the invalidation signal. Candidate authorization and document
// confirmation remain independent for each consumer; a revision grants no access.
export function createSharedChatRevision$(
  uid$: Observable<string | null>,
  allowed$: Observable<boolean>,
  observe: (uid: string) => Observable<number | null>
): Observable<SharedChatRevision> {
  const revoked: SharedChatRevision = { ownerUid: null, revision: null };
  return combineLatest([uid$, allowed$]).pipe(
    map(([uid, allowed]) => allowed && uid && /^[A-Za-z0-9_-]{1,128}$/.test(uid) ? uid : null),
    distinctUntilChanged(),
    switchMap((ownerUid): Observable<SharedChatRevision> => {
      if (!ownerUid) return of(revoked);
      return defer(() => observe(ownerUid)).pipe(
        map(revision => ({ ownerUid, revision })),
        startWith({ ownerUid, revision: null })
      );
    }),
    share({
      connector: () => new ReplaySubject<SharedChatRevision>(1),
      resetOnError: true,
      resetOnComplete: true,
      resetOnRefCountZero: true,
    })
  );
}
