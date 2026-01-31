// src/app/core/services/autentication/auth/auth-orchestrator.service.ts
// Não esqueça os comentários explicativos.
// =============================================================================
// AUTH ORCHESTRATOR (Efeitos colaterais e ciclo de vida)
//
// Objetivo principal deste service:
// - Orquestrar “o que roda quando a sessão existe” (presence, watchers, keepAlive).
// - Garantir que listeners NÃO iniciem no registro e NÃO iniciem para emailVerified=false.
// - Centralizar encerramento de sessão *quando inevitável* (auth inválido).
//
// Regra de plataforma (conforme sua decisão):
// ✅ O usuário só deve perder a sessão (signOut) por LOGOUT voluntário,
//    EXCETO quando a própria sessão do Firebase Auth for tecnicamente inválida.
// - Em problemas de Firestore (doc missing / permission-denied / status) nós NÃO deslogamos.
//   Em vez disso: "bloqueamos" a sessão do app e redirecionamos para /register/welcome.
//
// Observação de arquitetura (fonte única):
// - AuthSessionService: verdade do Firebase Auth
// - CurrentUserStoreService: verdade do usuário do app (perfil/role/etc.)
// - AuthAppBlockService: verdade do "bloqueio do app" (sem logout)
// - AuthOrchestratorService: só side-effects e coordenação (não deve virar “store”)
// =============================================================================

import { Injectable, Injector, runInInjectionContext } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';

import { combineLatest, firstValueFrom, from, Observable, of, Subscription, timer } from 'rxjs';
import {
  catchError,
  defaultIfEmpty,
  distinctUntilChanged,
  exhaustMap,
  filter,
  finalize,
  map,
  scan,
  startWith,
  switchMap,
  take,
} from 'rxjs/operators';

import { doc, docSnapshots, Firestore } from '@angular/fire/firestore';

import { AuthSessionService } from './auth-session.service';
import { FirestoreUserQueryService } from '@core/services/data-handling/firestore-user-query.service';
import { CurrentUserStoreService } from './current-user-store.service';
import { AuthAppBlockService } from './auth-app-block.service';

import { PresenceService } from '../../presence/presence.service';

// ✅ central error routing
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';

import { environment } from 'src/environments/environment';
import { LogoutService } from './logout.service';

// ✅ tipos e helpers compartilhados
import { inRegistrationFlow as isRegFlow, type TerminateReason } from './auth.types';

@Injectable({ providedIn: 'root' })
export class AuthOrchestratorService {
  // ✅ keepAlive RxJS (substitui setInterval)
  private keepAliveSub: Subscription | null = null;

  // Watchers de Firestore (doc principal + “deleted flag”)
  private docSub: Subscription | null = null;
  private deletedSub: Subscription | null = null;

  // ✅ controle idempotente de watchers (evita reiniciar em toda navegação)
  private watchersUid: string | null = null;
  private watchersOn = false;

  // ✅ UID atual da sessão do ciclo (para resetar só quando o user muda)
  private sessionUid: string | null = null;

  // Evita reentrância (ex.: múltiplos gatilhos simultâneos)
  private terminating = false;

  // Grace time para não agir cedo demais no boot / pós-login
  private freshUntil = 0;
  private sawUserDocOnce = false;

  // Se existir, mantemos pra compat com sua estrutura
  private missingDocProbe?: any;

  private started = false;

  // ✅ presence guard
  private presenceUid: string | null = null;

  /**
   * Feature flag (opcional):
   * - Se não existir no environment, default é TRUE (sua regra).
   *
   * Sugestão de env (opcional):
   * features: { logoutOnlyVoluntary: true, ... }
   */
  private readonly voluntaryLogoutOnly =
    (environment as any)?.features?.logoutOnlyVoluntary !== false;

  constructor(
    private authSession: AuthSessionService,
    private userQuery: FirestoreUserQueryService,
    private currentUserStore: CurrentUserStoreService,
    private router: Router,
    private db: Firestore,
    private injector: Injector,
    private presence: PresenceService,
    private logoutService: LogoutService,

    // ✅ centralizado
    private globalErrorHandler: GlobalErrorHandlerService,
    private errorNotifier: ErrorNotificationService,

    // ✅ fonte de verdade do “bloqueio do app”
    private appBlock: AuthAppBlockService,
  ) { }

  // =========================================================
  // Lifecycle
  // =========================================================

