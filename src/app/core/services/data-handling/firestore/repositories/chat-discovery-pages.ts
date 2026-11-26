import { Observable, concat, defer, merge, of } from 'rxjs';
import { catchError, distinctUntilChanged, exhaustMap, map, switchMap } from 'rxjs/operators';

export interface DirectChatPageResponse {
  chatIds: string[];
  nextCursor: string | null;
  revision: number;
}

export interface DirectChatPageState {
  ownerUid: string | null;
  status: 'loading' | 'ready' | 'error' | 'revoked';
  chatIds: readonly string[];
  hasMore: boolean;
}

const state = (ownerUid: string | null, status: DirectChatPageState['status'],
  chatIds: readonly string[] = [], hasMore = false): DirectChatPageState =>
  ({ ownerUid, status, chatIds, hasMore });

const validId = (id: unknown): id is string =>
  typeof id === 'string' && !!id && !id.includes('/') &&
  id !== '.' && id !== '..' && !/^__.*__$/.test(id);

function validPage(page: DirectChatPageResponse, revision: number, pageSize: number): boolean {
  return !!page && page.revision === revision && Array.isArray(page.chatIds) &&
    page.chatIds.length <= pageSize && page.chatIds.every(validId) &&
    (page.nextCursor === null || (typeof page.nextCursor === 'string' &&
      /^[A-Za-z0-9_-]{43}$/.test(page.nextCursor)));
}

// One generation per confirmed owner revision. Cursor tokens never leave this
// transport; an empty authorized window can still have a continuation.
export function observeDirectChatPages$(
  owner: string,
  revision$: Observable<number | null>,
  loadMore$: Observable<unknown>,
  fetchPage: (cursor: string | null) => Observable<DirectChatPageResponse>,
  report: (error: unknown) => void,
  pageSize = 50
): Observable<DirectChatPageState> {
  return revision$.pipe(
    distinctUntilChanged(),
    switchMap((revision): Observable<DirectChatPageState> => {
      if (revision === null) return of(state(owner, 'loading'));
      return defer(() => {
        let cursor: string | null = null;
        let ids: string[] = [];
        let exhausted = false;
        const seenCursors = new Set<string>();
        return merge(of(null), loadMore$).pipe(
          exhaustMap((): Observable<DirectChatPageState> => {
            if (exhausted) return of(state(owner, 'ready', ids));
            return concat(
              of(state(owner, 'loading', ids, cursor !== null)),
              defer(() => fetchPage(cursor)).pipe(
                map(page => {
                  if (!validPage(page, revision, pageSize) ||
                    (page.nextCursor !== null && seenCursors.has(page.nextCursor))) {
                    throw new Error('Página de descoberta inválida ou desatualizada.');
                  }
                  ids = [...new Set([...ids, ...page.chatIds])];
                  cursor = page.nextCursor;
                  if (cursor !== null) seenCursors.add(cursor);
                  exhausted = cursor === null;
                  return state(owner, 'ready', ids, !exhausted);
                }),
                catchError(error => {
                  // Never continue from a failed or stale cursor. A subsequent
                  // explicit request starts again from the first window.
                  ids = [];
                  cursor = null;
                  exhausted = false;
                  seenCursors.clear();
                  report(error);
                  return of(state(owner, 'error'));
                })
              )
            );
          })
        );
      });
    })
  );
}
