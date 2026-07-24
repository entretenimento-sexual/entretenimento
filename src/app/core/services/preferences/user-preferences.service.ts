// src/app/core/services/preferences/user-preferences.service.ts
// Serviço de preferências com Store + cache restrito em memória + Firestore.
//
// Estratégia:
// 1) NgRx é o estado compartilhado da aplicação.
// 2) AppCacheService acelera leituras durante a sessão.
// 3) Firestore permanece como fonte persistente e autoritativa.
// 4) Cache stale é emitido imediatamente e revalidado em seguida (SWR).
// 5) Leituras Firestore concorrentes do mesmo UID são coalescidas.
// 6) Erros continuam centralizados no GlobalErrorHandlerService e no
//    ErrorNotificationService quando há impacto real para o usuário.
//
// SUPRESSÕES EXPLÍCITAS DESTA MIGRAÇÃO:
// - SUPRIMIDA a persistência automática em IndexedDB das preferências.
//   Motivo: gênero, práticas e preferências são dados restritos.
// - SUPRIMIDA a chave separada `preferences:{uid}:meta`.
//   Motivo: TTL e stale window agora pertencem ao mesmo envelope tipado.
// - SUPRIMIDO o cálculo manual de freshness.
//   Motivo: AppCacheService centraliza TTL, versão, escopo e resultado fresh/stale.
// - SUPRIMIDO o tratamento duplicado no catch externo de leitura.
//   Motivo: a leitura Firestore já registra/notifica uma vez no ponto de origem.
import { Injectable } from '@angular/core';
import {
  Firestore,
  collection,
  doc,
  getDocs,
  writeBatch,
} from '@angular/fire/firestore';
import { Store } from '@ngrx/store';
import {
  EMPTY,
  Observable,
  concat,
  of,
  throwError,
} from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  finalize,
  map,
  shareReplay,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';

import { IUserPreferences } from '../../interfaces/interfaces-user-dados/iuser-preferences';
import { AppCacheService } from '../general/cache/app-cache.service';
import { CacheDefinition } from '../general/cache/cache-contracts';
import { CacheLegacyMigrationService } from '../general/cache/cache-legacy-migration.service';
import { AppState } from 'src/app/store/states/app.state';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../error-handler/error-notification.service';
import {
  loadUserPreferencesSuccess,
  updateUserPreferences,
} from '../../../store/actions/actions.user/user-preferences.actions';
import { selectUserPreferences } from '../../../store/selectors/selectors.user/user-preferences.selectors';
import { FirestoreContextService } from '../data-handling/firestore/core/firestore-context.service';

@Injectable({ providedIn: 'root' })
export class UserPreferencesService {
  private readonly cacheTtlMs = 10 * 60 * 1000;
  private readonly cacheStaleWindowMs = 50 * 60 * 1000;

  private readonly allowedKeys: Array<keyof IUserPreferences> = [
    'genero',
    'praticaSexual',
    'preferenciaFisica',
    'relacionamento',
  ];

  private readonly inFlightReads = new Map<
    string,
    Observable<IUserPreferences>
  >();

  constructor(
    private readonly db: Firestore,
    private readonly cache: AppCacheService,
    private readonly legacyCacheMigration: CacheLegacyMigrationService,
    private readonly store: Store<AppState>,
    private readonly errorHandler: GlobalErrorHandlerService,
    private readonly notifier: ErrorNotificationService,
    private readonly firestoreCtx: FirestoreContextService
  ) {}

  /**
   * Salva somente as categorias presentes no patch.
   * Após o commit, Store e cache de memória recebem o merge determinístico.
   */
  saveUserPreferences$(
    uid: string,
    preferences: Partial<IUserPreferences>
  ): Observable<void> {
    const safeUid = String(uid ?? '').trim();

    if (!safeUid) {
      return throwError(
        () => new Error('[UserPreferencesService] UID inválido.')
      );
    }

    const patch = this.sanitizePatch(preferences);

    if (this.isEmptyPatch(patch)) {
      return of(void 0);
    }

    return this.purgeLegacyPreferencesCacheOnce$().pipe(
      switchMap(() =>
        this.store.select(selectUserPreferences(safeUid)).pipe(
          take(1),
          switchMap((stored) =>
            this.saveUserPreferencesInternal$(safeUid, patch).pipe(
              switchMap(() => {
                const merged = this.mergePreferences(
                  stored ?? this.defaultPreferences(),
                  patch
                );

                this.store.dispatch(
                  updateUserPreferences({
                    uid: safeUid,
                    preferences: patch,
                  })
                );

                return this.cache.set$(
                  this.cacheDefinition(safeUid),
                  merged
                );
              })
            )
          )
        )
      ),
      catchError((error) => {
        this.routeError(
          error,
          'saveUserPreferences$',
          'Erro ao salvar preferências. Tente novamente mais tarde.'
        );
        return throwError(() => error);
      })
    );
  }

