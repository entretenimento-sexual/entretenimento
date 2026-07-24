// src/app/core/services/data-handling/firestore-query.service.ts
// Fonte única de consultas Firestore compatíveis com AngularFire.
//
// SUPRESSÃO EXPLÍCITA DESTA MIGRAÇÃO:
// - SUPRIMIDA a chave legada `allUsers` do CacheService.
//   Motivo: a coleção completa de usuários não pode ser persistida
//   automaticamente no IndexedDB nem compartilhada entre contas.
// - `getAllUsers()` mantém o mesmo nome e retorno, mas agora usa cache privado,
//   user-scoped quando há UID e somente em memória.
import { inject, Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map, switchMap, take } from 'rxjs/operators';
import {
  Firestore,
  limit,
  QueryConstraint,
  where,
} from '@angular/fire/firestore';

import { IUserDados } from '../../interfaces/iuser-dados';
import { AppCacheService } from '../general/cache/app-cache.service';
import { CacheDefinition } from '../general/cache/cache-contracts';
import { FirestoreReadService } from './firestore/core/firestore-read.service';
import { FirestoreContextService } from './firestore/core/firestore-context.service';
import { UserPresenceQueryService } from './queries/user-presence.query.service';
import { CurrentUserStoreService } from '../autentication/auth/current-user-store.service';
import { AppState } from 'src/app/store/states/app.state';
import { Store } from '@ngrx/store';
import { selectUserProfileDataByUid } from 'src/app/store/selectors/selectors.user/user-profile.selectors';

@Injectable({ providedIn: 'root' })
export class FirestoreQueryService {
  private readonly db = inject(Firestore);
  private readonly ctx = inject(FirestoreContextService);

  private readonly cache = inject(AppCacheService);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly read = inject(FirestoreReadService);
  private readonly presenceQuery = inject(UserPresenceQueryService);

  // Compatibilidade temporária: leitura de estado ainda presente neste service.
  private readonly store = inject(Store<AppState>);

  getFirestoreInstance(): Firestore {
    return this.db;
  }

  getDocumentById<T>(
    collectionName: string,
    id: string
  ): Observable<T | null> {
    return this.read.getDocument<T>(collectionName, id);
  }

  /** Constrói constraints dentro do contexto de injeção do AngularFire. */
  private getDocumentsByQuerySafe<T>(
    collectionName: string,
    buildConstraints: () => QueryConstraint[],
    options?: {
      useCache?: boolean;
      cacheTTL?: number;
      idField?: string;
      requireAuth?: boolean;
    }
  ): Observable<T[]> {
    return this.ctx.deferObservable$(() =>
      this.read.getDocumentsOnce<T>(
        collectionName,
        buildConstraints(),
        options
      )
    );
  }

  /** Query realtime com constraints criadas no contexto correto. */
  private getDocumentsLiveByQuerySafe<T>(
    collectionName: string,
    buildConstraints: () => QueryConstraint[],
    options?: {
      idField?: string;
      requireAuth?: boolean;
    }
  ): Observable<T[]> {
    return this.ctx.deferObservable$(() =>
      this.read.getDocumentsLiveSafe<T>(
        collectionName,
        buildConstraints(),
        options
      )
    );
  }

  /**
   * Compatibilidade para callers que ainda entregam QueryConstraint[] pronto.
   * Novos fluxos devem preferir factories de constraints no contexto seguro.
   */
  getDocumentsByQuery<T>(
    collectionName: string,
    constraints: QueryConstraint[]
  ): Observable<T[]> {
    return this.ctx.deferObservable$(() =>
      this.read.getDocumentsOnce<T>(collectionName, constraints, {
        useCache: true,
        cacheTTL: 300_000,
      })
    );
  }

