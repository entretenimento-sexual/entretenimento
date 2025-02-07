//src\app\store\selectors\cache.selectors.ts
import { createSelector, createFeatureSelector } from '@ngrx/store';
import { CacheState } from '../reducers/cache.reducer';

// Seleciona a fatia do estado referente ao cache
export const selectCacheState = createFeatureSelector<CacheState>('cache');

// Seleciona todo o cache como Observable
export const selectCache = createSelector(
  selectCacheState,
  (state: CacheState) => state
);

// Obtém um item específico do cache pelo key
export const selectCacheItem = (key: string) =>
  createSelector(selectCacheState, (state: CacheState) => state[key] ?? null);
