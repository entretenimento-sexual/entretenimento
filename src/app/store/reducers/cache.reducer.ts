// src/app/store/reducers/cache.reducer.ts
// Não esqueça os comentários
import { createReducer, on, Action } from '@ngrx/store';
import { setCache, removeCache, clearCache } from '../actions/cache.actions';

import { CacheState, initialCacheState } from '../states/cache.state';

/**
 * Reducer do cache
 * - Mantém operações simples (set/remove/clear)
 * - Sem side-effects (padrão NgRx)
 */
const _cacheReducer = createReducer(
  initialCacheState,

  on(setCache, (state, { key, value }) => ({
    ...state,
    [key]: value,
  })),

  on(removeCache, (state, { key }) => {
    const newState = { ...state };
    delete (newState as any)[key];
    return newState;
  }),

  on(clearCache, () => initialCacheState) // ✅ reseta para o inicial exportado
);

export function cacheReducer(state: CacheState | undefined, action: Action) {
  return _cacheReducer(state, action);
}
