import { Observable, ReplaySubject, defer, of } from 'rxjs';
import { distinctUntilChanged, share, startWith, switchMap } from 'rxjs/operators';
import type { SharedChatRevision } from './chat-shared-revision';

// A generation is the identity of a confirmed session revision emission, not
// its numeric value. Callers must independently authorize the candidate first.
// The registry shares transport only; it never grants access to a chat.
export function createSharedChatSnapshots<T>(
  active$: Observable<SharedChatRevision>,
  observe: (id: string) => Observable<T | null>
): (generation: SharedChatRevision, id: string) => Observable<T | null> {
  const registry = new WeakMap<SharedChatRevision, Map<string, Observable<T | null>>>();

  function forGeneration(generation: SharedChatRevision, id: string): Observable<T | null> {
    let entries = registry.get(generation);
    if (!entries) {
      entries = new Map();
      registry.set(generation, entries);
    }
    let shared = entries.get(id);
    if (!shared) {
      shared = defer(() => observe(id)).pipe(
        share({
          connector: () => new ReplaySubject<T | null>(1),
          resetOnError: true,
          resetOnComplete: true,
          resetOnRefCountZero: true,
        })
      );
      entries.set(id, shared);
    }
    return shared;
  }

  return (generation, id) => active$.pipe(
    distinctUntilChanged(),
    switchMap(current => current === generation &&
      current.ownerUid !== null && current.revision !== null
      ? forGeneration(generation, id) : of(null)),
    startWith<T | null>(null)
  );
}
