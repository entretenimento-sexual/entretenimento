// src/app/store/effects/effects.user/online-users.effects.ts
// =============================================================================
// EFEITOS: ONLINE USERS (produto / discovery)
// -----------------------------------------------------------------------------
// Objetivo desta feature:
// - Controlar QUANDO o app pode:
//   (A) ver usuários online (carregar/listener)
//   (B) exibir usuários online no UI (filtragem “exposição”)
// - Regra atual (MVP): só participa do “online” quem tem perfil mínimo completo.
//   Perfil mínimo = emailVerified (Auth) + profileCompleted (ou campos mínimos preenchidos).
//
// IMPORTANTE (arquitetura da plataforma):
// - PresenceService (infra) é “nível 1” e pode rodar mesmo sem profileCompleted.
// - OnlineUsersEffects é “nível 2 / produto” e só roda quando o usuário está elegível.
// - Para o futuro “modo invisível voluntário” (usuário elegível que quer ficar offline):
//   este arquivo já deixa os pontos de integração prontos (TODOs), mas NÃO ativa a lógica
//   de ocultação voluntária ainda (conforme combinado).
//
// Onde a ocultação voluntária deve ser operacionalizada de verdade:
// - Write: PresenceWriterService / UserPresenceVisibility (escrever offline/hidden)
// - Read: FirestoreQueryService.getOnlineUsers$() (preferível filtrar server-side por flags)
// - UI: um botão/toggle em configurações/perfil/chat-header (a definir).
// =============================================================================

import { inject, Injectable } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';

import { Actions, createEffect, ofType } from '@ngrx/effects';
import { concatLatestFrom } from '@ngrx/operators';
import { Store } from '@ngrx/store';

import { combineLatest, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  finalize,
  filter,
  map,
  shareReplay,
  startWith,
  switchMap,
  take,
  takeUntil,
  tap,
} from 'rxjs/operators';

import { AppState } from '../../states/app.state';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { sanitizeUsersForStore } from 'src/app/store/utils/user-store.serializer';

import { FirestoreQueryService } from 'src/app/core/services/data-handling/firestore-query.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { environment } from 'src/environments/environment';

import {
  selectAuthUid,
  selectAuthReady,
  selectAuthEmailVerified,
} from '../../selectors/selectors.user/auth.selectors';

import {
  loadOnlineUsers,
  loadOnlineUsersSuccess,
  loadOnlineUsersFailure,
  setFilteredOnlineUsers,
  startOnlineUsersListener,
  stopOnlineUsersListener,
  setCurrentUser,
  clearCurrentUser,
  updateUserInState,
} from '../../actions/actions.user/user.actions';

import { selectCurrentUser, selectOnlineUsers } from '../../selectors/selectors.user/user.selectors';

// -----------------------------------------------------------------------------
// Helpers serializáveis (runtimeChecks ON)
// -----------------------------------------------------------------------------

type SerializableError = { message: string; code?: string };

const toSerializableError = (err: unknown, fallbackMsg: string): SerializableError => {
  const anyErr = err as any;
  const message =
    (typeof anyErr?.message === 'string' && anyErr.message) ||
    (typeof anyErr === 'string' && anyErr) ||
    fallbackMsg;

  const code = typeof anyErr?.code === 'string' ? anyErr.code : undefined;
  return code ? { message, code } : { message };
};

const norm = (v?: string | null) => (v ?? '').trim().toLowerCase();

/** Snapshot mínimo do usuário para o gate (evita recomputar por mudanças irrelevantes). */
type CurrentUserGateSnapshot = {
  uid: string | null;
  municipioNorm: string | null;
  profileEligible: boolean;
  // Futuro (não ativo ainda): usuário elegível pode optar por ficar invisível.
  voluntaryInvisible: boolean;
};

@Injectable()
export class OnlineUsersEffects {
  private readonly router = inject(Router);
  private readonly actions$ = inject(Actions);
  private readonly store = inject(Store<AppState>);
  private readonly firestoreQuery = inject(FirestoreQueryService);
  private readonly globalErrorHandler = inject(GlobalErrorHandlerService);

