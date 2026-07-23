// src/app/core/services/general/cache/cache-persistence.service.ts
// Adaptador de persistência IndexedDB via idb-keyval.
//
// Responsabilidade única:
// - ler, gravar e remover dados persistidos;
// - não decidir TTL, privacidade, escopo ou feedback ao usuário;
// - manter API pública Observable-first.
import { Injectable } from '@angular/core';
import { del, get, keys as idbKeys, set } from 'idb-keyval';
import { from, Observable, of } from 'rxjs';

import { CacheEnvelope } from './cache-contracts';

@Injectable({ providedIn: 'root' })
export class CachePersistenceService {
  /**
   * Compatibilidade com o CacheService legado.
   * Novos fluxos devem preferir envelopes tipados.
   */
  setPersistent<T>(key: string, value: T): Observable<void> {
    return from(set(key, value));
  }

  /** Compatibilidade com o CacheService legado. */
  getPersistent<T>(key: string): Observable<T | null> {
    return from(
      get<T>(key).then((result) =>
        result !== undefined ? result : null
      )
    );
  }

  /**
   * Nova API: persiste valor, TTL, versão e escopo no mesmo registro.
   */
  setEnvelopePersistent<T>(
    key: string,
    envelope: CacheEnvelope<T>
  ): Observable<void> {
    return from(set(key, envelope));
  }

  /**
   * Nova API: recupera o envelope completo para validar expiração e schema.
   */
  getEnvelopePersistent<T>(
    key: string
  ): Observable<CacheEnvelope<T> | null> {
    return from(
      get<CacheEnvelope<T>>(key).then((result) =>
        result !== undefined ? result : null
      )
    );
  }

  deletePersistent(key: string): Observable<void> {
    return from(del(key));
  }

  /** Remove várias chaves explícitas em uma única operação lógica. */
  deletePersistentMany(keys: string[]): Observable<number> {
    const safeKeys = this.normalizeValues(keys);

    if (!safeKeys.length) {
      return of(0);
    }

    return from(
      Promise.all(safeKeys.map((key) => del(key))).then(
        () => safeKeys.length
      )
    );
  }

  /**
   * Remove chaves de vários prefixos com apenas uma varredura do IndexedDB.
   * Isso evita repetir idbKeys() para cada categoria durante logout/troca de UID.
   */
  deletePersistentByPrefixes(prefixes: string[]): Observable<number> {
    const safePrefixes = this.normalizeValues(prefixes);

    if (!safePrefixes.length) {
      return of(0);
    }

    return from(
      idbKeys().then((allKeys) => {
        const matchingKeys = allKeys.filter(
          (key): key is string =>
            typeof key === 'string' &&
            safePrefixes.some((prefix) => key.startsWith(prefix))
        );

        return Promise.all(matchingKeys.map((key) => del(key))).then(
          () => matchingKeys.length
        );
      })
    );
  }

  /** Compatibilidade: delega para a versão que varre apenas uma vez. */
  deletePersistentByPrefix(prefix: string): Observable<number> {
    return this.deletePersistentByPrefixes([prefix]);
  }

  private normalizeValues(values: readonly string[]): string[] {
    return Array.from(
      new Set(
        (values ?? [])
          .map((value) => String(value ?? '').trim())
          .filter(Boolean)
      )
    );
  }
}
