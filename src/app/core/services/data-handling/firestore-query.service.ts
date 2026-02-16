// src/app/core/services/data-handling/firestore-query.service.ts
// Fonte única do Firestore (AngularFire).
// Objetivo:
// - Evitar mistura de imports (firebase/firestore vs @angular/fire/firestore)
// - Parar de usar `as any` em doc(), collection(), query(), updateDoc(), etc.
// - Manter API pública simples (getFirestoreInstance)
import { inject, Injectable } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { QueryConstraint, where } from 'firebase/firestore';
import { Observable, of } from 'rxjs';
import { catchError, map, switchMap, take } from 'rxjs/operators';

import { IUserDados } from '../../interfaces/iuser-dados';
import { CacheService } from '../general/cache/cache.service';
import { FirestoreReadService } from './firestore/core/firestore-read.service';
import { UserPresenceQueryService } from './queries/user-presence.query.service';
import { AppState } from 'src/app/store/states/app.state';
import { Store } from '@ngrx/store';
import { selectUserProfileDataByUid } from 'src/app/store/selectors/selectors.user/user-profile.selectors';

@Injectable({ providedIn: 'root' })
export class FirestoreQueryService {
  // ✅ Injection via field initializer (Angular 16+ / 19 ok)
  private readonly db = inject(Firestore);
  // Dependências de “app layer” (cache, query state, reads, presence)
  private readonly cacheService = inject(CacheService);
  private readonly read = inject(FirestoreReadService);
  private readonly presenceQuery = inject(UserPresenceQueryService);
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

  /**
   * Query genérica com cache (padrão “plataforma grande”: reduz leituras repetidas).
   */
  getDocumentsByQuery<T>(collectionName: string, constraints: QueryConstraint[]): Observable<T[]> {
    return this.read.getDocumentsOnce<T>(collectionName, constraints, {
      useCache: true,
      cacheTTL: 300_000,
    });
  }

  /**
   * Todos os usuários (cache agressivo)
   */
  getAllUsers(): Observable<IUserDados[]> {
    const cacheKey = 'allUsers';

    return this.cacheService.get<IUserDados[]>(cacheKey).pipe(
      switchMap((cached) => {
        if (cached) return of(cached);

        return this.getDocumentsByQuery<IUserDados>('users', []).pipe(
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
  // WRAPPERS (COMPAT) — mantêm nomenclaturas antigas
  // =========================================================

  /**
   * Compat: usado por partes antigas e pelo spec.
   */
  getUsersByMunicipio(municipio: string): Observable<IUserDados[]> {
    return this.getDocumentsByQuery<IUserDados>('users', [where('municipio', '==', municipio)]).pipe(
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
   * Por ora: delega para listagem simples.
   */
  getSuggestedProfiles(): Observable<IUserDados[]> {
    return this.getDocumentsByQuery<IUserDados>('users', []).pipe(
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
    return this.getDocumentsByQuery<IUserDados>('users', [
      where('gender', '==', gender),
      where('orientation', '==', orientation),
      where('municipio', '==', municipio),
    ]).pipe(catchError(() => of([] as IUserDados[])));
  }

  /**
   * Nome histórico, mas útil: pega do “state layer” de userQuery
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
    return this.getDocumentsByQuery<IUserDados>('users', constraints).pipe(
      catchError(() => of([] as IUserDados[]))
    );
  }
}/*Linha 157
tudo no projeto deve rodar redondo em dev, staging, prod e emu.
 AuthSession manda no UID
/*CurrentUserStore manda no IUserDados
qualquer UID fora disso vira derivado / compat
//logout() do auth.service.ts que está sendo descontinuado
// ainda está sendo usado em alguns lugares e precisa ser migrado.
Ferramentas de debug ajudam bastante
É assim que funcionam as grandes plataformas?
Compatibilizar o estado online do usuário com o presence.service e aproximar do funcionamento ideal
deixar explícito que é Firebase/AngularFire e o que é NgRx, evitando misturar responsabilidades
*/

/*
Separação “Firebase/AngularFire vs NgRx” (responsabilidade)
FirestoreQueryService

Ele ainda injeta Store e expõe getUserFromState(). Isso mistura camadas (query firebase vs query de state). Em plataformas grandes, normalmente seria:
FirestoreQueryService / UserPresenceQueryService: somente Firebase
UserStateQueryService (ou “selectors facade”): somente NgRx
componentes: consomem selectors/facades
Se você quiser manter compat por enquanto, deixe o método, mas marque explicitamente como STATE-only (e planeje mover).
*/
