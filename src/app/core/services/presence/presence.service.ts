// src/app/core/services/presence/presence.service.ts
// -----------------------------------------------------------------------------
// PRESENCE SERVICE
// -----------------------------------------------------------------------------
// Responsabilidade:
// - controlar a escrita de presença do usuário autenticado no Firestore;
// - manter heartbeat de presença;
// - alternar entre online/away/offline conforme estado da aba/rede;
// - evitar escrita concorrente em múltiplas abas usando leader election;
// - liberar liderança ao fechar/sair da aba;
// - nunca derrubar a aplicação por erro de presença.
//
// O que este service NÃO decide:
// - se a presença deve rodar ou não;
// - se o usuário está autorizado a usar descoberta/chat;
// - se o usuário deve aparecer para outras pessoas.
//
// Essas decisões pertencem a:
// - AccessControlService;
// - PresenceOrchestratorService;
// - gates de produto;
// - queries de discovery/online users.
//
// Modelo em 2 níveis:
// 1. Presence Gate:
//    - sessão pronta + uid válido;
//    - não depende necessariamente de e-mail verificado;
//    - serve como infraestrutura de sessão.
//
// 2. Product/Realtime Gate:
//    - perfil completo, e-mail verificado quando necessário;
//    - controla recursos visíveis para outros usuários, como chat/discovery.
//
// Debug:
// - não usa console.log direto;
// - usa PrivacyDebugLoggerService;
// - canal: DEBUG_PRESENCE;
// - UID, leaderKey e demais identificadores são sanitizados no logger central.
// -----------------------------------------------------------------------------

