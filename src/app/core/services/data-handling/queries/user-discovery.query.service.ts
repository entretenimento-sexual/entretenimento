//src\app\core\services\data-handling\queries\user-discovery.query.service.ts
import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, switchMap, map } from 'rxjs/operators';
import { QueryConstraint, where } from 'firebase/firestore';

import { IUserDados } from '@core/interfaces/iuser-dados';
import { CacheService } from '@core/services/general/cache/cache.service';
import { FirestoreReadService } from '../firestore/core/firestore-read.service';
import { FirestoreErrorHandlerService } from '@core/services/error-handler/firestore-error-handler.service';

@Injectable({ providedIn: 'root' })
export class UserDiscoveryQueryService {
  constructor(
    private readonly read: FirestoreReadService,
    private readonly cache: CacheService,
    private readonly firestoreError: FirestoreErrorHandlerService
  ) { }

  /** One-shot genérico: discovery/search por constraints */
  searchUsers(constraints: QueryConstraint[]): Observable<IUserDados[]> {
    return this.read
      .getDocumentsOnce<IUserDados>('users', constraints ?? [], {
        useCache: true,
        cacheTTL: 60_000,
        mapIdField: 'uid',
      })
      .pipe(
        catchError((err) => {
          this.firestoreError.handleFirestoreError(err);
          return of([] as IUserDados[]);
        })
      );
  }

  /** Caso clássico de discovery: filtros “fixos” */
  getProfilesByOrientationAndLocation(
    gender: string,
    orientation: string,
    municipio: string
  ): Observable<IUserDados[]> {
    const g = (gender ?? '').trim();
    const o = (orientation ?? '').trim();
    const m = (municipio ?? '').trim();
    if (!g || !o || !m) return of([]);

    return this.searchUsers([
      where('gender', '==', g),
      where('orientation', '==', o),
      where('municipio', '==', m),
    ]);
  }

  /** Lista geral (com cache) — útil pra painéis/admin/dev */
  getAllUsers$(): Observable<IUserDados[]> {
    const cacheKey = 'users:all';

    return this.cache.get<IUserDados[]>(cacheKey).pipe(
      switchMap((cached) => {
        if (cached) return of(cached);

        return this.read
          .getDocumentsOnce<IUserDados>('users', [], {
            useCache: true,
            cacheTTL: 300_000,
            mapIdField: 'uid',
          })
          .pipe(
            map((users) => {
              this.cache.set(cacheKey, users, 600_000);
              return users;
            })
          );
      }),
      catchError((err) => {
        this.firestoreError.handleFirestoreError(err);
        return of([] as IUserDados[]);
      })
    );
  }
} //***** Sempre considera que existe o auth/presence.service.ts *****
