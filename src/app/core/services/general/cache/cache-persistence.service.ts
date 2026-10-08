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
// - limpar o IndexedDB em lotes pequenos, sem bloquear a inicialização;
// - revalidar a chave dentro da fila antes de uma exclusão de manutenção;
// - permitir isolamento do store IndexedDB em testes.
// -----------------------------------------------------------------------------
import { inject, Injectable, InjectionToken } from '@angular/core';
import { createStore, del, get, keys as idbKeys, set } from 'idb-keyval';
import { from, map, Observable, of, switchMap } from 'rxjs';

export const CACHE_PERSISTENCE_SCHEMA_VERSION = 2 as const;

export type CachePersistenceStore = ReturnType<typeof createStore>;

type MaintenanceRemovalReason = 'invalid' | 'expired' | null;

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

export interface CachePersistenceCleanupOptions {
  readonly batchSize?: number;
  readonly cursor?: number;
}

export interface CachePersistenceCleanupResult {
  readonly totalKeys: number;
  readonly scanned: number;
  readonly removed: number;
  readonly invalid: number;
  readonly expired: number;
  readonly nextCursor: number;
}

@Injectable({ providedIn: 'root' })
export class CachePersistenceService {
  private readonly persistentStore = inject(CACHE_PERSISTENCE_STORE);
  private readonly mutationQueues = new Map<string, Promise<void>>();
  private readonly writeVersions = new Map<string, number>();
  private sessionMutationEpoch = 0;
  private sensitiveExactKeys = new Set<string>();
  private sensitivePrefixes: string[] = [];
  private activeSessionPurgeEpoch: number | null = null;
  private readonly freshWritesDuringPurge = new Set<string>();

  /** Compatibilidade com consumidores legados sem TTL. */
  setPersistent<T>(key: string, value: T): Observable<void> {
    return this.setPersistentEntry(key, value, null);
  }

  /** Compatibilidade com consumidores legados que esperam somente o valor. */
  getPersistent<T>(key: string): Observable<T | null> {
    return this.getPersistentEntry<T>(key).pipe(
      map((entry) => entry?.value ?? null)
    );
  }

