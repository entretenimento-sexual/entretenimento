import { Observable, defer, of } from 'rxjs';
import { distinctUntilChanged, startWith, switchMap } from 'rxjs/operators';

// A new revision cancels the previous generation before any new read.
// null represents an unconfirmed snapshot, never authorization.
export function revalidateDiscoveryOnRevision$<T, R = number>(
  revision$: Observable<R | null>,
  loading: T,
  observe: (revision: R) => Observable<T>
): Observable<T> {
  return revision$.pipe(
    distinctUntilChanged(),
    switchMap(revision => revision === null
      ? of(loading)
      : defer(() => observe(revision)).pipe(startWith(loading)))
  );
}
