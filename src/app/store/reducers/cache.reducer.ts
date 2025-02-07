//src\app\store\reducers\cache.reducer.ts
import { createReducer, on, Action } from '@ngrx/store';
import { setCache, removeCache, clearCache } from '../actions/cache.actions';

export interface CacheState {
  [key: string]: any;
}

const initialState: CacheState = {};

const _cacheReducer = createReducer(
  initialState,
  on(setCache, (state, { key, value }) => ({
    ...state,
    [key]: value
  })),
  on(removeCache, (state, { key }) => {
    const newState = { ...state };
    delete newState[key];
    return newState;
  }),
  on(clearCache, () => ({})) // Reseta o cache
);

export function cacheReducer(state: CacheState | undefined, action: Action) {
  return _cacheReducer(state, action);
}
