// src/app/core/services/general/cache/cache-persistence.service.ts
// -----------------------------------------------------------------------------
// Persistência local de cache com IndexedDB via idb-keyval.
//
// Responsabilidades:
// - manter API pública Observable-first;
// - persistir valor e expiração no mesmo envelope;
// - descartar entradas expiradas ou no formato legado;
// - serializar mutações por chave para preservar a ordem das escritas;
// - aguardar mutações pendentes antes de ler a mesma chave;
// - permitir isolamento do store IndexedDB em testes sem alterar a persistência
//   utilizada pela aplicação em produção.
// -----------------------------------------------------------------------------
import { inject, Injectable, InjectionToken } from '@angular/core';
import { createStore, del, get, keys as idbKeys, set } from 'idb-keyval';
import { from, map, Observable, switchMap } from 'rxjs';

export const CACHE_PERSISTENCE_SCHEMA_VERSION = 2 as const;

export type CachePersistenceStore = ReturnType<typeof createStore>;

/**
 * Store padrão compatível com o comportamento histórico do idb-keyval.
 *
 * Os nomes explícitos preservam o banco já utilizado pela aplicação:
 * - database: keyval-store
 * - object store: keyval
 *
 * O token permite que testes usem bancos próprios, evitando contenção entre
 * arquivos executados em paralelo pelo Vitest.
 */
export const CACHE_PERSISTENCE_STORE =
  new InjectionToken<CachePersistenceStore>('CACHE_PERSISTENCE_STORE', {
    providedIn: 'root',
    factory: () => createStore('keyval-store', 'keyval'),
  });

export interface CachePersistentEnvelope<T> {
  schemaVersion: typeof CACHE_PERSISTENCE_SCHEMA_VERSION;
  value: T;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
  writeVersion: number;
}

@Injectable({
  providedIn: 'root',
})
export class CachePersistenceService {
  private readonly persistentStore = inject(CACHE_PERSISTENCE_STORE);
  private readonly mutationQueues = new Map<string, Promise<void>>();
  private readonly writeVersions = new Map<string, number>();

  /**
   * Compatibilidade com consumidores legados.
   *
   * Novos fluxos com TTL devem usar `setPersistentEntry`, pois este método não
   * recebe expiração e, portanto, cria uma entrada persistente sem vencimento.
   */
  setPersistent<T>(key: string, value: T): Observable<void> {
    return this.setPersistentEntry(key, value, null);
  }

  /**
   * Compatibilidade com consumidores legados: devolve somente o valor.
   * Entradas expiradas ou no formato antigo são removidas e retornam `null`.
   */
  getPersistent<T>(key: string): Observable<T | null> {
    return this.getPersistentEntry<T>(key).pipe(
      map((entry) => entry?.value ?? null)
    );
  }

  /**
   * Persiste um envelope completo, incluindo a expiração absoluta.
   */
  setPersistentEntry<T>(
    key: string,
    value: T,
    expiresAt: number | null
  ): Observable<void> {
    const safeKey = this.normalizeKey(key);
    const now = Date.now();
    const writeVersion = (this.writeVersions.get(safeKey) ?? 0) + 1;

    this.writeVersions.set(safeKey, writeVersion);

    const envelope: CachePersistentEnvelope<T> = {
      schemaVersion: CACHE_PERSISTENCE_SCHEMA_VERSION,
      value,
      createdAt: now,
      updatedAt: now,
      expiresAt: this.normalizeExpiration(expiresAt),
      writeVersion,
    };

    return from(
      this.enqueueMutation(
        safeKey,
        () => set(safeKey, envelope, this.persistentStore)
      )
    );
  }

  /**
   * Lê um envelope persistente válido.
   *
   * Política de migração:
   * - valor antigo sem envelope: remove e retorna `null`;
   * - versão desconhecida: remove e retorna `null`;
   * - entrada expirada: remove e retorna `null`.
   *
   * A recarga remota fica a cargo da camada de domínio que chamou o cache.
   */
  getPersistentEntry<T>(
    key: string
  ): Observable<CachePersistentEnvelope<T> | null> {
    const safeKey = this.normalizeKey(key);

    return from(this.readAfterPendingMutations(safeKey)).pipe(
      switchMap((stored) => {
        if (stored === undefined || stored === null) {
          return from(Promise.resolve(null));
        }

        if (!this.isCurrentEnvelope<T>(stored)) {
          return this.deletePersistent(safeKey).pipe(map(() => null));
        }

        if (this.isExpired(stored.expiresAt)) {
          return this.deletePersistent(safeKey).pipe(map(() => null));
        }

        this.writeVersions.set(
          safeKey,
          Math.max(
            this.writeVersions.get(safeKey) ?? 0,
            stored.writeVersion
          )
        );

        return from(Promise.resolve(stored));
      })
    );
  }