import { Injectable, NgZone } from '@angular/core';
import {
  EMPTY,
  Observable,
  Subscription,
  combineLatest,
  interval,
  merge,
  of,
} from 'rxjs';
import {
  auditTime,
  catchError,
  defaultIfEmpty,
  distinctUntilChanged,
  exhaustMap,
  filter,
  finalize,
  map,
  pairwise,
  shareReplay,
  skip,
  startWith,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';

import { PresenceDomStreamsService } from './presence-dom-streams.service';
import { PresenceLeaderElectionService } from './presence-leader-election.service';
import { PresenceWriterService } from './presence-writer.service';
import { PrivacyDebugLoggerService } from '@core/services/privacy/privacy-debug-logger.service';

type VisibilityStateSafe = 'hidden' | 'visible';

@Injectable({ providedIn: 'root' })
export class PresenceService {
  private static readonly HEARTBEAT_MS = 30_000;

  /**
   * Mantido como false por segurança operacional.
   *
   * Motivo:
   * - eventos de unload/pagehide não garantem conclusão de escrita assíncrona;
   * - em multiaba, uma aba fechando não significa que o usuário saiu;
   * - outra aba pode reassumir liderança e manter a presença viva;
   * - forçar offline no fechamento pode gerar falso offline.
   *
   * Offline real deve ocorrer em:
   * - logout;
   * - stop$();
   * - encerramento controlado pelo PresenceOrchestratorService.
   */
  private static readonly SET_OFFLINE_ON_EXIT = false;

  private sub = new Subscription();
  private activeUid?: string;
  private leaderKey?: string;

  constructor(
    private readonly zone: NgZone,
    private readonly domStreams: PresenceDomStreamsService,
    private readonly leader: PresenceLeaderElectionService,
    private readonly writer: PresenceWriterService,
    private readonly privacyDebug: PrivacyDebugLoggerService
  ) {}

  // ---------------------------------------------------------------------------
  // Debug seguro
  // ---------------------------------------------------------------------------
  // Canal:
  // localStorage.setItem('DEBUG_PRESENCE', '1');
  //
  // Sem essa flag, este service não gera logs.
  // Com a flag ativa, a sanitização ocorre no PrivacyDebugLoggerService.
  // ---------------------------------------------------------------------------

  private dbg(msg: string, extra?: unknown): void {
    this.privacyDebug.log('presence', msg, extra);
  }

  // ---------------------------------------------------------------------------
  // API pública
  // ---------------------------------------------------------------------------

  /**
   * Inicia a presença para o UID informado.
   *
   * Chamador esperado:
   * - PresenceOrchestratorService.
   *
   * A chamada é idempotente para o mesmo UID.
   * Se o UID mudar, o service encerra a presença anterior antes de iniciar a nova.
   */
  start(uid: string): void {
    const cleanUid = this.normalizeUid(uid);

    if (!cleanUid) {
      return;
    }

    if (this.activeUid === cleanUid) {
      this.dbg('start ignorado: presença já ativa para este UID', {
        uid: cleanUid,
      });
      return;
    }

    if (this.activeUid && this.activeUid !== cleanUid) {
      this.dbg('start com UID diferente: encerrando presença anterior', {
        fromUid: this.activeUid,
        toUid: cleanUid,
      });

      this.stop();
    }

    this.activeUid = cleanUid;
    this.leaderKey = this.leader.buildLeaderKey(cleanUid);

    this.dbg('START', {
      uid: cleanUid,
      leaderKey: this.leaderKey,
    });

    const dom = this.domStreams.create();

    /**
     * isLeader$:
     * - true apenas para a aba responsável por escrever presença;
     * - evita múltiplas abas gerando heartbeat concorrente;
     * - createIsLeader$ já possui shareReplay/refCount internamente, mas mantemos
     *   shareReplay aqui para consumo local consistente.
     */
    const isLeader$ = this.leader.createIsLeader$(cleanUid, dom.storage$).pipe(
      distinctUntilChanged(),
      tap((isLeader) =>
        this.dbg('isLeader$', {
          uid: cleanUid,
          isLeader,
        })
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    /**
     * visibility$:
     * - visible => usuário pode ser marcado online;
     * - hidden  => usuário deve permanecer vivo como away;
     * - startWith garante que o bootstrap tenha estado inicial mesmo sem evento.
     */
    const visibility$ = dom.visibility$.pipe(
      startWith(this.getInitialVisibility()),
      distinctUntilChanged(),
      tap((visibility) =>
        this.dbg('visibility$', {
          uid: cleanUid,
          visibility,
        })
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    const bootstrap$ = this.createBootstrap$(
      cleanUid,
      isLeader$,
      visibility$
    );

    const onLeaderAcquired$ = this.createLeaderAcquired$(
      cleanUid,
      isLeader$,
      visibility$
    );

    const heartbeat$ = this.createHeartbeat$(
      cleanUid,
      isLeader$,
      visibility$
    );

    const onOnline$ = this.createOnline$(
      cleanUid,
      dom.online$,
      isLeader$,
      visibility$
    );

    const onVisibility$ = this.createVisibilityChange$(
      cleanUid,
      visibility$,
      isLeader$
    );

    const onOffline$ = this.createOffline$(
      cleanUid,
      dom.offline$,
      isLeader$
    );

    const onExit$ = this.createExit$(
      cleanUid,
      merge(dom.beforeUnload$, dom.pageHide$)
    );

    /**
     * Presença não deve disparar change detection global.
     * As escritas são infraestrutura; a UI deve reagir via Store/queries,
     * não por efeitos colaterais deste service.
     */
    this.zone.runOutsideAngular(() => {
      this.sub.add(bootstrap$.subscribe());
      this.sub.add(onLeaderAcquired$.subscribe());
      this.sub.add(heartbeat$.subscribe());
      this.sub.add(onOnline$.subscribe());
      this.sub.add(onVisibility$.subscribe());
      this.sub.add(onOffline$.subscribe());
      this.sub.add(onExit$.subscribe());
    });
  }

  /**
   * Encerra presença de forma observável.
   *
   * Regras:
   * - cancela imediatamente os streams locais;
   * - se esta aba for líder, tenta marcar offline;
   * - libera liderança ao final;
   * - erros do writer são tratados como best-effort.
   */
  stop$(): Observable<void> {
    if (!this.activeUid) {
      return of(void 0);
    }

    const uid = this.activeUid;
    const key = this.leaderKey;
    const wasLeader = this.leader.isLeaderNow(uid);

    this.disposeSubscriptions();

    this.activeUid = undefined;
    this.leaderKey = undefined;

    this.dbg('STOP$', {
      uid,
      wasLeader,
      leaderKey: key,
    });

    const markOffline$ =
      wasLeader && uid
        ? this.writer.setOffline$(uid, 'stop$()').pipe(
            defaultIfEmpty(void 0),
            catchError((err) => {
              this.dbg('STOP$: setOffline$ erro suprimido', err);
              return of(void 0);
            })
          )
        : of(void 0);

    return markOffline$.pipe(
      finalize(() => {
        if (key) {
          this.dbg('STOP$: releaseLeadership()', {
            key,
          });

          this.leader.releaseLeadership(key);
        }
      }),
      map(() => void 0)
    );
  }

  /**
   * Versão imperativa de stop$.
   *
   * Mantida para compatibilidade com orquestradores que não precisam aguardar
   * o encerramento observável.
   */
  stop(): void {
    this.stop$()
      .pipe(take(1))
      .subscribe({
        next: () => {},
        error: () => {},
      });
  }

  // ---------------------------------------------------------------------------
  // Streams internos
  // ---------------------------------------------------------------------------

  /**
   * Bootstrap inicial:
   * - somente a aba líder escreve;
   * - hidden inicia como away;
   * - visible inicia como online.
   */
  private createBootstrap$(
    uid: string,
    isLeader$: Observable<boolean>,
    visibility$: Observable<VisibilityStateSafe>
  ): Observable<unknown> {
    return combineLatest([
      isLeader$.pipe(take(1)),
      visibility$.pipe(take(1)),
    ]).pipe(
      filter(([isLeader]) => isLeader),
      exhaustMap(([, visibility]) => this.writeByVisibility(uid, visibility)),
      catchError((err) => this.suppressStreamError('bootstrap$', err))
    );
  }

  /**
   * Quando uma aba se torna líder:
   * - assume a presença conforme estado atual da aba;
   * - se o navegador estiver offline, registra offline best-effort;
   * - cobre reassunção de liderança sem visibilitychange.
   */
  private createLeaderAcquired$(
    uid: string,
    isLeader$: Observable<boolean>,
    visibility$: Observable<VisibilityStateSafe>
  ): Observable<unknown> {
    return isLeader$.pipe(
      startWith(false),
      pairwise(),
      filter(([previous, current]) => !previous && current),
      tap(() =>
        this.dbg('leader acquired', {
          uid,
        })
      ),
      switchMap(() =>
        visibility$.pipe(
          take(1),
          exhaustMap((visibility) => {
            if (this.isNavigatorOffline()) {
              return this.writer.setOffline$(
                uid,
                'leader-acquired:navigator-offline'
              );
            }

            return this.writeByVisibility(uid, visibility);
          })
        )
      ),
      catchError((err) => this.suppressStreamError('onLeaderAcquired$', err))
    );
  }

  /**
   * Heartbeat:
   * - só roda na aba líder;
   * - visible mantém online;
   * - hidden mantém away com lastSeen vivo;
   * - evita que away expire em UserPresenceQueryService.
   */
  private createHeartbeat$(
    uid: string,
    isLeader$: Observable<boolean>,
    visibility$: Observable<VisibilityStateSafe>
  ): Observable<unknown> {
    return combineLatest([isLeader$, visibility$]).pipe(
      switchMap(([isLeader, visibility]) => {
        if (!isLeader) {
          return EMPTY;
        }

        return interval(PresenceService.HEARTBEAT_MS).pipe(
          startWith(0),
          filter(() => !this.isNavigatorOffline()),
          exhaustMap(() =>
            visibility === 'hidden'
              ? this.writer.setAway$(uid)
              : this.writer.beatOnline$(uid)
          ),
          catchError((err) => this.suppressStreamError('heartbeat$', err))
        );
      })
    );
  }

  /**
   * Rede voltou:
   * - somente líder escreve;
   * - respeita a visibilidade atual.
   */
  private createOnline$(
    uid: string,
    online$: Observable<unknown>,
    isLeader$: Observable<boolean>,
    visibility$: Observable<VisibilityStateSafe>
  ): Observable<unknown> {
    return online$.pipe(
      auditTime(1000),
      tap(() =>
        this.dbg('DOM online$', {
          uid,
        })
      ),
      switchMap(() =>
        combineLatest([
          isLeader$.pipe(take(1)),
          visibility$.pipe(take(1)),
        ]).pipe(
          filter(([isLeader]) => isLeader),
          exhaustMap(([, visibility]) => this.writeByVisibility(uid, visibility))
        )
      ),
      catchError((err) => this.suppressStreamError('onOnline$', err))
    );
  }

  /**
   * Visibilidade mudou:
   * - somente líder escreve;
   * - hidden => away;
   * - visible => online.
   */
  private createVisibilityChange$(
    uid: string,
    visibility$: Observable<VisibilityStateSafe>,
    isLeader$: Observable<boolean>
  ): Observable<unknown> {
    return visibility$.pipe(
      skip(1),
      switchMap((visibility) =>
        isLeader$.pipe(
          take(1),
          filter(Boolean),
          exhaustMap(() => this.writeByVisibility(uid, visibility))
        )
      ),
      catchError((err) => this.suppressStreamError('onVisibility$', err))
    );
  }

  /**
   * Rede caiu:
   * - não força offline visual definitivo;
   * - marca away best-effort para reduzir falso online;
   * - offline real fica para stop/logout.
   */
  private createOffline$(
    uid: string,
    offline$: Observable<unknown>,
    isLeader$: Observable<boolean>
  ): Observable<unknown> {
    return offline$.pipe(
      auditTime(1000),
      tap((reason) =>
        this.dbg('DOM offline$ → setAway best-effort', {
          uid,
          reason,
        })
      ),
      switchMap(() =>
        isLeader$.pipe(
          take(1),
          filter(Boolean),
          exhaustMap(() => this.writer.setAway$(uid))
        )
      ),
      catchError((err) => this.suppressStreamError('onOffline$', err))
    );
  }

  /**
   * Saída da página/aba:
   * - libera liderança imediatamente;
   * - não força offline por padrão;
   * - permite outra aba reassumir sem esperar TTL.
   */
  private createExit$(
    uid: string,
    exit$: Observable<unknown>
  ): Observable<unknown> {
    return exit$.pipe(
      auditTime(50),
      map((reason) => ({
        reason,
        wasLeader: this.leader.isLeaderNow(uid),
        key: this.leaderKey,
      })),
      tap(({ wasLeader, key }) => {
        if (wasLeader && key) {
          this.dbg('EXIT: releaseLeadership()', {
            uid,
            key,
          });

          this.leader.releaseLeadership(key);
        }
      }),
      switchMap(({ reason, wasLeader }) => {
        if (!PresenceService.SET_OFFLINE_ON_EXIT) {
          return EMPTY;
        }

        if (!wasLeader) {
          return EMPTY;
        }

        return this.writer.setOffline$(uid, String(reason ?? 'exit'));
      }),
      catchError((err) => this.suppressStreamError('onExit$', err))
    );
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private writeByVisibility(
    uid: string,
    visibility: VisibilityStateSafe
  ): Observable<unknown> {
    return visibility === 'hidden'
      ? this.writer.setAway$(uid)
      : this.writer.setOnline$(uid);
  }

  private suppressStreamError(context: string, err: unknown): Observable<never> {
    /**
     * O writer já deve encaminhar erros ao GlobalErrorHandlerService.
     * Aqui apenas impedimos que um erro de presença encerre o stream inteiro.
     */
    this.dbg(`${context} erro suprimido no stream`, err);
    return EMPTY;
  }

  private getInitialVisibility(): VisibilityStateSafe {
    if (typeof document === 'undefined') {
      return 'visible';
    }

    return document.visibilityState === 'hidden' ? 'hidden' : 'visible';
  }

  private isNavigatorOffline(): boolean {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
  }

  private normalizeUid(uid: string | null | undefined): string {
    return String(uid ?? '').trim();
  }

  private disposeSubscriptions(): void {
    this.sub.unsubscribe();
    this.sub = new Subscription();
  }
}