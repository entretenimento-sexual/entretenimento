import { Observable, defer, fromEvent, merge, of, throwError, timer, EMPTY } from 'rxjs';
import { catchError, filter, repeat, take, tap } from 'rxjs/operators';

export interface DirectChatListenerRecoveryOptions<T> {
  // Only a consumer with evidence of a confirmed server value may reset the
  // retry budget. Cache, loading and fallback values are never evidence.
  isConfirmed?: (value: T) => boolean;
}

const CONFIRMED_STABILITY_MS = 30_000;
const TRANSPORT_PROBE_MS = 120_000;
const recoverable = new Set(['permission-denied', 'unavailable', 'deadline-exceeded', 'aborted']);

// Each subscription has its own retry budget. An error clears the old data
// immediately. No retry grants access: the fresh listener must pass Rules.
export function recoverDirectChatListener$<T>(
  observe: () => Observable<T>,
  fallback: (error: unknown) => T,
  delays: readonly number[] = [1000, 3000, 10000, 30000],
  resume$?: Observable<unknown>,
  options: DirectChatListenerRecoveryOptions<T> = {}
): Observable<T> {
  return defer(() => {
    let attempts = 0;
    let probeUsed = false;
    let nextWake$: Observable<unknown> = EMPTY;

    const lifecycle$ = resume$ ?? (typeof window === 'undefined' || typeof document === 'undefined'
      ? EMPTY : merge(
          fromEvent(window, 'online'),
          fromEvent(window, 'focus'),
          fromEvent(window, 'pageshow'),
          fromEvent(document, 'visibilitychange').pipe(
            filter(() => document.visibilityState === 'visible'))
        ));

    // repeat resubscribes only after an explicitly scheduled wake. A normal
    // completion does not reconnect. Unlike nested concat/switchMap retries,
    // completed generations do not accumulate across lifecycle events.
    return defer(() => {
      nextWake$ = EMPTY;
      let confirmedSince: number | null = null;
      return defer(observe).pipe(
        tap(value => {
          if (!options.isConfirmed) return;
          if (options.isConfirmed(value)) confirmedSince ??= Date.now();
          else confirmedSince = null;
        }),
        catchError(error => {
          const code = String((error as { code?: unknown } | null)?.code ?? '').split('/').pop() ?? '';
          if (!recoverable.has(code)) return throwError(() => error);

          if (confirmedSince !== null && Date.now() - confirmedSince >= CONFIRMED_STABILITY_MS) {
            attempts = 0;
            probeUsed = false;
          }
          const delay = delays[attempts++];
          if (delay !== undefined) {
            nextWake$ = timer(delay);
          } else {
            const lifecycleWake$ = lifecycle$.pipe(take(1), tap(() => {
              attempts = 0;
              probeUsed = false;
            }));
            // One extra low-frequency probe for transport outages only.
            // Never poll permission-denied; never start an endless timer loop.
            if (code !== 'permission-denied' && !probeUsed) {
              probeUsed = true;
              nextWake$ = merge(lifecycleWake$, timer(TRANSPORT_PROBE_MS)).pipe(take(1));
            } else {
              nextWake$ = lifecycleWake$;
            }
          }
          return of(fallback(error));
        })
      );
    }).pipe(repeat({ delay: () => nextWake$ }));
  });
}
