//src\app\store\actions\cache.actions.ts
import { createAction, props } from '@ngrx/store';

/**
 * Ação para definir um valor no cache.
 */
export const setCache = createAction(
  '[Cache] Set',
  props<{ key: string; value: any }>()
);

/**
 * Ação para remover um item do cache.
 */
export const removeCache = createAction(
  '[Cache] Remove',
  props<{ key: string }>()
);

/**
 * Ação para limpar todo o cache.
 */
export const clearCache = createAction('[Cache] Clear');
