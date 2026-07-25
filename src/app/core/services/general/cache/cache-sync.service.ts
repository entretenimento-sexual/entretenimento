// src/app/core/services/general/cache/cache-sync.service.ts
import { Injectable, inject } from '@angular/core';
import { Firestore, collection, onSnapshot } from '@angular/fire/firestore';
import { Observable } from 'rxjs';

import { GlobalErrorHandlerService } from '../../error-handler/global-error-handler.service';
import { PrivacyDebugLoggerService } from '../../privacy/privacy-debug-logger.service';
import { CacheService } from './cache.service';

@Injectable({ providedIn: 'root' })
export class CacheSyncService {
  private readonly db = inject(Firestore);

  constructor(
    private readonly cacheService: CacheService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly privacyDebug: PrivacyDebugLoggerService
  ) {}

  syncFirestoreCollection(collectionName: string): Observable<void> {
    const safeCollectionName = String(collectionName ?? '').trim();

    return new Observable<void>((observer) => {
      if (!safeCollectionName) {
        observer.error(new Error('Nome de coleção inválido para sincronização.'));
        return undefined;
      }

      const ref = collection(this.db, safeCollectionName);
      const unsubscribe = onSnapshot(
        ref,
        (snapshot) => {
          for (const change of snapshot.docChanges()) {
            const key = `${safeCollectionName}:${change.doc.id}`;

            if (change.type === 'removed') {
              this.cacheService.delete(key);
              this.log('entrada removida', { key });
              continue;
            }

            this.cacheService.set(key, change.doc.data());
            this.log('entrada sincronizada', { key, type: change.type });
          }

          observer.next();
        },
        (error: unknown) => {
          this.reportError(error, safeCollectionName);
          observer.error(error);
        }
      );

      return () => unsubscribe();
    });
  }

  private reportError(error: unknown, collectionName: string): void {
    try {
      const normalized = error instanceof Error
        ? error
        : new Error('Falha ao sincronizar coleção com o cache.');

      (normalized as Error & { context?: Record<string, unknown> }).context = {
        scope: 'CacheSyncService',
        collectionName,
      };

      this.globalErrorHandler.handleError(normalized);
    } catch {
      // noop
    }
  }

  private log(message: string, extra?: unknown): void {
    this.privacyDebug.log(
      'cache',
      `CacheSyncService: ${message}`,
      extra
    );
  }
}