  /**
   * start()
   * - Liga o “orquestrador” uma única vez.
   * - Usa authSession.authUser$ como fonte de verdade (User | null).
   * - Usa url$ para gating (registro vs app).
   *
   * Importante:
   * - NÃO reinicia watchers/keepAlive em toda navegação.
   * - Só reseta estado de ciclo quando o UID muda (troca de usuário).
   * - Bloqueio do app é lido do AuthAppBlockService (sem duplicar estado local).
   */
  start(): void {
    if (this.started) return;
    this.started = true;

    // URL stream: ajuda a decidir gating (registro vs app)
    const url$ = this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects || e.url),
      startWith(this.router.url || ''),
      distinctUntilChanged()
    );

    combineLatest([this.authSession.authUser$, url$])
      .pipe(
        // proteção SSR
        filter(() => typeof window !== 'undefined' && typeof document !== 'undefined'),

        switchMap(([u, url]) => {
          // Evita concorrência durante navegações críticas/terminações
          if (this.terminating) return of(null);

          // =========================================================
          // Sem user: encerra efeitos colaterais e limpa estado do app
          // =========================================================
          if (!u) {
            this.sessionUid = null;

            // limpa estado do app (não há mais usuário)
            // (isso não conflita com LogoutService: aqui é “authUser=null”)
            this.currentUserStore.clear();

            // sem usuário, bloqueio não faz sentido
            this.appBlock.clear();

            // para side effects
            this.stopPresenceIfRunning();
            this.stopKeepAlive();
            this.stopWatchers();

            // zera ciclo
            this.sawUserDocOnce = false;
            this.freshUntil = 0;

            if (this.missingDocProbe) {
              clearTimeout(this.missingDocProbe);
              this.missingDocProbe = undefined;
            }

            return of(null);
          }

          // =========================================================
          // Troca de usuário: reseta apenas 1x por UID
          // =========================================================
          if (this.sessionUid !== u.uid) {
            this.sessionUid = u.uid;

            // bloqueio não deve “vazar” entre usuários
            this.appBlock.clear();

            // zera ciclo (somente quando muda usuário)
            this.sawUserDocOnce = false;
            this.freshUntil = 0;

            if (this.missingDocProbe) {
              clearTimeout(this.missingDocProbe);
              this.missingDocProbe = undefined;
            }

            // reinicia guardas locais de side-effects
            this.stopPresenceIfRunning();
            this.stopWatchers();
            // keepAlive pode continuar (startKeepAlive é idempotente)
          }

          // =========================================================
          // Grace time (evita agir cedo demais no boot / pós-login)
          // - Atualiza por "max" para não ficar encurtando/alongando sem querer
          // =========================================================
          const now = Date.now();
          const createdAt = u.metadata?.creationTime
            ? new Date(u.metadata.creationTime).getTime()
            : now;

          const graceNewUser = createdAt + 30_000;
          const graceAnyLogin = now + 6_000;
          this.freshUntil = Math.max(this.freshUntil, graceNewUser, graceAnyLogin);

          // =========================================================
          // Se o app estiver “bloqueado”, NÃO liga watchers/presença/keepAlive
          // e mantém o usuário apenas no fluxo permitido (welcome).
          // =========================================================
          const blockedReason = this.appBlock.snapshot;
          if (blockedReason) {
            this.stopPresenceIfRunning();
            this.stopKeepAlive();
            this.stopWatchers();

            if (!this.inRegistrationFlow(url)) {
              this.navigateToWelcome(blockedReason, true /* replaceUrl */);
            }
            return of(null);
          }

          // =========================================================
          // Gating por rota e e-mail verificado
          // =========================================================
          const inReg = this.inRegistrationFlow(url);
          const unverified = u.emailVerified !== true;

          // ✅ keepAlive pode rodar mesmo no registro (idempotente)
          // (ele só faz reload; não dispara signOut exceto em auth-invalid)
          this.startKeepAlive();

          // ✅ “app mode”: fora do registro e com e-mail verificado
          const shouldRunAppMode = !inReg && !unverified;

          // ✅ presença idempotente
          this.syncPresence(u.uid, shouldRunAppMode);

          // ✅ watchers idempotente (evita churn em toda navegação)
          this.syncWatchers(u.uid, shouldRunAppMode);

          return of(null);
        }),

        catchError((err) => {
          // Orquestrador nunca deve derrubar a app
          this.reportSilent(err, { phase: 'start.pipeline' });
          return of(null);
        })
      )
      .subscribe();
  }

  // =========================================================
  // Error routing (central)
  // =========================================================

  /**
   * reportSilent()
   * - Encaminha erros internos para o GlobalErrorHandlerService.
   * - Marca como "silent" para evitar UX agressiva em streams internos.
   */
  private reportSilent(err: any, context: any): void {
    try {
      const e = new Error('[AuthOrchestrator] internal error');
      (e as any).silent = true;
      (e as any).original = err;
      (e as any).context = context;
      this.globalErrorHandler.handleError(e);
    } catch {
      // noop
    }
  }

  /**
   * ✅ Notificação “privacy friendly”
   * Importante: não diz “sessão encerrada” quando NÃO há signOut.
   */
  private notifyAppBlocked(reason: TerminateReason): void {
    const url = this.router.url || '';
    if (this.inRegistrationFlow(url)) return;

    // Mensagem curta e genérica (evita detalhes sensíveis)
    this.errorNotifier.showError('Sua conta precisa de atenção. Finalize as etapas para continuar.');
    this.reportSilent(new Error('App session blocked'), { reason });
  }

  // =========================================================
  // Navigation helpers
  // =========================================================

  private navigateToWelcome(reason: TerminateReason, replaceUrl = true): void {
    const target = '/register/welcome';
    // evita reentrância/loop de navegação
    if ((this.router.url || '').startsWith(target)) return;

    this.router.navigate([target], {
      queryParams: { reason, autocheck: '1' },
      replaceUrl,
    }).catch(() => { });
  }

  /**
   * syncPresence()
   * - Liga/desliga presence de forma idempotente.
   * - Evita "start" repetido quando já está rodando para o mesmo uid.
   */
  private syncPresence(uid: string, shouldRun: boolean): void {
    if (!shouldRun) {
      this.stopPresenceIfRunning();
      return;
    }

    if (this.presenceUid === uid) return;

    this.stopPresenceIfRunning();
    this.presence.start(uid);
    this.presenceUid = uid;
  }

  private inRegistrationFlow(url: string): boolean {
    return isRegFlow(url);
  }

  // =========================================================
  // Watchers coordinator (evita restart em toda navegação)
  // =========================================================

  /**
   * stopWatchers()
   * - Para watchers de forma idempotente e zera flags internas.
   */
  private stopWatchers(): void {
    this.unwatchUserDoc();
    this.unwatchDeleted();
    this.watchersOn = false;
    this.watchersUid = null;
  }

  /**
   * syncWatchers()
   * - Liga/desliga watchers sem “churn” em toda navegação.
   * - Se já estiver ligado para o mesmo uid, não faz nada.
   * - Se precisar mudar uid ou ligar pela primeira vez, recria subscriptions.
   */
  private syncWatchers(uid: string, shouldRun: boolean): void {
    if (!shouldRun) {
      if (this.watchersOn) this.stopWatchers();
      return;
    }

    if (this.watchersOn && this.watchersUid === uid) return;

    // troca de uid ou primeira vez: reinicia de forma controlada
    this.stopWatchers();
    this.watchUserDoc(uid);
    this.watchUserDocDeleted(uid);
    this.watchersOn = true;
    this.watchersUid = uid;
  }

  // =========================================================
  // “Doc missing” confirmação (server)
  // =========================================================

  /**
   * confirmUserDocMissing$()
   * - Confirma no server (one-shot) se o doc realmente não existe.
   * - Usado como “segundo passo” para evitar agir cedo demais em race-condition.
   */
  private confirmUserDocMissing$(uid: string, delayMs = 1200): Observable<boolean> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return of(false);

    return timer(delayMs).pipe(
      switchMap(() => from(this.userQuery.checkUserExistsFromServer(uid))),
      map((exists) => !exists),
      catchError((err) => {
        this.reportSilent(err, { phase: 'confirmUserDocMissing', uid });
        return of(false);
      }),
      take(1)
    );
  }

  /**
   * Mantém a nomenclatura (compat) mas muda o comportamento:
   * - Antes: confirmava e dava signOut.
   * - Agora: confirmando ausência, BLOQUEIA o app (não desloga).
   */
  private async confirmAndSignOutIfMissing(
    uid: string,
    reason: Extract<TerminateReason, 'deleted' | 'doc-missing-confirmed'>
  ): Promise<void> {
    const allowAct = this.sawUserDocOnce || Date.now() > this.freshUntil;
    if (!allowAct) return;

    const stillMissing = await firstValueFrom(this.confirmUserDocMissing$(uid));
    if (!stillMissing) return;

    // ✅ regra: não deslogar por Firestore
    if (this.voluntaryLogoutOnly) {
      this.blockAppSession(reason);
      return;
    }

    // fallback (se algum dia você desligar a regra)
    this.hardSignOutToEntry(reason);
  }

  // =========================================================
  // Watchers (Firestore)
  // =========================================================

  /**
   * watchUserDoc()
   * - Observa o doc principal do usuário em /users/{uid}
   * - Responsável por detectar flags/estado (suspended/deleted) e aplicar regra:
   *   - voluntaryLogoutOnly=true -> bloqueia o app (sem signOut)
   *   - voluntaryLogoutOnly=false -> fallback: signOut
   */
  private watchUserDoc(uid: string): void {
    const ref = runInInjectionContext(this.injector, () => doc(this.db, 'users', uid));

    this.docSub = runInInjectionContext(this.injector, () => docSnapshots(ref)).subscribe({
      next: (snap) => {
        if (!snap.exists()) {
          // doc ausente: confirma via server e aplica regra
          this.confirmAndSignOutIfMissing(uid, 'doc-missing-confirmed');
          return;
        }

        this.sawUserDocOnce = true;

        const data: any = snap.data() || {};
        const status = (data.status || data.moderation?.status || '').toString().toLowerCase();

        const suspended =
          data.isSuspended === true ||
          data.isBanned === true ||
          status === 'suspended' ||
          status === 'banned';

        const deletedByUser =
          data.isDeleted === true ||
          !!data.deletedAt ||
          status === 'deleted';

        if (suspended) {
          return this.voluntaryLogoutOnly
            ? this.blockAppSession('suspended')
            : this.hardSignOutToEntry('suspended');
        }

        if (deletedByUser) {
          return this.voluntaryLogoutOnly
            ? this.blockAppSession('deleted')
            : this.hardSignOutToEntry('deleted');
        }
      },

      error: (err: any) => {
        const code = (err?.code || '').toString();

        // sempre reporta (silent)
        this.reportSilent(err, { phase: 'watchUserDoc', uid, code });

        // ✅ permission-denied: não deslogar; bloqueia app (fora do registro)
        if (code === 'permission-denied') {
          const url = this.router.url || '';
          if (this.inRegistrationFlow(url)) return;

          const allowAct = this.sawUserDocOnce || Date.now() > this.freshUntil;
          if (!allowAct) return;

          return this.voluntaryLogoutOnly
            ? this.blockAppSession('forbidden')
            : this.hardSignOutToEntry('forbidden');
        }
      },
    });
  }

  private unwatchUserDoc(): void {
    if (this.docSub) {
      this.docSub.unsubscribe();
      this.docSub = null;
    }
  }

  /**
   * watchUserDocDeleted()
   * - Observa um stream mais “leve” (do seu userQuery) para detectar “deleted flag”.
   * - Ao disparar, confirma no server e aplica a regra (bloqueio vs signOut fallback).
   */
  private watchUserDocDeleted(uid: string): void {
    this.deletedSub = this.userQuery
      .watchUserDocDeleted$(uid)
      .pipe(
        scan(
          (state, deleted) => {
            if (state.fired) return state;

            const allowAct = this.sawUserDocOnce || Date.now() > this.freshUntil;
            const shouldFire = deleted && allowAct;

            return { fired: shouldFire || state.fired };
          },
          { fired: false as boolean }
        ),
        take(1)
      )
      .subscribe({
        next: () => {
          // confirma via server e aplica regra
          this.confirmAndSignOutIfMissing(uid, 'deleted');
        },
        error: (err) => {
          this.reportSilent(err, { phase: 'watchUserDocDeleted', uid });
        },
      });
  }

  private unwatchDeleted(): void {
    if (this.deletedSub) {
      this.deletedSub.unsubscribe();
      this.deletedSub = null;
    }
  }

  // =========================================================
  // ✅ KeepAlive RxJS (mantendo nomes start/stop)
  // =========================================================

  /**
   * startKeepAlive()
   * - Mantém a sessão “quente” e detecta invalidação técnica do Auth.
   * - Único caso de signOut inevitável: Auth diz que o token/user é inválido.
   */
  private startKeepAlive(): void {
    if (this.keepAliveSub) return;

    // 10 min
    this.keepAliveSub = timer(600_000, 600_000)
      .pipe(
        exhaustMap(() => {
          const u = this.authSession.currentAuthUser; // ✅ sem injetar Auth no Orchestrator
          if (!u) return of(null);

          return from(u.reload()).pipe(
            map(() => null),
            catchError((e: any) => {
              const code = e?.code || '';

              /**
               * ✅ ÚNICO caso onde signOut é inevitável:
               * o Firebase Auth diz que a sessão é inválida/expirada/desabilitada.
               */
              if (
                code === 'auth/user-token-expired' ||
                code === 'auth/user-disabled' ||
                code === 'auth/user-not-found' ||
                code === 'auth/invalid-user-token'
              ) {
                // delega hard signOut real + limpeza
                this.logoutService.hardSignOutToWelcome('auth-invalid');
                return of(null);
              }

              // não fatal: só observabilidade
              this.reportSilent(e, { phase: 'keepAlive.reload' });
              return of(null);
            })
          );
        }),
        catchError((err) => {
          this.reportSilent(err, { phase: 'keepAlive.pipeline' });
          return of(null);
        })
      )
      .subscribe();
  }

  private stopKeepAlive(): void {
    this.keepAliveSub?.unsubscribe();
    this.keepAliveSub = null;
  }

  // =========================================================
  // Presence stop helpers (mantendo compat)
  // =========================================================

  /**
   * stopPresenceIfRunning$()
   * - Para presença best-effort (não deve derrubar o fluxo).
   * - Retorna Observable<void> para permitir composição reativa.
   */
  private stopPresenceIfRunning$(): Observable<void> {
    if (!this.presenceUid) return of(void 0);

    // marca como parado aqui pra evitar reentrância
    this.presenceUid = null;

    return this.presence.stop$().pipe(
      take(1),
      defaultIfEmpty(void 0),
      catchError((err) => {
        this.reportSilent(err, { phase: 'presence.stop$' });
        return of(void 0);
      })
    );
  }

  private stopPresenceIfRunning(): void {
    this.stopPresenceIfRunning$()
      .pipe(take(1))
      .subscribe({ next: () => { }, error: () => { } });
  }

  // =========================================================
  // ✅ SignOut inevitável (compat wrapper)
  // - Não “faz logout” por Firestore quando voluntaryLogoutOnly=true.
  // - Serve apenas como fallback (quando voluntaryLogoutOnly=false).
  // - Execução real fica no LogoutService.
  // =========================================================
  private hardSignOutToEntry(reason: TerminateReason): void {
    if (this.terminating) return;
    this.terminating = true;

    // Para efeitos colaterais locais (evita ruído durante signOut)
    this.stopKeepAlive();
    this.stopWatchers();

    if (this.missingDocProbe) {
      clearTimeout(this.missingDocProbe);
      this.missingDocProbe = undefined;
    }

    // Presence best-effort e delega o signOut “real”
    this.stopPresenceIfRunning$()
      .pipe(
        take(1),
        finalize(() => {
          // delega signOut + navegação + limpeza (fonte de verdade)
          this.logoutService.hardSignOutToWelcome(reason);

          // bloqueio não deve sobreviver ao hard signOut
          this.appBlock.clear();

          this.terminating = false;
        })
      )
      .subscribe({ next: () => { }, error: () => { this.terminating = false; } });
  }

  // =========================================================
  // ✅ “Bloqueio do app” sem logout (regra principal)
  // =========================================================

  /**
   * blockAppSession()
   * Bloqueia o APP mantendo a sessão autenticada.
   * - Persiste o motivo no AuthAppBlockService (fonte de verdade única)
   * - Para watchers/presença/keepAlive (pra não gerar ruído)
   * - Redireciona para /register/welcome
   *
   * Obs.: hoje, só sai desse estado com logout (conforme sua regra).
   */
  private blockAppSession(reason: TerminateReason): void {
    if (this.terminating) return;
    this.terminating = true;

    // ✅ fonte única do bloqueio
    this.appBlock.set(reason);

    // para side-effects
    this.stopKeepAlive();
    this.stopWatchers();

    if (this.missingDocProbe) {
      clearTimeout(this.missingDocProbe);
      this.missingDocProbe = undefined;
    }

    // presence é best-effort
    this.stopPresenceIfRunning$()
      .pipe(
        take(1),
        finalize(() => {
          // feedback não sensível
          this.notifyAppBlocked(reason);

          // manda para rota permitida para autenticado (fluxo de correção)
          this.navigateToWelcome(reason, true);

          this.terminating = false;
        })
      )
      .subscribe();
  }
}

/*
  AuthSessionService = verdade do Firebase Auth (authUser$, uid$, ready$)
  CurrentUserStoreService = verdade do usuário do app (IUserDados / role / profileCompleted)
  AuthAppBlockService = verdade do "bloqueio do app" (TerminateReason | null)
  AuthOrchestratorService = efeitos colaterais (presence, watchers, keepAlive, navegação defensiva)
*/
