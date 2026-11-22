import {
  Observable, combineLatest, concat, defer, of,
} from 'rxjs';
import {
  distinctUntilChanged, filter, map, startWith, switchMap,
} from 'rxjs/operators';

/**
 * An absent projection on first read is legacy state awaiting reconciliation,
 * not proof of a new restriction. Once this subscription has OBSERVED an
 * explicit grant, disappearance is a revocation and must emit false before
 * any asynchronous reconciliation, even when the callable never emits.
 *
 * Only Firestore's versioned document may emit true. Reconciliation can
 * fail closed (false) but cannot grant playback from its HTTP response.
 */
export function watchPublicMediaAvailability$(
  projection$: Observable<boolean | null>,
  reconcileMissing$: () => Observable<false>
): Observable<boolean> {
  return defer(() => {
    let observedGrant = false;

    return projection$.pipe(
      distinctUntilChanged(),
      switchMap((availability) => {
        if (availability !== null) {
          observedGrant = availability;
          return of(availability);
        }

        const mustRevoke = observedGrant;
        observedGrant = false;
        const reconcile$ = reconcileMissing$();

        // Initial null: await the actual document; do not terminate a valid
        // playback on a temporary absence during a legacy bootstrap.
        // null after true: revoke NOW, even if reconciliation hangs.
        return mustRevoke ? concat(of(false), reconcile$) : reconcile$;
      }),
      distinctUntilChanged()
    );
  });
}

/**
 * A known denial revokes immediately, including while another source is
 * still resolving. Unknown sources cannot grant access by themselves.
 */
export function combinePublicVideoExposure$(
  ...sources: [Observable<boolean>, Observable<boolean>, ...Observable<boolean>[]]
): Observable<boolean> {
  return combineLatest(sources.map((source$) => source$.pipe(startWith(null)))).pipe(
    map((availability) => {
      if (availability.includes(false)) return false;
      if (availability.every((allowed) => allowed === true)) return true;
      return null;
    }),
    filter((allowed): allowed is boolean => allowed !== null),
    distinctUntilChanged()
  );
}
