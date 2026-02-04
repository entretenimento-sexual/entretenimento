// src/app/store/selectors/cache.selectors.ts
// Não esqueça os comentários
import { createSelector, createFeatureSelector } from '@ngrx/store';
import type { CacheState } from '../states/cache.state';
import { STORE_FEATURE } from '../reducers/feature-keys';

// Seleciona a fatia do estado referente ao cache
export const selectCacheState = createFeatureSelector<CacheState>(STORE_FEATURE.cache);

// Seleciona todo o cache
export const selectCache = createSelector(
  selectCacheState,
  (state: CacheState) => state
);

// Obtém um item específico do cache pelo key
export const selectCacheItem = (key: string) =>
  createSelector(selectCacheState, (state: CacheState) => state[key] ?? null);
