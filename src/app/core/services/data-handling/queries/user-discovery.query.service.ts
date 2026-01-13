// src/app/core/services/data-handling/queries/user-discovery.query.service.ts
// Não esqueça os comentários

import { Injectable, DestroyRef, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, switchMap, map, distinctUntilChanged, shareReplay, take } from 'rxjs/operators';
import { QueryConstraint, where } from 'firebase/firestore';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { IUserDados } from '@core/interfaces/iuser-dados';
import { CacheService } from '@core/services/general/cache/cache.service';
import { FirestoreReadService } from '../firestore/core/firestore-read.service';
import { FirestoreErrorHandlerService } from '@core/services/error-handler/firestore-error-handler.service';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';

/**
 * =============================================================================
 * USER DISCOVERY QUERY (Read / filtros de busca)
 * - Queries one-shot para discovery/search (não é presence).
 * - Pode usar CacheService para evitar leituras repetidas.
 * - NÃO conhece Router, Presence, NgRx.
 * - UID vem do AuthSession (fonte da verdade): não inventa sessão.
 * - NÃO abre leitura sem sessão (evita rules/400 em boot deslogado).
 * - Erros: FirestoreErrorHandlerService (caminho central de observabilidade).
 *
 * Nota de arquitetura (plataforma grande):
 * - O ideal é discovery ler de um índice público (ex.: public_index) com campos “exponíveis”.
 * - A coleção `users` costuma ter campos privados; migrar para índice público reduz risco em rules.
 * =============================================================================
 */
@Injectable({ providedIn: 'root' })
export class UserDiscoveryQueryService {
  private readonly destroyRef = inject(DestroyRef);

  /**
   * ⚠️ Por enquanto mantido como 'users' (compat com seu app).
   * Recomendação: migrar discovery para 'public_index' quando estabilizar o modelo público.
   */
  private readonly DISCOVERY_COL = 'users';

  /**
   * UID (sessão) – guard de segurança/robustez:
   * - se uid=null: retornamos [] e não fazemos read
   */
  private readonly uid$ = this.authSession.uid$.pipe(
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  constructor(
    private readonly read: FirestoreReadService,
    private readonly cache: CacheService,
    private readonly firestoreError: FirestoreErrorHandlerService,
    private readonly authSession: AuthSessionService
  ) {
    /**
     * Higiene:
     * - ao deslogar, você pode optar por limpar caches de discovery
     *   (evita “vazar” resultado de usuário anterior em singleton root).
     */
    this.uid$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((uid) => {
        if (!uid) {
          // se seu CacheService tiver namespace/clearByPrefix, aqui seria o lugar.
          // this.cache.clearByPrefix?.('discovery:');
        }
      });
  }

  // --------------------------------------------------------------------------
  // Guards internos
  // --------------------------------------------------------------------------

  /**
   * Guard one-shot:
   * - uid=null => []
   * - uid=string => executa getDocumentsOnce
   */
  private onceGuardedQuery(constraints: QueryConstraint[], opts?: { cacheTTL?: number }): Observable<IUserDados[]> {
    const safeConstraints = constraints ?? [];

    return this.uid$.pipe(
      take(1),
      switchMap((uid) => {
        if (!uid) return of([] as IUserDados[]);

        return this.read
          .getDocumentsOnce<IUserDados>(this.DISCOVERY_COL, safeConstraints, {
            useCache: true,
            cacheTTL: opts?.cacheTTL ?? 60_000,
            mapIdField: 'uid',
          })
          .pipe(
            catchError((err) => {
              // handler central deve registrar e devolver um fallback seguro
              this.firestoreError.handleFirestoreError(err);
              return of([] as IUserDados[]);
            })
          );
      })
    );
  }

  // --------------------------------------------------------------------------
  // API pública (mantém nomenclaturas originais)
  // --------------------------------------------------------------------------

  /**
   * One-shot genérico: discovery/search por constraints
   * - Não pagina ainda (pode evoluir com limit/orderBy/startsWith)
   * - Focado em reuso por outros serviços/facades
   */
  searchUsers(constraints: QueryConstraint[]): Observable<IUserDados[]> {
    return this.onceGuardedQuery(constraints ?? [], { cacheTTL: 60_000 });
  }

  /**
   * Caso clássico de discovery: filtros “fixos”
   * Observação:
   * - se seus campos forem normalizados (lowercase/trim) no Firestore, normalize aqui também
   */
  getProfilesByOrientationAndLocation(
    gender: string,
    orientation: string,
    municipio: string
  ): Observable<IUserDados[]> {
    const g = (gender ?? '').trim();
    const o = (orientation ?? '').trim();
    const m = (municipio ?? '').trim();
    if (!g || !o || !m) return of([] as IUserDados[]);

    return this.searchUsers([
      where('gender', '==', g),
      where('orientation', '==', o),
      where('municipio', '==', m),
    ]);
  }

  /**
   * Lista geral (com cache) — útil pra painéis/admin/dev
   * ⚠️ Em produção, normalmente isso fica restrito por role/rules (admin),
   * e quase sempre precisa paginação.
   */
  getAllUsers$(): Observable<IUserDados[]> {
    const cacheKey = 'discovery:users:all';

    return this.uid$.pipe(
      take(1),
      switchMap((uid) => {
        if (!uid) return of([] as IUserDados[]);

        return this.cache.get<IUserDados[]>(cacheKey).pipe(
          switchMap((cached) => {
            if (cached?.length) return of(cached);

            return this.read
              .getDocumentsOnce<IUserDados>(this.DISCOVERY_COL, [], {
                useCache: true,
                cacheTTL: 300_000,
                mapIdField: 'uid',
              })
              .pipe(
                map((users) => {
                  // CacheService é um cache “da app”; FirestoreReadService cache é mais “técnico”.
                  // Aqui você define o TTL “funcional” para UX/painel.
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
      }),
      // shareReplay evita que múltiplos subscribers disparem o fluxo de cache/read repetidamente
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }
}//182 linhas

// ***** Sempre considerar que existe no projeto o user-presence.query.service.ts *****
// ***** Sempre considerar que existe no projeto o user-discovery.query.service.ts
// ***** Sempre considerar que existe o presence\presence-dom-streams.service.ts *****
// ***** Sempre considerar que existe o data-handling/firestore-user-write.service.ts *****
// ***** Sempre considerar que existe o data-handling/firestore-user-query.service.ts *****
// ***** Sempre considerar que existe o data-handling/queries/user-discovery.query.service.ts *****
// ***** Sempre considerar que existe o data-handling/queries/user-presence.query.service.ts *****
// ***** Sempre considerar que existe o autentication/auth/current-user-store.service.ts *****
