import { EMPTY, Observable, ReplaySubject, defer } from 'rxjs';
import { filter, finalize, share, switchMap, take, takeUntil, tap } from 'rxjs/operators';
import type { SharedChatRevision } from './chat-shared-revision';

/**
 * Coalesce only simultaneous, identical one-shot backend reads.
 * Object identity, not owner/revision numbers, scopes the request.
 * No completed authorization, error or response is retained for later callers.
 * Consumers still validate their own backend response and Firestore Rules.
 */
export function createChatGenerationInFlight<T>(active$: Observable<SharedChatRevision>):
  (generation: SharedChatRevision, key: string, load: () => Observable<T>) => Observable<T> {
  const pending = new WeakMap<SharedChatRevision, Map<string, Observable<T>>>();
  return (generation, key, load) => defer(() => active$.pipe(
    take(1),
    switchMap(current => {
      if (current !== generation || !current.ownerUid || current.revision === null) return EMPTY;
      let entries = pending.get(generation);
      if (!entries) {
        entries = new Map();
        pending.set(generation, entries);
      }
      const registry = entries;
      const existing = registry.get(key);
      if (existing) return existing;
      let request$: Observable<T>;
      const release = () => {
        if (registry.get(key) === request$) registry.delete(key);
      };
      request$ = defer(load).pipe(
        takeUntil(active$.pipe(filter(value => value !== generation))),
        take(1),
        // Release before notification: a later or reentrant read must be fresh.
        tap({ next: release, error: release, complete: release }),
        finalize(release),
        share({
          connector: () => new ReplaySubject<T>(1),
          resetOnError: true,
          resetOnComplete: true,
          resetOnRefCountZero: true,
        })
      );
      registry.set(key, request$);
      return request$;
    })
  ));
}