  /**
   * Retorna todos os usuários autorizados pela consulta.
   * O payload permanece apenas em memória e isolado pelo UID do viewer.
   */
  getAllUsers(): Observable<IUserDados[]> {
    const definition = this.allUsersCacheDefinition();

    return this.cache.get$(definition).pipe(
      switchMap((cached) => {
        if (cached.status !== 'miss') {
          return of(cached.value);
        }

        return this.getDocumentsByQuerySafe<IUserDados>(
          'users',
          () => [],
          {
            idField: 'uid',
            requireAuth: true,
          }
        ).pipe(
          switchMap((users) =>
            this.cache
              .set$(definition, users)
              .pipe(map(() => users))
          ),
          catchError(() => of<IUserDados[]>([]))
        );
      }),
      take(1)
    );
  }

  getOnlineUsers$(): Observable<IUserDados[]> {
    return this.presenceQuery.getOnlineUsers$();
  }

  getOnlineUsers(): Observable<IUserDados[]> {
    return this.presenceQuery.getOnlineUsersOnce$().pipe(take(1));
  }

  getOnlineUsersByRegion(
    municipio: string
  ): Observable<IUserDados[]> {
    return this.presenceQuery.getOnlineUsersByRegion$(municipio);
  }

  getRecentlyOnline$(windowMs = 45_000): Observable<IUserDados[]> {
    return this.presenceQuery.getRecentlyOnline$(windowMs);
  }

  getUsersByMunicipio(
    municipio: string
  ): Observable<IUserDados[]> {
    return this.getDocumentsByQuerySafe<IUserDados>('users', () => [
      where('municipio', '==', municipio),
    ]).pipe(catchError(() => of([] as IUserDados[])));
  }

  getOnlineUsersByMunicipio(
    municipio: string
  ): Observable<IUserDados[]> {
    return this.getOnlineUsersByRegion(municipio).pipe(
      catchError(() => of([] as IUserDados[]))
    );
  }

  getSuggestedProfiles(
    limitCount = 24
  ): Observable<IUserDados[]> {
    return this.getDocumentsLiveByQuerySafe<IUserDados>(
      'public_profiles',
      () => [limit(limitCount)],
      {
        idField: 'uid',
        requireAuth: true,
      }
    ).pipe(
      map((profiles) => (profiles ?? []) as IUserDados[]),
      catchError(() => of([] as IUserDados[]))
    );
  }

  getProfilesByOrientationAndLocation(
    gender: string,
    orientation: string,
    municipio: string
  ): Observable<IUserDados[]> {
    return this.getDocumentsByQuerySafe<IUserDados>('users', () => [
      where('gender', '==', gender),
      where('orientation', '==', orientation),
      where('municipio', '==', municipio),
    ]).pipe(catchError(() => of([] as IUserDados[])));
  }

  /**
   * STATE-only por compatibilidade.
   * Não consulta Firestore e deve migrar futuramente para uma facade de estado.
   */
  getUserFromState(uid: string): Observable<IUserDados | null> {
    const id = String(uid ?? '').trim();
    if (!id) return of(null);

    return this.store.select(selectUserProfileDataByUid(id)).pipe(
      take(1),
      catchError(() => of(null))
    );
  }

  searchUsers(
    constraints: QueryConstraint[]
  ): Observable<IUserDados[]> {
    return this.getDocumentsByQuery<IUserDados>(
      'users',
      constraints
    ).pipe(catchError(() => of([] as IUserDados[])));
  }

  private allUsersCacheDefinition(): CacheDefinition<IUserDados[]> {
    const ownerUid =
      this.currentUserStore.getLoggedUserUIDSnapshot();

    const base = {
      key: 'all-users',
      sensitivity: 'private' as const,
      storage: 'memory' as const,
      ttlMs: 10 * 60 * 1000,
      version: 1,
      validate: (value: unknown): value is IUserDados[] =>
        Array.isArray(value) &&
        value.every(
          (item) =>
            !!item &&
            typeof item === 'object' &&
            typeof (item as { uid?: unknown }).uid === 'string'
        ),
    };

    return ownerUid
      ? {
          ...base,
          scope: 'user',
          ownerUid,
        }
      : {
          ...base,
          scope: 'session',
        };
  }
}
