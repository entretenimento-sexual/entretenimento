import { Observable, concat, defer, fromEvent, merge, of, throwError, timer, EMPTY } from 'rxjs';
import { catchError, filter, switchMap, take } from 'rxjs/operators';

// Never keep a previous authorized snapshot after a terminal listener error.
// Retry only known recoverable Firestore errors, with bounded backoff.
// Cancellation belongs to the surrounding session/selection switchMap.
export function recoverDirectChatListener$<T>(
  observe: () => Observable<T>,
  fallback: (error: unknown) => T,
  delays: readonly number[] = [1000, 3000, 10000, 30000],
  resume$?: Observable<unknown>
): Observable<T> {
  const recoverable = new Set(['permission-denied', 'unavailable', 'deadline-exceeded', 'aborted']);
  return defer(() => {
    let attempts = 0;
    const connect = (): Observable<T> => defer(observe).pipe(
    catchError(error => {
      const code = String((error as { code?: unknown } | null)?.code ?? '').split('/').pop() ?? '';
      if (!recoverable.has(code)) return throwError(() => error);
      const delay = delays[attempts++];
      if (delay !== undefined) {
        return concat(of(fallback(error)), timer(delay).pipe(switchMap(() => connect())));
      }
      // After the finite burst, wait for a real lifecycle event, not polling.
      const resume = resume$ ?? (typeof window === 'undefined' || typeof document === 'undefined'
        ? EMPTY : merge(fromEvent(window, 'online'), fromEvent(document, 'visibilitychange').pipe(
            filter(() => document.visibilityState === 'visible'))));
      return concat(of(fallback(error)), resume.pipe(take(1), switchMap(() => {
        attempts = 0;
        return connect();
      })));
    })
  );
    return connect();
  });
}
