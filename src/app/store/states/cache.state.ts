// src/app/store/states/cache.state.ts
// Não esqueça os comentários
// Estado do Cache (NgRx)
// - Tipos e initial state ficam aqui (padrão limpo: reducer/selector importam daqui)
// - Evita “vazamento” de tipos pelo reducer e reduz ciclos

/**
 * CacheState
 * - Slice genérico de cache (app-wide).
 * - Como é “estado de store”, mantenha serializável sempre que possível.
 *   Evite salvar Timestamp/Date diretamente aqui.
 */
export interface CacheState {
  [key: string]: any;
}

/**
 * Estado inicial do cache.
 * - Exportado para: reducer, meta-reducers e testes.
 */
export const initialCacheState: CacheState = {};
