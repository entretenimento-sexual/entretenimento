// src/app/core/services/data-handling/queries/user-discovery.query.service.ts
// Serviço de consulta para descoberta de usuários no Firestore
// Não esqueça os comentários
import { Injectable, DestroyRef, inject } from '@angular/core';
import { defer, from, Observable, of } from 'rxjs';
import { catchError, switchMap, map, distinctUntilChanged, shareReplay, take, filter } from 'rxjs/operators';
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
 * Arquitetura de "plataforma grande":
 * - Discovery NÃO lê de `users` (dados privados).
 * - Discovery lê de um "perfil público consultável": `public_profiles/{uid}`.
 * - `public_index` fica restrito a índices técnicos (ex.: nickname único),
 *   NÃO é fonte de discovery.
 * =============================================================================
 */
@Injectable({ providedIn: 'root' })
export class UserDiscoveryQueryService {
  private readonly destroyRef = inject(DestroyRef);

  /**
   * Fonte oficial do discovery:
   * - perfil público consultável por filtros
   */
  private readonly DISCOVERY_COL = 'public_profiles';

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
  // Helpers de compatibilidade (IUserDados)
  // --------------------------------------------------------------------------

  /**
   * Normaliza o doc do public_profiles para o formato compatível com IUserDados.
   * - Discovery não é presence: aqui não definimos status online como verdade.
   * - isOnline/lastSeen ficam como fallback (depois a Facade combina com presence).
   */
  private toUserDadosFromPublicProfile(raw: any): IUserDados {
    const uid = (raw?.uid ?? '').toString().trim();

    return {
      uid,

      nickname: raw?.nickname ?? null,
      photoURL: raw?.photoURL ?? raw?.avatarUrl ?? null,

      role: raw?.role ?? 'basic',
      gender: raw?.gender ?? null,
      age: raw?.age ?? null,
      orientation: raw?.orientation ?? null,
      municipio: raw?.municipio ?? null,
      estado: raw?.estado ?? null,

      // Discovery não assume presença
      isOnline: false,
      lastSeen: null,
      lastOnlineAt: null,
      lastOfflineAt: null,

      latitude: raw?.latitude ?? null,
      longitude: raw?.longitude ?? null,
      geohash: raw?.geohash ?? null,
    } as unknown as IUserDados;
  }

  // --------------------------------------------------------------------------
  // Guards internos
  // --------------------------------------------------------------------------

  private onceGuardedQuery(
    constraints: QueryConstraint[],
    opts?: { waitForAuth?: boolean; cacheTTL?: number }
  ): Observable<IUserDados[]> {
    const safeConstraints = constraints ?? [];
    const waitForAuth = !!opts?.waitForAuth;
    const cacheTTL = opts?.cacheTTL ?? 60_000;

    /**
     * Dois modos:
     * - waitForAuth=false: “once agora” (se uid ainda null => [])
     * - waitForAuth=true: “once quando logar” (espera uid virar string)
     */
    const uidOnce$ = waitForAuth
      ? this.uid$.pipe(
        filter((uid): uid is string => !!uid),
        take(1)
      )
      : defer(() => from(this.authSession.whenReady())).pipe(
        take(1),
        switchMap(() => this.uid$.pipe(take(1)))
      );

    return uidOnce$.pipe(
      switchMap((uid) => {
        if (!uid) return of([] as IUserDados[]);

        // Discovery: busca em "public_profiles" e normaliza para IUserDados
        return this.read
          .getDocumentsOnce<any>(
            this.DISCOVERY_COL,
            safeConstraints,
            {
              useCache: true,
              cacheTTL,
              mapIdField: 'uid',
              requireAuth: true,
            }
          )
          .pipe(
            map((docs) => (docs ?? []).map((d) => this.toUserDadosFromPublicProfile(d))),
            catchError((err) =>
              this.firestoreError.handleFirestoreErrorAndReturn<IUserDados[]>(
                err,
                [],
                { silent: true, context: 'user-discovery.onceGuardedQuery' }
              )
            )
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
    const cacheKey = 'discovery:public_profiles:all';

    return this.uid$.pipe(
      take(1),
      switchMap((uid) => {
        if (!uid) return of([] as IUserDados[]);

        return this.cache.get<IUserDados[]>(cacheKey).pipe(
          switchMap((cached) => {
            if (cached?.length) return of(cached);

            return this.read
              .getDocumentsOnce<any>(this.DISCOVERY_COL, [], {
                useCache: true,
                cacheTTL: 300_000,
                mapIdField: 'uid',
              })
              .pipe(
                map((docs) => (docs ?? []).map((d) => this.toUserDadosFromPublicProfile(d))),
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
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }
} // 222 linhas
