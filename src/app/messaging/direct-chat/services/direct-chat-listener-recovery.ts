import { Observable, concat, defer, of, throwError, timer } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';

// Never keep a previous authorized snapshot after a terminal listener error.
// Retry only known recoverable Firestore errors, with bounded backoff.
// Cancellation belongs to the surrounding session/selection switchMap.
export function recoverDirectChatListener$<T>(
  observe: () => Observable<T>,
  fallback: (error: unknown) => T,
  delays: readonly number[] = [1000, 3000, 10000, 30000]
): Observable<T> {
  const recoverable = new Set(['permission-denied', 'unavailable', 'deadline-exceeded', 'aborted']);
  return defer(() => {
    let attempts = 0;
    const connect = (): Observable<T> => defer(observe).pipe(
    catchError(error => {
      const code = String((error as { code?: unknown } | null)?.code ?? '').split('/').pop() ?? '';
      if (!recoverable.has(code)) return throwError(() => error);
      const delay = delays[attempts++];
      return delay === undefined
        ? of(fallback(error))
        : concat(of(fallback(error)), timer(delay).pipe(switchMap(() => connect())));
    })
  );
    return connect();
  });
}