  setPersistentEntry<T>(
    key: string,
    value: T,
    expiresAt: number | null
  ): Observable<void> {
    const safeKey = this.normalizeKey(key);
    const now = Date.now();
    const writeVersion = (this.writeVersions.get(safeKey) ?? 0) + 1;
    const writeSessionEpoch = this.sessionMutationEpoch;

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
        async () => {
          // Escrita A pendente antes do logout não deve ressuscitar o cache em B.
          if (
            writeSessionEpoch !== this.sessionMutationEpoch
            && this.isSensitiveSessionKey(safeKey)
          ) {
            return;
          }

          await set(safeKey, envelope, this.persistentStore);
          if (
            this.activeSessionPurgeEpoch === writeSessionEpoch
            && this.isSensitiveSessionKey(safeKey)
          ) {
            // Uma escrita válida de B prevalece sobre a limpeza de A.
            this.freshWritesDuringPurge.add(safeKey);
          }
        }
      )
    );
  }

  getPersistentEntry<T>(
    key: string
  ): Observable<CachePersistentEnvelope<T> | null> {
    const safeKey = this.normalizeKey(key);
    const readSessionEpoch = this.sessionMutationEpoch;

    return from(this.readAfterPendingMutations(safeKey)).pipe(
      switchMap((stored) => {
        if (
          this.isSensitiveSessionKey(safeKey)
          && (
            readSessionEpoch !== this.sessionMutationEpoch
            || this.activeSessionPurgeEpoch !== null
          )
        ) {
          // Nunca exponha IndexedDB antigo enquanto a purga da sessão ocorre.
          return of(null);
        }
        if (stored === undefined || stored === null) {
          return from(Promise.resolve(null));
        }

        if (!this.isCurrentEnvelope<T>(stored)) {
          return this.deletePersistent(safeKey).pipe(map(() => null));
        }

        if (this.isExpired(stored.expiresAt)) {
          return this.deletePersistent(safeKey).pipe(map(() => null));
        }

        this.rememberWriteVersion(safeKey, stored.writeVersion);
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

  /**
   * Fronteira de sessão do IndexedDB.
   *
   * - invalida imediatamente a geração de escritas sensíveis enfileiradas;
   * - espera escritas anteriores já iniciadas antes de enumerar chaves;
   * - inclui chaves exatas mesmo quando ainda não estão enumeráveis;
   * - uma escrita nova no mesmo processo é preservada ao terminar a purga;
   * - purgas sucessivas A→B→A tornam purgas antigas inofensivas.
   *
   * A Promise é iniciada aqui, não ao assinar o Observable. Assim a barreira
   * ocorre na mesma chamada síncrona que iniciou o reset de sessão.
   */
  purgeSensitiveSessionEntries(
    exactKeys: readonly string[],
    prefixes: readonly string[]
  ): Observable<void> {
    const normalizedExact = [...new Set(
      (exactKeys ?? []).map((key) => this.normalizeKey(key)).filter(Boolean)
    )];
    const normalizedPrefixes = [...new Set(
      (prefixes ?? []).map((prefix) => this.normalizeKey(prefix)).filter(Boolean)
    )];

    this.sensitiveExactKeys = new Set(normalizedExact);
    this.sensitivePrefixes = normalizedPrefixes;

    const purgeEpoch = ++this.sessionMutationEpoch;
    this.activeSessionPurgeEpoch = purgeEpoch;
    this.freshWritesDuringPurge.clear();

    const pendingBeforePurge = [...this.mutationQueues.values()];
    const purgePromise = Promise.all(
      pendingBeforePurge.map((pending) => pending.catch(() => void 0))
    ).then(async () => {
      if (this.sessionMutationEpoch !== purgeEpoch) return;

      const storedKeys = await idbKeys(this.persistentStore);
      const candidates = new Set(normalizedExact);
      for (const key of storedKeys) {
        if (typeof key === 'string' && this.isSensitiveSessionKey(key)) {
          candidates.add(key);
        }
      }

      await Promise.all(
        [...candidates].map((key) =>
          this.enqueueMutation(key, async () => {
            if (
              this.sessionMutationEpoch !== purgeEpoch
              || this.freshWritesDuringPurge.has(key)
            ) {
              return;
            }
            await del(key, this.persistentStore);
            this.writeVersions.delete(key);
          })
        )
      );
    }).finally(() => {
      if (this.activeSessionPurgeEpoch === purgeEpoch) {
        this.activeSessionPurgeEpoch = null;
        this.freshWritesDuringPurge.clear();
      }
    });

    return from(purgePromise).pipe(map(() => void 0));
  }

  private isSensitiveSessionKey(key: string): boolean {
    return this.sensitiveExactKeys.has(key)
      || this.sensitivePrefixes.some((prefix) => key.startsWith(prefix));
  }

  /**
   * Varre somente um lote por execução.
   *
   * O cursor é devolvido ao chamador para que a próxima sessão continue de onde
   * parou. Cada chave é revalidada dentro da sua fila de mutação; uma escrita
   * concorrente recente nunca é apagada por uma leitura antiga da manutenção.
   */
  cleanupExpiredEntries(
    options: CachePersistenceCleanupOptions = {}
  ): Observable<CachePersistenceCleanupResult> {
    const batchSize = this.normalizeBatchSize(options.batchSize);
    const requestedCursor = this.normalizeCursor(options.cursor);

    return from(
      idbKeys(this.persistentStore).then(async (allKeys) => {
        const keys = allKeys
          .filter((key): key is string => typeof key === 'string')
          .sort();
        const totalKeys = keys.length;

        if (totalKeys === 0) {
          return {
            totalKeys: 0,
            scanned: 0,
            removed: 0,
            invalid: 0,
            expired: 0,
            nextCursor: 0,
          } satisfies CachePersistenceCleanupResult;
        }

        const start = requestedCursor % totalKeys;
        const batch: string[] = [];
        const targetSize = Math.min(batchSize, totalKeys);

        for (let index = 0; index < targetSize; index += 1) {
          const key = keys[(start + index) % totalKeys];
          if (key) batch.push(key);
        }

        let invalid = 0;
        let expired = 0;

        for (const key of batch) {
          const reason = await this.inspectAndRemoveForMaintenance(key);
          if (reason === 'invalid') invalid += 1;
          if (reason === 'expired') expired += 1;
        }

        return {
          totalKeys,
          scanned: batch.length,
          removed: invalid + expired,
          invalid,
          expired,
          nextCursor: (start + batch.length) % totalKeys,
        } satisfies CachePersistenceCleanupResult;
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

  private normalizeBatchSize(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 40;
    return Math.min(200, Math.max(1, Math.floor(value)));
  }

  private normalizeCursor(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
    return Math.max(0, Math.floor(value));
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

  private inspectAndRemoveForMaintenance(
    key: string
  ): Promise<MaintenanceRemovalReason> {
    let reason: MaintenanceRemovalReason = null;

    return this.enqueueMutation(key, async () => {
      const current = await get<unknown>(key, this.persistentStore);

      if (current === undefined || current === null) return;

      if (!this.isCurrentEnvelope(current)) {
        reason = 'invalid';
      } else if (this.isExpired(current.expiresAt)) {
        reason = 'expired';
      } else {
        this.rememberWriteVersion(key, current.writeVersion);
        return;
      }

      this.writeVersions.delete(key);
      await del(key, this.persistentStore);
    }).then(() => reason);
  }

  private rememberWriteVersion(key: string, writeVersion: number): void {
    this.writeVersions.set(
      key,
      Math.max(this.writeVersions.get(key) ?? 0, writeVersion)
    );
  }

  /** Serializa mutações da mesma chave sem bloquear chaves independentes. */
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
