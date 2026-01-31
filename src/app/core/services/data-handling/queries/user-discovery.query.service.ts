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
/*
PS C: \entretenimento\src\app\core > tree / f
Listagem de caminhos de pasta para o volume Windows
O número de série do volume é 1C9B - 11ED
C:.
├───enums
│       valid - genders.enum.ts
│       valid - preferences.enum.ts
│
├───firebase
│       firebase.tokens.ts
│
├───guards
│       admin.guard.ts
│       auth - only.guard.ts
│       auth - redirect.guard.spec.ts
│       auth - redirect.guard.ts
│       auth.guard.ts
│       basic.guard.ts
│       email - verified.guard.ts
│       guest - only.guard.ts
│       premium.guard.ts
│       user.owner.guard.ts
│       vip.guard.ts
│
├───interfaces
│   │   geolocation.interface.ts
│   │   icategoria - mapeamento.ts
│   │   ierror.ts
│   │   iuser - dados.ts
│   │   iuser - registration - data.ts
│   │   user - public.interface.ts
│   │
│   ├───friendship
│   │       blocked - user.interface.ts
│   │       friend - request.interface.ts
│   │       friend.interface.ts
│   │
│   ├───interfaces - chat
│   │       chat.interface.ts
│   │       community.interface.ts
│   │       invite.interface.ts
│   │       message.interface.ts
│   │       room.interface.ts
│   │
│   ├───interfaces - user - dados
│   │       iuser - preferences.ts
│   │       iuser - social - links.ts
│   │
│   └───logs
│           iadming - log.ts
│
├───services
│   │   sidebar.service.ts
│   │
│   ├───account - moderation
│   │       admin - log.service.ts
│   │       user - management.service.ts
│   │       user - moderation.service.ts
│   │
│   ├───autentication
│   │   │   auth.service.ts
│   │   │   email - input - modal.service.ts
│   │   │   login.service.spec.ts
│   │   │   login.service.ts
│   │   │   social - auth.service.spec.ts
│   │   │   social - auth.service.ts
│   │   │
│   │   ├───auth
│   │   │       access - control.service.ts
│   │   │       auth - orchestrator.service.ts
│   │   │       auth -return -url.service.ts
│   │   │       auth - session.service.ts
│   │   │       auth.facade.ts
│   │   │       auth.types.ts
│   │   │       current - user - store.service.ts
│   │   │       logout.service.ts
│   │   │
│   │   └───register
│   │           email - verification.service.md
│   │           email - verification.service.ts
│   │           pre - register.service.ts
│   │           register.service.spec.ts
│   │           register.service.ts
│   │           registerServiceREADME.md
│   │
│   ├───batepapo
│   │   │   chat - notification.service.ts
│   │   │
│   │   ├───chat - service
│   │   │       chat.service.ts
│   │   │
│   │   ├───community - services
│   │   │       community - members.service.spec.ts
│   │   │       community - members.service.ts
│   │   │       community - moderation.service.spec.ts
│   │   │       community - moderation.service.ts
│   │   │       community.service.spec.ts
│   │   │       community.service.ts
│   │   │
│   │   ├───invite - service
│   │   │       invite - search.service.ts
│   │   │       invite.service.ts
│   │   │
│   │   └───room - services
│   │           room - management.service.ts
│   │           room - messages.service.ts
│   │           room - participants.service.ts
│   │           room - reports.service.ts
│   │           room.service.spec.ts
│   │           room.service.ts
│   │           user - room - ids.service.ts
│   │
│   ├───data - handling
│   │   │   firestore - query.service.spec.ts
│   │   │   firestore - query.service.ts
│   │   │   firestore - user - query.service.spec.ts
│   │   │   firestore - user - query.service.ts
│   │   │   firestore - user - write.service.ts
│   │   │
│   │   ├───converters
│   │   │       friend - request.firestore - converter.ts
│   │   │       user.firestore - converter.ts
│   │   │
│   │   ├───firestore
│   │   │   ├───core
│   │   │   │       firestore - context.service.ts
│   │   │   │       firestore - live - query.service.ts
│   │   │   │       firestore - read.service.ts
│   │   │   │       firestore - write.service.ts
│   │   │   │
│   │   │   ├───repositories
│   │   │   │       public - index.repository.ts
│   │   │   │       public - profiles.repository.ts
│   │   │   │       user - repository.service.ts
│   │   │   │       users - read.repository.ts
│   │   │   │
│   │   │   ├───state
│   │   │   │       user - state - cache.service.ts
│   │   │   │
│   │   │   └───validation
│   │   │           firestore - validation.service.ts
│   │   │
│   │   ├───legacy
│   │   │       firestore.service.spec.ts
│   │   │       firestore.service.ts
│   │   │
│   │   ├───queries
│   │   │       query - uid.service.spec.ts
│   │   │       query - uid.service.ts
│   │   │       user - discovery - presence.facade.ts
│   │   │       user - discovery.query.service.ts
│   │   │       user - presence.query.service.ts
│   │   │
│   │   └───suggestion
│   ├───error - handler
│   │       error - notification.service.spec.ts
│   │       error - notification.service.ts
│   │       firestore - error - handler.service.ts
│   │       global - error - handler.service.ts
│   │
│   ├───filtering
│   │   │   filter - engine.service.spec.ts
│   │   │   filter - engine.service.ts
│   │   │
│   │   ├───filter - interfaces
│   │   │       filter.interface.ts
│   │   │
│   │   └───filters
│   │           activity - filter.service.spec.ts
│   │           activity - filter.service.ts
│   │           gender - filter.service.spec.ts
│   │           gender - filter.service.ts
│   │           near - profile - filter.service.spec.ts
│   │           near - profile - filter.service.ts
│   │           photo - filter.service.spec.ts
│   │           photo - filter.service.ts
│   │           preferences - filter.service.spec.ts
│   │           preferences - filter.service.ts
│   │           region - filter.service.spec.ts
│   │           region - filter.service.ts
│   │
│   ├───general
│   │   │   date - time.service.ts
│   │   │   notification.service.ts
│   │   │   validator.service.ts
│   │   │
│   │   ├───api
│   │   │       ibge - location.service.spec.ts
│   │   │       ibge - location.service.ts
│   │   │
│   │   └───cache
│   │       │   cache - persistence.service.spec.ts
│   │       │   cache - persistence.service.ts
│   │       │   cache - state.service.spec.ts
│   │       │   cache - state.service.ts
│   │       │   cache - sync.service.spec.ts
│   │       │   cache - sync.service.ts
│   │       │   cache.service.spec.ts
│   │       │   cache.service.ts
│   │       │
│   │       └───cache + store
│   │               data - sync.service.ts
│   │
│   ├───geolocation
│   │       distance - calculation.service.spec.ts
│   │       distance - calculation.service.ts
│   │       geolocation - tracking.service.ts
│   │       geolocation.md
│   │       geolocation.service.spec.ts
│   │       geolocation.service.ts
│   │       location - persistence.service.ts
│   │       near - profile.service.spec.ts
│   │       near - profile.service.ts
│   │
│   ├───image - handling
│   │       photo - firestore.service.spec.ts
│   │       photo - firestore.service.ts
│   │       photo.service.spec.ts
│   │       photo.service.ts
│   │       storage.service.spec.ts
│   │       storage.service.ts
│   │
│   ├───interactions
│   │   └───friendship
│   │       │   friendship.repo.ts
│   │       │   friendship.service.ts
│   │       │
│   │       └───repo
│   │               base.repo.ts
│   │               blocks.repo.ts
│   │               cooldown.repo.ts
│   │               facade.repo.ts
│   │               friends.repo.ts
│   │               requests.repo.spec.ts
│   │               requests.repo.ts
│   │
│   ├───preferences
│   │       user - preferences.service.spec.ts
│   │       user - preferences.service.ts
│   │
│   ├───presence
│   │       presence - dom - streams.service.ts
│   │       presence - leader - election.service.ts
│   │       presence - orchestrator.service.ts
│   │       presence - writer.service.ts
│   │       presence.service.spec.ts
│   │       presence.service.ts
│   │
│   ├───security
│   │       file - scan.service.spec.ts
│   │       file - scan.service.ts
│   │
│   ├───subscriptions
│   │       payment.service.ts
│   │       subscription.service.spec.ts
│   │       subscription.service.ts
│   │       webhook.service.ts
│   │
│   ├───user - profile
│   │   │   user - profile.service.ts
│   │   │   user - social - links.service.ts
│   │   │   usuario.service.ts
│   │   │
│   │   └───recommendations
│   │           suggestion.service.ts
│   │
│   └───util - service
│           auth - debug.service.ts
│           TokenService.ts
│
├───textos - globais
│   └───info - cria - sala - bp
│           info - cria - sala - bp.component.css
│           info - cria - sala - bp.component.html
│           info - cria - sala - bp.component.ts
│
└───utils
nickname - utils.ts
 */
