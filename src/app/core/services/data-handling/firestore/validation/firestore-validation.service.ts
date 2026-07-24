// src/app/core/services/data-handling/firestore/validation/firestore-validation.service.ts
// Validações pontuais de índice público.
//
// O cache de validação:
// - é efêmero e somente em memória;
// - é global porque o índice de apelidos é público e anterior ao login;
// - usa contrato tipado e resultado discriminado;
// - nunca substitui a transação autoritativa do backend.
import {
  inject,
  Injectable,
  Injector,
  runInInjectionContext,
} from '@angular/core';
import { from, Observable, of } from 'rxjs';
import {
  catchError,
  map,
  switchMap,
  take,
} from 'rxjs/operators';

import {
  Firestore,
  doc,
  getDoc,
  getDocFromCache,
  getDocFromServer,
} from '@angular/fire/firestore';

import { AppCacheService } from '../../../general/cache/app-cache.service';
import { CacheDefinition } from '../../../general/cache/cache-contracts';
import { FirestoreErrorHandlerService } from '../../../error-handler/firestore-error-handler.service';
import { NicknameUtils } from '@core/utils/nickname-utils';

type Mode = 'soft' | 'strict';
type Source = 'default' | 'server' | 'cache';

@Injectable({ providedIn: 'root' })
export class FirestoreValidationService {
  private readonly db = inject(Firestore);

  constructor(
    private readonly cache: AppCacheService,
    private readonly firestoreError: FirestoreErrorHandlerService,
    private readonly injector: Injector
  ) {}

  /**
   * Consulta direta ao public_index.
   *
   * soft:
   * - usa cache de memória por 60 segundos;
   * - falha de rede não bloqueia a UX;
   * - a transação de cadastro continua sendo a proteção autoritativa.
   *
   * strict:
   * - força servidor;
   * - não usa cache;
   * - propaga falha pelo handler centralizado.
   */
  checkIfNicknameExists(
    fullNick: string,
    opts?: { mode?: Mode }
  ): Observable<boolean> {
    const mode: Mode = opts?.mode ?? 'soft';
    const normalized = this.normalizeNickname(fullNick);

    if (!normalized) return of(false);

    const definition = this.nicknameCacheDefinition(normalized, mode);
    const source: Source = mode === 'strict' ? 'server' : 'default';

    const cached$ =
      mode === 'soft'
        ? this.cache.get$(definition)
        : of({ status: 'miss' } as const);

    return cached$.pipe(
      switchMap((cached) => {
        if (mode === 'soft' && cached.status !== 'miss') {
          return of(cached.value);
        }

        return this.getPublicIndexDocOnce$(
          'public_index',
          `nickname:${normalized}`,
          source
        ).pipe(
          map((value) => !!value),
          switchMap((exists) => {
            if (mode !== 'soft') {
              return of(exists);
            }

            return this.cache
              .set$(definition, exists)
              .pipe(map(() => exists));
          }),
          catchError((error) => {
            if (mode === 'soft') return of(false);
            return this.firestoreError.handleFirestoreError(error);
          }),
          take(1)
        );
      }),
      take(1)
    );
  }

  private nicknameCacheDefinition(
    normalizedNickname: string,
    mode: Mode
  ): CacheDefinition<boolean> {
    return {
      key: `validation:nickname:${normalizedNickname}:${mode}`,
      scope: 'global',
      sensitivity: 'public',
      storage: 'memory',
      ttlMs: 60_000,
      version: 1,
      validate: (value: unknown): value is boolean =>
        typeof value === 'boolean',
    };
  }

  private normalizeNickname(input: string): string {
    return NicknameUtils.normalizarApelidoParaIndice(input);
  }

  /** GET único dentro do Injection Context do AngularFire. */
  private getPublicIndexDocOnce$(
    collectionName: string,
    docId: string,
    source: Source
  ): Observable<unknown | null> {
    return runInInjectionContext(this.injector, () => {
      const ref = doc(this.db, collectionName, docId);
      const request =
        source === 'server'
          ? from(getDocFromServer(ref))
          : source === 'cache'
            ? from(getDocFromCache(ref))
            : from(getDoc(ref));

      return request.pipe(
        map((snapshot) =>
          snapshot.exists() ? snapshot.data() : null
        )
      );
    });
  }
}
