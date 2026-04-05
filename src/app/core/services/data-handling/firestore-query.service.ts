// src/app/core/services/data-handling/firestore-query.service.ts
// Fonte única do Firestore (AngularFire).
//
// Objetivo:
// - evitar mistura de imports (firebase/firestore vs @angular/fire/firestore)
// - parar de usar APIs function-based do AngularFire fora do Injection Context
// - manter API pública simples
// - explicitar o que é Firebase/AngularFire e o que ainda é compat com NgRx
//
// Ajustes desta revisão:
// - adiciona FirestoreContextService
// - cria helpers internos seguros para queries once/live
// - corrige getSuggestedProfiles() e demais métodos que constroem where/limit
// - mantém getUserFromState() por compatibilidade, mas explicitamente marcado como STATE-only
//
// Observação arquitetural:
// - Padrão ideal de plataforma grande:
//   * FirestoreQueryService / PresenceQueryService => somente Firebase/AngularFire
//   * UserStateQueryService (ou facade) => somente NgRx
// - Por enquanto, getUserFromState() continua aqui apenas para não quebrar callers.
import { inject, Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map, switchMap, take } from 'rxjs/operators';
import { Firestore, limit, QueryConstraint, where } from '@angular/fire/firestore';

import { IUserDados } from '../../interfaces/iuser-dados';
import { CacheService } from '../general/cache/cache.service';
import { FirestoreReadService } from './firestore/core/firestore-read.service';
import { FirestoreContextService } from './firestore/core/firestore-context.service';
import { UserPresenceQueryService } from './queries/user-presence.query.service';
import { AppState } from 'src/app/store/states/app.state';
import { Store } from '@ngrx/store';
import { selectUserProfileDataByUid } from 'src/app/store/selectors/selectors.user/user-profile.selectors';

@Injectable({ providedIn: 'root' })
export class FirestoreQueryService {
  // Firebase / AngularFire
  private readonly db = inject(Firestore);
  private readonly ctx = inject(FirestoreContextService);

  // App-layer
  private readonly cacheService = inject(CacheService);
  private readonly read = inject(FirestoreReadService);
  private readonly presenceQuery = inject(UserPresenceQueryService);

  // STATE compat (NgRx) — manter por enquanto, migrar depois
  private readonly store = inject(Store<AppState>);

  /**
   * Retorna a instância do Firestore utilizada pelo AngularFire.
   * Use esta em todo o projeto para construir refs/queries.
   */
  getFirestoreInstance(): Firestore {
    return this.db;
  }

  getDocumentById<T>(collectionName: string, id: string): Observable<T | null> {
    return this.read.getDocument<T>(collectionName, id);
  }

  // ===========================================================================
  // Helpers seguros para construir constraints dentro do Injection Context
  // ===========================================================================

