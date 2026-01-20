// src/app/core/services/data-handling/firestore/validation/firestore-validation.service.ts
// Não esqueça os comentários explicativos.'
import { inject, Injectable, Injector, runInInjectionContext } from '@angular/core';
import { Observable, of, from } from 'rxjs';
import { catchError, map, switchMap, tap, take } from 'rxjs/operators';

import { CacheService } from '../../../general/cache/cache.service';
import { FirestoreErrorHandlerService } from '../../../error-handler/firestore-error-handler.service';

// AngularFire Firestore (GET 1x)
import { Firestore, doc, getDocFromServer, getDoc, getDocFromCache } from '@angular/fire/firestore';

type Mode = 'soft' | 'strict';
type Source = 'default' | 'server' | 'cache';

@Injectable({ providedIn: 'root' })
export class FirestoreValidationService {
  private readonly db = inject(Firestore);

  constructor(
    private readonly cache: CacheService,
    private readonly firestoreError: FirestoreErrorHandlerService,
    private readonly injector: Injector
  ) { }

  /**
   * =============================================================================
   * checkIfNicknameExists (consulta direta ao public_index)
   *
   * Objetivo:
   * - Não validar duplicidade de nickname ANTES de criar usuário
   * - permitir uso no /register sem usuário autenticado (rules: nickname get público)
   *
   * Modos:
   * - soft: tolerante (se falhar rede, NÃO trava UX -> assume "não existe" e transação garante depois)
   * - strict: conservador (se falhar, NÃO assume livre -> propaga erro)
   * =============================================================================
   */
  checkIfNicknameExists(
    fullNick: string,
    opts?: { mode?: Mode }
  ): Observable<boolean> {
    const mode: Mode = opts?.mode ?? 'soft';

    // ✅ normalização consistente com seu índice
    const normalized = this.normalizeNickname(fullNick);
    if (!normalized) return of(false);

    const cacheKey = `validation:v2:nickname:${normalized}:${mode}`;
    const docId = `nickname:${normalized}`;

    // soft: pode usar cache + source default
    // strict: força server e não usa cache
    const source: Source = mode === 'strict' ? 'server' : 'default';

    const cached$ = mode === 'soft' ? this.cache.get<boolean>(cacheKey) : of(null);

    return cached$.pipe(
      switchMap((cached) => {
        if (mode === 'soft' && cached !== null && cached !== undefined) return of(cached);

        return this.getPublicIndexDocOnce$('public_index', docId, source).pipe(
          map((exists) => !!exists),
          tap((exists) => {
            if (mode === 'soft') this.cache.set(cacheKey, exists, 60_000);
          }),
          catchError((err) => {
            // soft: falhou? não trava UX (a transaction do cadastro ainda protege duplicidade)
            if (mode === 'soft') return of(false);

            // strict: falhou? não assumir “livre”
            // mantém tratamento centralizado
            return this.firestoreError.handleFirestoreError(err);
          }),
          take(1)
        );
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private normalizeNickname(input: string): string {
    // mínimo e direto: trim + lower
    // (se você quiser, depois pode padronizar espaços: .replace(/\s+/g, ' '))
    return (input ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  }

  /**
   * GET 1x no doc do public_index.
   * Usa InjectionContext (padrão do seu projeto) e não abre listener.
   */
  private getPublicIndexDocOnce$(
    collectionName: string,
    docId: string,
    source: Source
  ): Observable<unknown | null> {
    return runInInjectionContext(this.injector, () => {
      const ref = doc(this.db, collectionName, docId);

      const req =
        source === 'server' ? from(getDocFromServer(ref)) :
          source === 'cache' ? from(getDocFromCache(ref)) :
            from(getDoc(ref));

      return req.pipe(
        map((snap) => (snap.exists() ? (snap.data() as any) : null))
      );
    });
  }
} // 113 linhas
