import { Observable, defer, of } from 'rxjs';
import { distinctUntilChanged, startWith, switchMap } from 'rxjs/operators';

// A new revision cancels the previous generation before any new read.
// null represents an unconfirmed snapshot, never authorization.
export function revalidateDiscoveryOnRevision$<T>(
  revision$: Observable<number | null>,
  loading: T,
  observe: () => Observable<T>
): Observable<T> {
  return revision$.pipe(
    distinctUntilChanged(),
    switchMap(revision => revision === null
      ? of(loading)
      : defer(observe).pipe(startWith(loading)))
  );
}
