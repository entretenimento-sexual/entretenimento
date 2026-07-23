// src/app/core/services/general/cache/cache-legacy-migration.service.ts
// Executor temporário de limpezas idempotentes do cache legado.
//
// Este serviço existe durante a migração do CacheService antigo para o
// AppCacheService. Ele deve ser removido quando todas as versões legadas
// relevantes já tiverem sido saneadas.
import { Injectable } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import {
  catchError,
  finalize,
  map,
  shareReplay,
  tap,
} from 'rxjs/operators';

import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { CachePersistenceService } from './cache-persistence.service';

@Injectable({ providedIn: 'root' })
export class CacheLegacyMigrationService {
  private readonly completed = new Set<string>();
  private readonly inFlight = new Map<string, Observable<void>>();

  constructor(
    private readonly persistence: CachePersistenceService,
    private readonly globalError: GlobalErrorHandlerService
  ) {}

  /**
   * Remove prefixos legados no máximo uma vez por execução da aplicação.
   * Em caso de falha, a migração não é marcada como concluída e poderá tentar
   * novamente em outra chamada.
   */
  purgePrefixesOnce$(
    migrationId: string,
    prefixes: readonly string[]
  ): Observable<void> {
    const id = String(migrationId ?? '').trim();
    const safePrefixes = Array.from(
      new Set(
        (prefixes ?? [])
          .map((prefix) => String(prefix ?? '').trim())
          .filter(Boolean)
      )
    );

    if (!id) {
      return throwError(
        () =>
          new Error(
            '[CacheLegacyMigrationService] migrationId obrigatório.'
          )
      );
    }

    if (!safePrefixes.length || this.completed.has(id)) {
      return of(void 0);
    }

    const existing = this.inFlight.get(id);
    if (existing) return existing;

    const migration$ = this.persistence
      .deletePersistentByPrefixes(safePrefixes)
      .pipe(
        tap(() => this.completed.add(id)),
        map(() => void 0),
        catchError((error) => {
          this.report(error, id, safePrefixes);
          return of(void 0);
        }),
        finalize(() => this.inFlight.delete(id)),
        shareReplay({ bufferSize: 1, refCount: false })
      );

    this.inFlight.set(id, migration$);
    return migration$;
  }

  private report(
    error: unknown,
    migrationId: string,
    prefixes: readonly string[]
  ): void {
    try {
      const wrapped =
        error instanceof Error
          ? error
          : new Error('[CacheLegacyMigrationService] internal error');

      (wrapped as any).original = error;
      (wrapped as any).feature = 'cache-legacy-migration';
      (wrapped as any).context = {
        migrationId,
        prefixCount: prefixes.length,
      };
      (wrapped as any).silent = true;
      (wrapped as any).skipUserNotification = true;

      this.globalError.handleError(wrapped);
    } catch {
      // Limpeza legada é best-effort e não pode bloquear a aplicação.
    }
  }
}