  /**
   * Obtém preferências em camadas:
   * - Store;
   * - cache fresh;
   * - cache stale + revalidação;
   * - Firestore em caso de miss.
   */
  getUserPreferences$(uid: string): Observable<IUserPreferences> {
    const safeUid = String(uid ?? '').trim();

    if (!safeUid) {
      return throwError(
        () => new Error('[UserPreferencesService] UID inválido.')
      );
    }

    return this.purgeLegacyPreferencesCacheOnce$().pipe(
      switchMap(() =>
        this.store.select(selectUserPreferences(safeUid)).pipe(
          distinctUntilChanged(),
          switchMap((storedPreferences) => {
            if (storedPreferences) {
              return of(storedPreferences);
            }

            return this.cache
              .get$(this.cacheDefinition(safeUid))
              .pipe(
                switchMap((result) => {
                  if (result.status === 'fresh') {
                    this.store.dispatch(
                      loadUserPreferencesSuccess({
                        uid: safeUid,
                        preferences: result.value,
                      })
                    );
                    return of(result.value);
                  }

                  if (result.status === 'stale') {
                    const cached$ = of(result.value).pipe(
                      tap((preferencesValue) =>
                        this.store.dispatch(
                          loadUserPreferencesSuccess({
                            uid: safeUid,
                            preferences: preferencesValue,
                          })
                        )
                      )
                    );

                    const refresh$ = this.getOrCreateFirestoreRead$(
                      safeUid,
                      { notifyOnError: false }
                    ).pipe(
                      // Há dado stale utilizável. Falha de refresh não deve gerar
                      // outro feedback nem invalidar o valor já exibido.
                      catchError(() => EMPTY)
                    );

                    return concat(cached$, refresh$).pipe(
                      distinctUntilChanged((a, b) =>
                        this.deepEqual(a, b)
                      )
                    );
                  }

                  return this.getOrCreateFirestoreRead$(safeUid, {
                    notifyOnError: true,
                    userMessage:
                      'Erro ao carregar preferências do usuário.',
                  });
                })
              );
          })
        )
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private saveUserPreferencesInternal$(
    uid: string,
    preferences: Partial<IUserPreferences>
  ): Observable<void> {
    return this.firestoreCtx.deferPromise$(() => {
      const userRef = doc(this.db, `users/${uid}`);
      const preferencesCollection = collection(
        userRef,
        'preferences'
      );
      const batch = writeBatch(this.db);

      for (const key of this.allowedKeys) {
        if (!(key in preferences)) continue;

        const values = preferences[key] ?? [];
        const preferenceDocRef = doc(
          preferencesCollection,
          String(key)
        );

        batch.set(
          preferenceDocRef,
          { value: values },
          { merge: true }
        );
      }

      return batch.commit();
    }).pipe(map(() => void 0));
  }

  private getUserPreferencesInternal$(
    uid: string
  ): Observable<IUserPreferences> {
    return this.firestoreCtx.deferPromise$(() => {
      const collectionRef = collection(
        this.db,
        `users/${uid}/preferences`
      );
      return getDocs(collectionRef);
    }).pipe(
      map((querySnapshot) => {
        const preferences = this.defaultPreferences();

        querySnapshot.forEach((preferenceDoc) => {
          const key = preferenceDoc.id as keyof IUserPreferences;
          if (!this.allowedKeys.includes(key)) return;

          const data = preferenceDoc.data() as {
            value?: unknown;
          };
          preferences[key] = this.normalizeStringArray(data.value);
        });

        return preferences;
      })
    );
  }

  /** Uma leitura Firestore compartilhada por UID. */
  private getOrCreateFirestoreRead$(
    uid: string,
    options: { notifyOnError: boolean; userMessage?: string }
  ): Observable<IUserPreferences> {
    const existingRead = this.inFlightReads.get(uid);
    if (existingRead) return existingRead;

    const read$ = this.getUserPreferencesInternal$(uid).pipe(
      switchMap((preferences) => {
        this.store.dispatch(
          loadUserPreferencesSuccess({ uid, preferences })
        );

        return this.cache
          .set$(this.cacheDefinition(uid), preferences)
          .pipe(map(() => preferences));
      }),
      catchError((error) => {
        this.routeError(
          error,
          'getUserPreferencesInternal$',
          options.notifyOnError
            ? options.userMessage ??
                'Erro ao carregar preferências do usuário.'
            : undefined
        );
        return throwError(() => error);
      }),
      finalize(() => this.inFlightReads.delete(uid)),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.inFlightReads.set(uid, read$);
    return read$;
  }

  private purgeLegacyPreferencesCacheOnce$(): Observable<void> {
    return this.legacyCacheMigration.purgePrefixesOnce$(
      'legacy-user-preferences-indexeddb-v1',
      ['preferences:']
    );
  }

  private cacheDefinition(
    uid: string
  ): CacheDefinition<IUserPreferences> {
    return {
      key: 'preferences',
      scope: 'user',
      ownerUid: uid,
      sensitivity: 'restricted',
      storage: 'memory',
      ttlMs: this.cacheTtlMs,
      staleWhileRevalidateMs: this.cacheStaleWindowMs,
      version: 1,
      validate: (
        value: unknown
      ): value is IUserPreferences =>
        this.isValidPreferences(value),
    };
  }

  private isValidPreferences(
    value: unknown
  ): value is IUserPreferences {
    if (!value || typeof value !== 'object') return false;

    const record = value as Record<string, unknown>;

    return this.allowedKeys.every((key) => {
      const item = record[String(key)];
      return (
        Array.isArray(item) &&
        item.every((entry) => typeof entry === 'string')
      );
    });
  }

  private defaultPreferences(): IUserPreferences {
    return {
      genero: [],
      praticaSexual: [],
      preferenciaFisica: [],
      relacionamento: [],
    };
  }

  private sanitizePatch(
    patch: Partial<IUserPreferences>
  ): Partial<IUserPreferences> {
    const output: Partial<IUserPreferences> = {};

    for (const key of this.allowedKeys) {
      if (!(key in (patch ?? {}))) continue;
      output[key] = this.normalizeStringArray(patch[key]);
    }

    return output;
  }

  private isEmptyPatch(
    patch: Partial<IUserPreferences>
  ): boolean {
    return Object.keys(patch ?? {}).length === 0;
  }

  private normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];

    return Array.from(
      new Set(
        value
          .filter(
            (entry): entry is string =>
              typeof entry === 'string'
          )
          .map((entry) => entry.trim())
          .filter(Boolean)
      )
    );
  }

  private mergePreferences(
    base: IUserPreferences,
    patch: Partial<IUserPreferences>
  ): IUserPreferences {
    return {
      genero: patch['genero'] ?? base['genero'] ?? [],
      praticaSexual:
        patch['praticaSexual'] ?? base['praticaSexual'] ?? [],
      preferenciaFisica:
        patch['preferenciaFisica'] ?? base['preferenciaFisica'] ?? [],
      relacionamento:
        patch['relacionamento'] ?? base['relacionamento'] ?? [],
    };
  }

  private deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;

    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }

  private routeError(
    error: unknown,
    context: string,
    userMessage?: string
  ): void {
    const wrapped =
      error instanceof Error
        ? error
        : new Error(`[UserPreferencesService] ${context}`);

    (wrapped as any).silent = true;
    (wrapped as any).skipUserNotification = true;
    (wrapped as any).original = error;
    (wrapped as any).context = context;
    (wrapped as any).feature = 'user-preferences';

    this.errorHandler.handleError(wrapped);

    if (userMessage) {
      this.notifier.showError(userMessage);
    }
  }
}
