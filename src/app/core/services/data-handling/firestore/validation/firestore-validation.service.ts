// src/app/core/services/data-handling/firestore/validation/firestore-validation.service.ts
import { Injectable } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';
import { CacheService } from '../../../general/cache/cache.service';
import { FirestoreReadService } from '../core/firestore-read.service';

@Injectable({ providedIn: 'root' })
export class FirestoreValidationService {
  constructor(
    private readonly read: FirestoreReadService,
    private readonly cache: CacheService
  ) { }

  checkIfNicknameExists(
    fullNick: string,
    opts?: { mode?: 'soft' | 'strict' }
  ): Observable<boolean> {
    const mode = opts?.mode ?? 'soft';
    const nick = (fullNick ?? '').trim();

    if (!nick) return of(false);

    const cacheKey = `validation:v2:nickname:${nick}:${mode}`;
    const docId = `nickname:${nick}`;

    const source = mode === 'strict' ? 'server' : 'default';
    const silent = mode !== 'strict';

    // soft pode usar cache; strict não
    const cached$ = mode === 'soft' ? this.cache.get<boolean>(cacheKey) : of(null);

    return cached$.pipe(
      switchMap((cached) => {
        if (mode === 'soft' && cached !== null && cached !== undefined) return of(cached);

        return this.read.getDocument<any>('public_index', docId, {
          source,
          silent,
          context: `nickname-${mode}`
        }).pipe(
          map(doc => doc !== null),
          tap((exists) => {
            if (mode === 'soft') this.cache.set(cacheKey, exists, 60_000); // 1 min, ajuste como quiser
          }),
          catchError((err) => {
            // soft: não trava fluxo
            if (mode === 'soft') return of(false);

            // strict: não assume “livre”
            return throwError(() => err);
          })
        );
      })
    );
  }
}
