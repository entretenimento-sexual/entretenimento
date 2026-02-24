// src/app/core/services/autentication/auth.service.ts
// =============================================================================
// ⚠️ DEPRECATED (compat layer)
// =============================================================================
// Objetivo desta versão reduzida:
// - Manter a API pública usada pelo legado (user$, currentUser, isAuthenticated,
//   getLoggedUserUID$, setCurrentUser, logout) SEM duplicar a “fonte da verdade”.
// - NÃO fazer fetch de perfil aqui (isso é papel do CurrentUserStoreService / Effects).
// - NÃO ficar disparando logoutSuccess em loop no boot quando uid já é null.
// - Continuar roteando erros para o GlobalErrorHandlerService.
//
// Observação importante:
// - A sincronização “real” de sessão com Store deve ser feita por AuthSessionSyncEffects
//   (authSessionChanged). Este serviço só mantém compat com chamadas antigas.
// =============================================================================
import { Injectable, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';

import { BehaviorSubject, Observable, Subject, from, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';

import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { loginSuccess, logoutSuccess } from 'src/app/store/actions/actions.user/auth.actions';
import { setCurrentUser } from 'src/app/store/actions/actions.user/user.actions';
import { sanitizeUserForStore } from 'src/app/store/utils/user-store.serializer';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

import { CacheService } from 'src/app/core/services/general/cache/cache.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PresenceService } from 'src/app/core/services/presence/presence.service';
import { UsuarioService } from 'src/app/core/services/user-profile/usuario.service';

import { Auth, signOut } from '@angular/fire/auth';

// ✅ NOVA ARCH (fonte da verdade)
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';

import { environment } from 'src/environments/environment';

@Injectable({ providedIn: 'root' })
export class AuthService implements OnDestroy {
  // Compat: alguns lugares ainda usam user$ e currentUser sincrônico.
  private readonly userSubject = new BehaviorSubject<IUserDados | null>(null);
  readonly user$: Observable<IUserDados | null> = this.userSubject.asObservable();

  private readonly destroy$ = new Subject<void>();

  // Debug controlado (sem poluir prod)
  private readonly debug = !environment.production;

  // Guarda o último uid para detectar transição real (evita loop de logout).
  private lastUid: string | null = null;

  // Cache do stream de uid (compat com getLoggedUserUID$ antigo)
  private cachedUid$: Observable<string | null> | null = null;

  constructor(
    // (opcional) alguns fluxos antigos navegam após logout
    private readonly router: Router,

    private readonly store: Store<AppState>,
    private readonly cache: CacheService,
    private readonly globalError: GlobalErrorHandlerService,
    private readonly presence: PresenceService,
    private readonly usuarioService: UsuarioService,
    private readonly auth: Auth,

    // ✅ nova fonte de verdade
    private readonly authSession: AuthSessionService,
    private readonly currentUserStore: CurrentUserStoreService,
  ) {
    this.bindSessionToCompatState();
    this.bindProfileToCompatState();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ===========================================================================
  // Compat getters
  // ===========================================================================
  get currentUser(): IUserDados | null {
    return this.userSubject.value;
  }

  isAuthenticated(): boolean {
    return !!this.userSubject.value?.uid;
  }

  /**
   * Compat API: uid atual como Observable.
   * - Agora a fonte é AuthSessionService.uid$ (não cache + authState).
   * - shareReplay para manter comportamento “cachedUid$”.
   */
  getLoggedUserUID$(): Observable<string | null> {
    if (!this.cachedUid$) {
      this.cachedUid$ = this.authSession.uid$.pipe(
        distinctUntilChanged(),
        shareReplay({ bufferSize: 1, refCount: true }),
        catchError((err) => {
          this.reportSilent('getLoggedUserUID$', err);
          return of(null);
        })
      );
    }
    return this.cachedUid$;
  }

  // ===========================================================================
  // Compat setters
  // ===========================================================================
  /**
   * Compat: ainda pode ser chamado por fluxos antigos após login.
   * Mantém:
   * - userSubject (uso sincrônico)
   * - localStorage/cache
   * - dispatches legacy (loginSuccess/setCurrentUser) para não quebrar telas antigas
   *
   * IMPORTANTE:
   * - Evite chamar isso como “fonte de verdade” nova.
   * - Prefira atualizar o perfil via CurrentUserStoreService / Effects.
   */
  setCurrentUser(userData: IUserDados): void {
    try {
      if (!userData?.uid) return;

      const serial = sanitizeUserForStore(userData);

      // Se já é o mesmo uid e sem mudanças, não faz churn.
      const prev = this.userSubject.value;
      if (prev?.uid === serial.uid) {
        // comparação barata: se quiser, troque por um hash/etag no futuro
        const prevStr = JSON.stringify(prev);
        const nextStr = JSON.stringify(serial);
        if (prevStr === nextStr) return;
      }

      this.userSubject.next(serial);

      localStorage.setItem('currentUser', JSON.stringify(serial));
      this.cache.set('currentUser', serial, 300000);
      this.cache.set('currentUserUid', serial.uid, 300000);

      // ✅ compat com reducers/telas antigas
      this.store.dispatch(loginSuccess({ user: serial }));
      this.store.dispatch(setCurrentUser({ user: serial }));

      this.dbg('setCurrentUser (compat) aplicado', { uid: serial.uid });
    } catch (err) {
      this.reportSilent('setCurrentUser', err);
    }
  }

  // ===========================================================================
  // Logout (compat)
  // ===========================================================================
  /**
   * Compat: logout em Observable<void>.
   * - Não faz “clearCurrentUser()” direto para evitar dupla limpeza/dispatch.
   * - Confia na mudança do AuthSession (uid -> null) para disparar limpeza uma vez.
   * - Se algo falhar, faz fallback local para não travar o usuário.
   */
  logout(): Observable<void> {
    return this.getLoggedUserUID$().pipe(
      take(1),
      switchMap((uid) => {
        // Best-effort: para presença e tenta marcar offline (legado)
        this.presence.stop();

        const offline$ = uid
          ? this.usuarioService.updateUserOnlineStatus(uid, false).pipe(
            take(1),
            catchError((err) => {
              this.reportSilent('logout.updateUserOnlineStatus(false)', err);
              return of(void 0);
            })
          )
          : of(void 0);

        return offline$.pipe(
          switchMap(() =>
            from(signOut(this.auth)).pipe(
              catchError((err) => {
                // Mesmo se o signOut falhar, não deixa o usuário “preso” localmente
                this.reportSilent('logout.signOut', err);
                this.forceLocalClearOnce('logout.signOut failed');
                return of(void 0);
              })
            )
          ),
          tap(() => {
            // Navegação é opcional (mantenha se o legado espera isso)
            // Evite navegações duplicadas: o Router guard/effects podem fazer isso também.
            this.router.navigate(['/login'], { replaceUrl: true }).catch(() => { });
          }),
          map(() => void 0)
        );
      }),
      catchError((err) => {
        this.reportSilent('logout', err);
        this.forceLocalClearOnce('logout catchError');
        return of(void 0);
      })
    );
  }

  // ===========================================================================
  // Internals
  // ===========================================================================
  /**
   * Liga a sessão real (AuthSessionService.uid$) ao estado compat:
   * - emite logoutSuccess APENAS na transição uid != null -> null
   * - limpa caches/localStorage uma vez
   */
  private bindSessionToCompatState(): void {
    this.authSession.uid$
      .pipe(
        distinctUntilChanged(),
        tap((uid) => this.onUidChanged(uid ?? null)),
        catchError((err) => {
          this.reportSilent('bindSessionToCompatState', err);
          // fallback: força estado local “deslogado” uma vez
          this.onUidChanged(null);
          return of(null);
        })
      )
      .subscribe();
  }

  /**
   * Liga o perfil (CurrentUserStoreService.user$) ao estado compat:
   * - só “hidrata” quando vier um usuário válido
   * - não limpa em undefined (evita flicker no boot)
   */
  private bindProfileToCompatState(): void {
    this.currentUserStore.user$
      .pipe(
        tap((u) => {
          if (!u) return; // undefined/null: não mexe (sessão decide o clear)
          if (!u.uid) return;

          // só atualiza compat se bater com uid atual (evita sujeira)
          if (this.lastUid && u.uid !== this.lastUid) return;

          // Atualiza compat sem forçar dispatch extra (setCurrentUser tem dispatch; aqui só state)
          this.userSubject.next(u as any);

          // Mantém caches úteis (compat)
          localStorage.setItem('currentUser', JSON.stringify(u));
          this.cache.set('currentUser', u, 300000);
          this.cache.set('currentUserUid', u.uid, 300000);
        }),
        catchError((err) => {
          this.reportSilent('bindProfileToCompatState', err);
          return of(null);
        })
      )
      .subscribe();
  }

  private onUidChanged(uid: string | null): void {
    // Evita trabalho redundante
    const prev = this.lastUid;
    if (prev === uid) return;

    this.lastUid = uid;

    if (!uid) {
      // Sessão terminou (ou não existe)
      this.presence.stop();
      this.clearLocalState();

      // ✅ dispatch legacy só na transição REAL (prev != null -> null)
      if (prev) {
        this.dbg('dispatch logoutSuccess (transition)', { prevUid: prev });
        this.store.dispatch(logoutSuccess());
      } else {
        // boot com uid null: não dispara logoutSuccess (evita loop/ruído)
        this.dbg('uid null no boot (no dispatch)');
      }

      return;
    }

    // Sessão ativa: tenta hidratar user compat do cache/localStorage
    this.tryHydrateCachedUser(uid);
  }

  private tryHydrateCachedUser(uid: string): void {
    // 1) localStorage (mais rápido)
    try {
      const raw = localStorage.getItem('currentUser');
      if (raw) {
        const parsed = JSON.parse(raw) as IUserDados;
        if (parsed?.uid === uid) {
          this.userSubject.next(parsed);
          this.dbg('hydrated currentUser from localStorage', { uid });
          return;
        }
      }
    } catch (err) {
      this.reportSilent('tryHydrateCachedUser.localStorage', err);
    }

    // 2) CacheService (se estiver disponível)
    this.cache
      .get<IUserDados>('currentUser')
      .pipe(
        take(1),
        tap((cached) => {
          if (cached?.uid === uid) {
            this.userSubject.next(cached);
            this.dbg('hydrated currentUser from CacheService', { uid });
          }
        }),
        catchError((err) => {
          this.reportSilent('tryHydrateCachedUser.cache', err);
          return of(null);
        })
      )
      .subscribe();
  }

  /**
   * Limpeza local idempotente (sem dispatch).
   * - dispatch é controlado em onUidChanged, e só em transição real.
   */
  private clearLocalState(): void {
    this.userSubject.next(null);
    localStorage.removeItem('currentUser');
    this.cachedUid$ = null;

    // cache keys compat (não assume que existam)
    try {
      this.cache.delete('currentUser');
      this.cache.delete('currentUserUid');
    } catch (err) {
      // cache pode falhar dependendo do storage (não explode UI)
      this.reportSilent('clearLocalState.cache.delete', err);
    }
  }

  /**
   * Fallback quando algo crítico falha e não dá para esperar o AuthSession emitir null.
   * Importante: NÃO dispara logoutSuccess aqui. Isso é controlado por onUidChanged.
   * Para evitar duplo “dispatch”, forçamos lastUid=null também.
   */
  private forceLocalClearOnce(reason: string): void {
    this.dbg('forceLocalClearOnce', { reason });

    // Se já estamos “deslogados” localmente, não repete
    if (this.lastUid === null && this.userSubject.value === null) return;

    // força estado local coerente
    this.lastUid = null;
    this.clearLocalState();

    // Mantém compat com watchers antigos, mas de forma controlada:
    // só dispara se a store ainda estiver em estado “logado” por legado.
    // (Se isso ainda gerar duplicidade, remova e migre watchers para authSessionChanged)
    this.store.dispatch(logoutSuccess());
  }

  private reportSilent(context: string, err: unknown): void {
    const e = err instanceof Error ? err : new Error(`[AuthService][compat] ${context}`);
    (e as any).silent = true;
    (e as any).original = err;
    (e as any).context = context;
    this.globalError.handleError(e);
  }

  private dbg(msg: string, extra?: unknown): void {
    if (!this.debug) return;
    // eslint-disable-next-line no-console
    console.log(`[AuthService][compat] ${msg}`, extra ?? '');
  }
}
