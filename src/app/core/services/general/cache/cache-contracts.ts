// src/app/core/services/general/cache/cache-contracts.ts
// Contratos únicos da arquitetura de cache.
//
// Regras:
// - cache é otimização descartável, nunca fonte de autorização;
// - persistência é opt-in;
// - dados restricted permanecem somente em memória;
// - TTL e versão acompanham o valor persistido;
// - null pode ser valor legítimo, por isso miss é discriminado.

export type CacheScope = 'global' | 'session' | 'user';
export type CacheSensitivity = 'public' | 'private' | 'restricted';
export type CacheStorage = 'memory' | 'persistent';

export interface CacheDefinition<T> {
  /** Identificador semântico e estável dentro do escopo. */
  readonly key: string;

  /** Ciclo de vida do dado. */
  readonly scope: CacheScope;

  /** Classificação de privacidade. */
  readonly sensitivity: CacheSensitivity;

  /** Persistência deve ser escolhida conscientemente. */
  readonly storage: CacheStorage;

  /**
   * Tempo de validade obrigatório.
   * `null` significa sem expiração automática; omissão é configuração inválida.
   */
  readonly ttlMs: number | null;

  /** Janela opcional em que o valor expirado ainda pode alimentar SWR. */
  readonly staleWhileRevalidateMs?: number;

  /** Invalida envelopes de schemas antigos sem depender da chave física. */
  readonly version: number;

  /** Obrigatório quando scope === 'user'. */
  readonly ownerUid?: string;

  /** Validação de runtime antes de expor um valor reidratado. */
  readonly validate?: (value: unknown) => value is T;
}

export interface CacheEnvelope<T> {
  readonly value: T;
  readonly createdAt: number;
  readonly expiresAt: number | null;
  readonly staleUntil: number | null;
  readonly version: number;
  readonly scope: CacheScope;
  readonly sensitivity: CacheSensitivity;
  readonly ownerUid?: string;
}

export type CacheResult<T> =
  | { readonly status: 'miss' }
  | { readonly status: 'fresh'; readonly value: T }
  | { readonly status: 'stale'; readonly value: T };

export const CACHE_MISS: CacheResult<never> = Object.freeze({
  status: 'miss',
});