  /**
   * Query once com constraints criadas dentro do FirestoreContextService.
   *
   * Use este helper sempre que este service for responsável por criar:
   * - where(...)
   * - limit(...)
   * - orderBy(...)
   *
   * Isso evita o warning:
   * "Calling Firebase APIs outside of an Injection context..."
   */
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
      this.read.getDocumentsOnce<T>(collectionName, buildConstraints(), options)
    );
  }

  /**
   * Realtime query com constraints criadas dentro do FirestoreContextService.
   */
  private getDocumentsLiveByQuerySafe<T>(
    collectionName: string,
    buildConstraints: () => QueryConstraint[],
    options?: {
      idField?: string;
      requireAuth?: boolean;
    }
  ): Observable<T[]> {
    return this.ctx.deferObservable$(() =>
      this.read.getDocumentsLiveSafe<T>(collectionName, buildConstraints(), options)
    );
  }

  /**
   * Query genérica com cache.
   *
   * IMPORTANTE:
   * - este método permanece por compatibilidade
   * - se o caller já construir QueryConstraint[] fora do contexto, o warning pode continuar
   * - para novos usos, prefira getDocumentsByQuerySafe(...)
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
   * Todos os usuários (cache agressivo)
   */
  getAllUsers(): Observable<IUserDados[]> {
    const cacheKey = 'allUsers';

    return this.cacheService.get<IUserDados[]>(cacheKey).pipe(
      switchMap((cached) => {
        if (cached) return of(cached);

        return this.getDocumentsByQuerySafe<IUserDados>('users', () => [], {
          useCache: true,
          cacheTTL: 300_000,
        }).pipe(
          map((users) => {
            this.cacheService.set(cacheKey, users, 600_000);
            return users;
          }),
          catchError(() => of<IUserDados[]>([]))
        );
      })
    );
  }

  // =========================================================
  // PRESENÇA (fonte única: UserPresenceQueryService)
  // =========================================================

  /**
   * Stream realtime de usuários online (delegação).
   */
  getOnlineUsers$(): Observable<IUserDados[]> {
    return this.presenceQuery.getOnlineUsers$();
  }

  /**
   * Snapshot "once" (use quando você não quer ficar ouvindo).
   */
  getOnlineUsers(): Observable<IUserDados[]> {
    return this.presenceQuery.getOnlineUsersOnce$().pipe(take(1));
  }

  /**
   * Mantém nomenclatura esperada pelo projeto (região = município, hoje).
   * Realtime (onSnapshot por baixo).
   */
  getOnlineUsersByRegion(municipio: string): Observable<IUserDados[]> {
    return this.presenceQuery.getOnlineUsersByRegion$(municipio);
  }

  /**
   * “Recentemente online” (ex.: lastSeen >= now - windowMs)
   */
  getRecentlyOnline$(windowMs = 45_000): Observable<IUserDados[]> {
    return this.presenceQuery.getRecentlyOnline$(windowMs);
  }

  // =========================================================
  // WRAPPERS (COMPAT)
  // =========================================================

  /**
   * Compat: usado por partes antigas e por specs.
   */
  getUsersByMunicipio(municipio: string): Observable<IUserDados[]> {
    return this.getDocumentsByQuerySafe<IUserDados>('users', () => [
      where('municipio', '==', municipio),
    ]).pipe(
      catchError(() => of([] as IUserDados[]))
    );
  }

  /**
   * Compat: versão “municipio”.
   * Hoje, município == region no seu sistema.
   */
  getOnlineUsersByMunicipio(municipio: string): Observable<IUserDados[]> {
    return this.getOnlineUsersByRegion(municipio).pipe(
      catchError(() => of([] as IUserDados[]))
    );
  }

  /**
   * Compat: sugestões (pode evoluir para ranking no futuro).
   * Por ora: delega para listagem simples em public_profiles.
   *
   * Ajuste principal:
   * - limit(...) agora nasce dentro do FirestoreContextService
   */
  getSuggestedProfiles(limitCount = 24): Observable<IUserDados[]> {
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

  // =========================================================
  // Consultas específicas
  // =========================================================

  getProfilesByOrientationAndLocation(
    gender: string,
    orientation: string,
    municipio: string
  ): Observable<IUserDados[]> {
    return this.getDocumentsByQuerySafe<IUserDados>('users', () => [
      where('gender', '==', gender),
      where('orientation', '==', orientation),
      where('municipio', '==', municipio),
    ]).pipe(
      catchError(() => of([] as IUserDados[]))
    );
  }

  /**
   * STATE-only (compat):
   * - este método NÃO consulta Firestore
   * - ele lê do NgRx Store
   * - manter por enquanto para não quebrar callers antigos
   *
   * Futuro ideal:
   * - mover para UserStateQueryService / facade de selectors
   */
  getUserFromState(uid: string): Observable<IUserDados | null> {
    const id = (uid ?? '').toString().trim();
    if (!id) return of(null);

    return this.store.select(selectUserProfileDataByUid(id)).pipe(
      take(1),
      catchError(() => of(null))
    );
  }

  searchUsers(constraints: QueryConstraint[]): Observable<IUserDados[]> {
    /**
     * Compat:
     * - aqui ainda aceitamos QueryConstraint[] pronto vindo de fora
     * - se o caller montar where/limit fora do contexto, o warning pode persistir
     * - para novos fluxos, prefira um método seguro com factory
     */
    return this.getDocumentsByQuery<IUserDados>('users', constraints).pipe(
      catchError(() => of([] as IUserDados[]))
    );
  }
} // Linha 278