  private readonly debug = !environment.production;

  // ---------------------------------------------------------------------------
  // Router signals
  // ---------------------------------------------------------------------------

  /** URL atual (replay) */
  private readonly currentUrl$ = this.router.events.pipe(
    filter((e): e is NavigationEnd => e instanceof NavigationEnd),
    map((e) => e.urlAfterRedirects || e.url),
    startWith(this.router.url || ''),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /** Router pronto após 1º NavigationEnd */
  private readonly routerReady$ = this.router.events.pipe(
    filter((e): e is NavigationEnd => e instanceof NavigationEnd),
    take(1),
    map(() => true),
    startWith(false),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  // ---------------------------------------------------------------------------
  // Auth signals (NgRx)
  // ---------------------------------------------------------------------------

  private readonly authReady$ = this.store.select(selectAuthReady).pipe(distinctUntilChanged());
  private readonly authUid$ = this.store.select(selectAuthUid).pipe(distinctUntilChanged());
  private readonly emailVerified$ = this.store.select(selectAuthEmailVerified).pipe(distinctUntilChanged());

  // ---------------------------------------------------------------------------
  // CurrentUser (NgRx) - usado para gate de “perfil mínimo”
  // ---------------------------------------------------------------------------

  /**
   * Gate de perfil mínimo:
   * - profileCompleted === true (preferencial, via finalizar-cadastro)
   *   OU (fallback defensivo) gender/estado/municipio preenchidos.
   *
   * Obs: acessa campos via `as any` porque o shape do IUserDados pode variar ao longo do projeto.
   * A regra é “best-effort” e conservadora: se não dá pra provar elegibilidade, bloqueia.
   */
  private readonly currentUserGate$ = this.store.select(selectCurrentUser).pipe(
    map((u): CurrentUserGateSnapshot => this.toCurrentUserGateSnapshot(u)),
    distinctUntilChanged((a, b) =>
      a.uid === b.uid &&
      a.municipioNorm === b.municipioNorm &&
      a.profileEligible === b.profileEligible &&
      a.voluntaryInvisible === b.voluntaryInvisible
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  // ---------------------------------------------------------------------------
  // Gate do produto (route + auth + perfil mínimo)
  // ---------------------------------------------------------------------------

  /**
   * Gate “nível 2 / produto”:
   * - routerReady === true
   * - authReady === true
   * - uid != null
   * - emailVerified === true (Auth)
   * - perfil mínimo elegível (profileCompleted/fields)
   * - fora do fluxo de registro/finalização
   *
   * Futuro (não ativo ainda):
   * - voluntaryInvisible pode bloquear “ser exibido” (write) e/ou “ver online” (read), conforme decisão.
   *   Aqui deixamos pronto, mas NÃO bloqueamos por isso por enquanto.
   */
  private readonly gate$ = combineLatest([
    this.currentUrl$,
    this.routerReady$,
    this.authReady$,
    this.authUid$,
    this.emailVerified$,
    this.currentUserGate$,
  ]).pipe(
    map(([url, routerReady, ready, uid, emailVerified, cu]) => {
      const inReg = this.inRegistrationFlow(url);

      const uidOk = !!uid && !!cu?.uid && cu.uid === uid;
      const profileOk = cu?.profileEligible === true;

      const canStart =
        routerReady === true &&
        ready === true &&
        uidOk === true &&
        emailVerified === true &&
        profileOk === true &&
        !inReg;

      return {
        url,
        routerReady,
        ready,
        uid: uid ?? null,
        emailVerified,
        inReg,
        profileOk,
        currentUserUidOk: uidOk,
        // Futuro: quando você decidir, pode usar `cu.voluntaryInvisible` aqui.
        voluntaryInvisible: cu?.voluntaryInvisible === true,
        canStart,
      };
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  // ---------------------------------------------------------------------------
  // Logs
  // ---------------------------------------------------------------------------

  private dbg(msg: string, extra?: unknown) {
    if (!this.debug) return;
    // eslint-disable-next-line no-console
    console.log(`[OnlineUsersEffects] ${msg}`, extra ?? '');
  }

  /**
   * Consistência com o AuthOrchestrator:
   * - Não rodar listeners de “produto” durante fluxos de registro/verificação/finalização.
   *
   * Ajuste esta regex conforme suas rotas reais.
   * Dica: inclua aqui qualquer rota que “não faz sentido” puxar online-users.
   */
  private inRegistrationFlow(url: string): boolean {
    return /^\/(register(\/|$)|finalizar-cadastro(\/|$)|welcome(\/|$)|__\/auth\/action|post-verification\/action)/.test(
      url || ''
    );
  }

  // =============================================================================
  // 1) Gate -> START/STOP (com cleanup determinístico no STOP)
  // =============================================================================
  syncListenerFromGate$ = createEffect(() =>
    this.gate$.pipe(
      tap((g) => this.dbg('gate → state', g)),

      // dedupe pelo canStart (evita spam)
      map((g) => g.canStart),
      distinctUntilChanged(),

      switchMap((canStart) => {
        if (canStart) {
          this.dbg('gate → START listener');
          return of(startOnlineUsersListener());
        }

        this.dbg('gate → STOP + cleanup');
        return of(
          stopOnlineUsersListener(),
          // limpa estado para não deixar “sombra” de usuários online na UI
          loadOnlineUsersSuccess({ users: [] }),
          setFilteredOnlineUsers({ filteredUsers: [] })
        );
      })
    )
  );

  // =============================================================================
  // 2) Listener realtime (fonte única)
  // =============================================================================
  onlineUsersListener$ = createEffect(() =>
    this.actions$.pipe(
      ofType(startOnlineUsersListener),

      // revalida gate no momento do START (protege corrida)
      concatLatestFrom(() => this.gate$),

      switchMap(([, gate]) => {
        if (!gate?.canStart) {
          this.dbg('realtime START ignorado (gate=false)', gate);
          return of(
            loadOnlineUsersSuccess({ users: [] }),
            setFilteredOnlineUsers({ filteredUsers: [] }),
            stopOnlineUsersListener()
          );
        }

        this.dbg('realtime listener START', { uid: gate.uid });

        return this.firestoreQuery.getOnlineUsers$().pipe(
          /**
           * Exposição (ser exibido):
           * - Mesmo que Presence infra marque alguém como online, o produto só EXIBE quem
           *   passa no critério mínimo (emailVerified + profileCompleted/fields).
           *
           * Isso evita que usuários “incompletos” apareçam no online.
           * (Ideal futuro: filtrar server-side pra reduzir tráfego.)
           */
          map((users) => this.filterUsersEligibleForExposure(users, gate.uid)),

          // sanitiza pra guardar no Store (runtimeChecks)
          map((users) => sanitizeUsersForStore(users)),

          tap((users) => {
            if (!this.debug) return;
            this.dbg('realtime onlineUsers size (post-filter)', users.length);
          }),

          map((users) => loadOnlineUsersSuccess({ users })),

          takeUntil(
            this.actions$.pipe(
              ofType(stopOnlineUsersListener),
              tap(() => this.dbg('realtime listener STOP (takeUntil)'))
            )
          ),

          finalize(() => this.dbg('realtime listener FINALIZE (unsub)')),

          catchError((err) => {
            this.globalErrorHandler.handleError(
              err instanceof Error
                ? err
                : new Error(toSerializableError(err, 'Falha ao ouvir usuários online.').message)
            );

            return of(
              loadOnlineUsersFailure({ error: toSerializableError(err, 'Falha ao ouvir usuários online.') }),
              stopOnlineUsersListener()
            );
          })
        );
      })
    )
  );

  // =============================================================================
  // 3) One-shot (snapshot único)
  // =============================================================================
  loadOnlineUsersOnce$ = createEffect(() =>
    this.actions$.pipe(
      ofType(loadOnlineUsers),
      concatLatestFrom(() => this.gate$),

      switchMap(([, gate]) => {
        if (!gate?.canStart) {
          this.dbg('once ignorado (gate=false)', gate);
          return of(loadOnlineUsersSuccess({ users: [] }));
        }

        this.dbg('once START', { uid: gate.uid });

        return this.firestoreQuery.getOnlineUsers().pipe(
          map((users) => this.filterUsersEligibleForExposure(users, gate.uid)),
          map((users) => sanitizeUsersForStore(users)),
          map((users) => loadOnlineUsersSuccess({ users })),

          catchError((err) => {
            this.globalErrorHandler.handleError(
              err instanceof Error
                ? err
                : new Error(toSerializableError(err, 'Falha ao carregar usuários online.').message)
            );
            return of(loadOnlineUsersFailure({ error: toSerializableError(err, 'Falha ao carregar usuários online.') }));
          })
        );
      })
    )
  );

  // =============================================================================
  // 4) Filtro por município (somente UI)
  // =============================================================================
  recomputeFilteredOnlineUsers$ = createEffect(() =>
    this.actions$.pipe(
      ofType(loadOnlineUsersSuccess, setCurrentUser, clearCurrentUser, updateUserInState),

      concatLatestFrom(() => [
        this.store.select(selectOnlineUsers),
        this.store.select(selectCurrentUser),
      ]),

      map(([, onlineUsers, currentUser]) => {
        const municipio = norm((currentUser as any)?.municipio);
        if (!municipio) return setFilteredOnlineUsers({ filteredUsers: [] });

        const list: IUserDados[] = Array.isArray(onlineUsers) ? (onlineUsers as IUserDados[]) : [];
        const filteredUsers = list.filter((u: IUserDados) => norm((u as any)?.municipio) === municipio);

        return setFilteredOnlineUsers({ filteredUsers });
      }),

      catchError((err) => {
        this.globalErrorHandler.handleError(
          err instanceof Error ? err : new Error('Falha ao filtrar usuários online por município.')
        );
        return of(setFilteredOnlineUsers({ filteredUsers: [] }));
      })
    )
  );

  // =============================================================================
  // Helpers internos (regras do produto)
  // =============================================================================

  /**
   * Converte o CurrentUser do store num snapshot mínimo para gates.
   * - Conservador: se faltar dado, não habilita “online-users”.
   */
  private toCurrentUserGateSnapshot(u: IUserDados | null | undefined): CurrentUserGateSnapshot {
    const anyU = (u ?? null) as any;

    const uid: string | null = typeof anyU?.uid === 'string' ? anyU.uid : null;

    // Preferencial: flag do fluxo de finalizar cadastro
    const profileCompleted = anyU?.profileCompleted === true;

    // Fallback: campos mínimos (gênero + estado + município)
    const hasMinFields =
      typeof anyU?.gender === 'string' && anyU.gender.trim() !== '' &&
      typeof anyU?.estado === 'string' && anyU.estado.trim() !== '' &&
      typeof anyU?.municipio === 'string' && anyU.municipio.trim() !== '';

    const profileEligible = profileCompleted === true || hasMinFields === true;

    // Futuro (não ativo ainda): campo de preferência para invisível voluntário.
    // Mantenha aqui um único “resolver” para não espalhar checks pelo app.
    const voluntaryInvisible = this.isVoluntaryInvisible(anyU);

    const municipioNorm = typeof anyU?.municipio === 'string' ? norm(anyU.municipio) : null;

    return { uid, municipioNorm, profileEligible, voluntaryInvisible };
  }

  /**
   * Regra “ser exibido” no produto:
   * - Remove o próprio usuário
   * - Só exibe perfis elegíveis (emailVerified + profile mínimo)
   *
   * Observação:
   * - Este filtro é client-side (defensivo). O ideal futuro é o FirestoreQueryService
   *   já consultar somente quem é elegível (server-side), reduzindo banda/CPU.
   */
  private filterUsersEligibleForExposure(users: IUserDados[] | null | undefined, currentUid: string | null) {
    const list: IUserDados[] = Array.isArray(users) ? users : [];

    return list.filter((u) => {
      const anyU = u as any;

      const uid = typeof anyU?.uid === 'string' ? anyU.uid : '';
      if (!uid) return false;

      // remove self
      if (currentUid && uid === currentUid) return false;

      // exige emailVerified no documento do usuário (produto)
      const emailVerified = anyU?.emailVerified === true;
      if (!emailVerified) return false;

      // exige perfil mínimo (preferencial: profileCompleted)
      const profileCompleted = anyU?.profileCompleted === true;
      const hasMinFields =
        typeof anyU?.gender === 'string' && anyU.gender.trim() !== '' &&
        typeof anyU?.estado === 'string' && anyU.estado.trim() !== '' &&
        typeof anyU?.municipio === 'string' && anyU.municipio.trim() !== '';

      const eligible = profileCompleted || hasMinFields;
      if (!eligible) return false;

      // Futuro (não ativo ainda): se o usuário optar por “invisível”, não exibir.
      // ATENÇÃO: só terá efeito real quando você definir o campo e começar a persistir.
      if (this.isVoluntaryInvisible(anyU)) return false;

      return true;
    });
  }

  /**
   * FUTURO: invisibilidade voluntária (usuário elegível escolhe não aparecer).
   * --------------------------------------------------------------------------
   * Neste momento, você ainda não definiu:
   * - onde ficará o toggle
   * - como persistir (users/{uid}.privacy?.showOnline, presenceVisibility, etc)
   *
   * Então aqui deixamos um “resolver” único com checks opcionais.
   * Quando você decidir o campo oficial, atualize SOMENTE este método.
   *
   * Sugestões de campo (escolha 1 e padronize no projeto):
   * - users/{uid}.privacy.showOnline: boolean
   * - users/{uid}.visibility.online: 'online' | 'hidden'
   * - users/{uid}.presenceOptOut: boolean
   */
  private isVoluntaryInvisible(anyUser: any): boolean {
    // Exemplos (TODOS opcionais):
    // if (anyUser?.privacy?.showOnline === false) return true;
    // if (anyUser?.visibility?.online === 'hidden') return true;
    // if (anyUser?.presenceOptOut === true) return true;

    // Por enquanto, default = false (lógica ainda não operacionalizada)
    return false;
  }
} // Linha 508 - fim do OnlineUsersEffects

/**
 * =============================================================================
 * ORIENTAÇÕES (curtas) - relação com o restante da plataforma
 * -----------------------------------------------------------------------------
 * 1) Presence (infra) vs OnlineUsers (produto)
 *    - PresenceService pode continuar rodando (telemetria / lastSeen / away).
 *    - OnlineUsersEffects só roda quando o usuário é “exponível” (perfil mínimo).
 *
 * 2) Regra de produto (MVP) para ver/exibir online
 *    - Ver online (listener) => gate.canStart exige profileEligible + emailVerified + fora do registro.
 *    - Exibir online (UI)     => filtro defensivo remove perfis incompletos/inválidos.
 *
 * 3) Futuro: invisibilidade voluntária
 *    - Defina UM campo oficial no users/{uid}.
 *    - Atualize este effect (isVoluntaryInvisible) e o FirestoreQueryService (query server-side).
 *    - Para “ser exibido” de verdade, o PresenceWriter deve respeitar a preferência
 *      (ex.: escrever offline/hidden, ou flag usada na query).
 *
 * 4) Firestore/Index/Rules (quando evoluir):
 *    - Ideal: consulta server-side filtrando por:
 *      emailVerified == true AND profileCompleted == true AND (privacy.showOnline != false)
 *    - Ajuste rules para impedir leitura de “online list” a usuários não elegíveis.
 * =============================================================================
 */