  deletePersistent(key: string): Observable<void> {
    const safeKey = this.normalizeKey(key);
    this.writeVersions.delete(safeKey);

    return from(
      this.enqueueMutation(
        safeKey,
        () => del(safeKey, this.persistentStore)
      )
    );
  }

  /**
   * Remove várias chaves explícitas do IndexedDB.
   */
  deletePersistentMany(keys: string[]): Observable<number> {
    const safeKeys = Array.from(
      new Set(
        (keys ?? [])
          .map((key) => this.normalizeKey(key))
          .filter(Boolean)
      )
    );

    if (!safeKeys.length) {
      return from(Promise.resolve(0));
    }

    return from(
      Promise.all(
        safeKeys.map((key) => {
          this.writeVersions.delete(key);
          return this.enqueueMutation(
            key,
            () => del(key, this.persistentStore)
          );
        })
      ).then(() => safeKeys.length)
    );
  }

  /**
   * Remove do IndexedDB todas as chaves iniciadas pelo prefixo informado.
   */
  deletePersistentByPrefix(prefix: string): Observable<number> {
    const safePrefix = this.normalizeKey(prefix);

    if (!safePrefix) {
      return from(Promise.resolve(0));
    }

    return from(
      idbKeys(this.persistentStore).then((allKeys) => {
        const matchingKeys = allKeys.filter(
          (key): key is string =>
            typeof key === 'string' && key.startsWith(safePrefix)
        );

        return Promise.all(
          matchingKeys.map((key) => {
            this.writeVersions.delete(key);
            return this.enqueueMutation(
              key,
              () => del(key, this.persistentStore)
            );
          })
        ).then(() => matchingKeys.length);
      })
    );
  }

  private normalizeKey(key: string): string {
    return String(key ?? '').trim();
  }

  private normalizeExpiration(expiresAt: number | null): number | null {
    return typeof expiresAt === 'number' && Number.isFinite(expiresAt)
      ? expiresAt
      : null;
  }

  private isExpired(expiresAt: number | null): boolean {
    return expiresAt !== null && Date.now() > expiresAt;
  }

  private isCurrentEnvelope<T>(
    value: unknown
  ): value is CachePersistentEnvelope<T> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }

    const candidate = value as Partial<CachePersistentEnvelope<T>>;

    return (
      candidate.schemaVersion === CACHE_PERSISTENCE_SCHEMA_VERSION &&
      Object.prototype.hasOwnProperty.call(candidate, 'value') &&
      typeof candidate.createdAt === 'number' &&
      Number.isFinite(candidate.createdAt) &&
      typeof candidate.updatedAt === 'number' &&
      Number.isFinite(candidate.updatedAt) &&
      (candidate.expiresAt === null ||
        (typeof candidate.expiresAt === 'number' &&
          Number.isFinite(candidate.expiresAt))) &&
      typeof candidate.writeVersion === 'number' &&
      Number.isInteger(candidate.writeVersion) &&
      candidate.writeVersion > 0
    );
  }

  private readAfterPendingMutations(key: string): Promise<unknown> {
    const pending = this.mutationQueues.get(key);
    const ready = pending
      ? pending.catch(() => void 0)
      : Promise.resolve();

    return ready.then(() => get<unknown>(key, this.persistentStore));
  }

  /**
   * Serializa mutações da mesma chave sem bloquear chaves independentes.
   */
  private enqueueMutation(
    key: string,
    mutation: () => Promise<void>
  ): Promise<void> {
    const previous = this.mutationQueues.get(key) ?? Promise.resolve();
    const current = previous
      .catch(() => void 0)
      .then(() => mutation());

    this.mutationQueues.set(key, current);

    return current.finally(() => {
      if (this.mutationQueues.get(key) === current) {
        this.mutationQueues.delete(key);
      }
    });
  }
}
