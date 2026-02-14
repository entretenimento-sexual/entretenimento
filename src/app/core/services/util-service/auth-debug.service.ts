// src/app/core/debug/auth-debug.service.ts
// Serviço de diagnóstico de autenticação (DEV only).
// Objetivo:
// - Expor mudanças relevantes do ciclo Auth (AngularFire + SDK nativo + AuthSession + NgRx)
// - Evitar ruído: logs somente quando há mudança real e/ou com rate-limit.
// - Trace pesado (getIdToken/getIdTokenResult + stack) é OPT-IN via localStorage.

import {
  Injectable,
  EnvironmentInjector,
  runInInjectionContext,
  inject,
  DestroyRef,
} from '@angular/core';

import { Auth, authState, idToken } from '@angular/fire/auth';
import { onIdTokenChanged, type Auth as FirebaseAuth, type User as FirebaseUser } from 'firebase/auth';

import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import {
  selectAuthUid,
  selectAuthEmailVerified,
  selectAuthReady,
  selectIsAuthenticated,
} from 'src/app/store/selectors/selectors.user/auth.selectors';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

import { Subscription, combineLatest, EMPTY, from, defer, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  startWith,
  shareReplay,
  auditTime,
  debounceTime,
  filter,
  switchMap,
  tap,
} from 'rxjs/operators';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ts = () => new Date().toISOString().split('T')[1]!.replace('Z', '');

function safeJson(v: unknown): string {
  try { return JSON.stringify(v); } catch { return String(v); }
}

@Injectable({ providedIn: 'root' })
export class AuthDebugService {
  private readonly env = inject(EnvironmentInjector);
  private readonly store = inject(Store<AppState>);
  private readonly authSession = inject(AuthSessionService);
  private readonly globalErrorHandler = inject(GlobalErrorHandlerService);
  private readonly destroyRef = inject(DestroyRef);

  private subs = new Subscription();
  private started = false;

  // Listener SDK nativo
  private offIdTokenChanged?: () => void;

  // Evita patch duplicado do mesmo FirebaseUser
  private patchedUsers = new WeakSet<object>();

  // Rate-limit simples para logs repetitivos
  private lastLogAt = new Map<string, number>();

  // “últimos valores” para logar apenas quando muda
  private lastNativeUid: string | null = null;

  // Config: opt-in via localStorage (útil em dev sem recompilar)
  private readonly cfg = this.readConfig();

  constructor(private readonly auth: Auth) {
    // Em serviços de debug: NÃO abra listeners no constructor.
    // start()/stop() controlam o ciclo e evitam duplicidades (HMR/hot reload).
    this.destroyRef.onDestroy(() => this.stop());
  }

  /** Inicia os logs e watchers (idempotente). */
  start(): void {
    if (this.started) return;
    this.started = true;

    // Reinicia container de subs (importante em HMR)
    this.subs = new Subscription();

    runInInjectionContext(this.env, () => {
      // 1) AngularFire authState()
      this.subs.add(
        authState(this.auth).pipe(
          map(u => u ? ({
            uid: u.uid,
            email: u.email,
            verified: u.emailVerified,
            prov: u.providerData?.map(p => p?.providerId),
          }) : null),
          distinctUntilChanged((a, b) => safeJson(a) === safeJson(b)),
          tap(snapshot => this.log('info', 'af.authState', 'angularfire.authState$ →', snapshot)),
          catchError(err => this.handle('AuthDebugService: falha no angularfire.authState()', err))
        ).subscribe()
      );

      // 1.1) AngularFire idToken()
      // Nota: NÃO chama getIdToken(true). Apenas observa mudanças.
      this.subs.add(
        idToken(this.auth).pipe(
          map(() => this.auth.currentUser?.uid ?? null),
          distinctUntilChanged(),
          tap(uid => this.log('info', 'af.idToken', 'angularfire.idToken$ changed →', { uid })),
          catchError(err => this.handle('AuthDebugService: falha no angularfire.idToken()', err))
        ).subscribe()
      );

      // 2) SDK nativo onIdTokenChanged (logar somente quando UID muda)
      this.offIdTokenChanged = onIdTokenChanged(
        this.auth as unknown as FirebaseAuth,
        (u) => {
          const uid = u?.uid ?? null;

          // Patch opt-in: só aplica se você realmente quiser caçar chamadas de token
          if (u) this.patchTokenMethodsIfEnabled(u);

          if (uid !== this.lastNativeUid) {
            this.lastNativeUid = uid;
            this.log('info', 'sdk.onIdTokenChanged', 'firebase.onIdTokenChanged(cb) →', uid ? { uid } : null);
          } else {
            // Se estiver “batendo” várias vezes com mesmo uid, só loga em modo debug (e com rate-limit).
            this.logOnce('debug', 'sdk.onIdTokenChanged.sameUid', 2000,
              'firebase.onIdTokenChanged (same uid) →', uid ? { uid } : null
            );
          }
        },
        (err) => this.handle('AuthDebugService: firebase.onIdTokenChanged error', err).subscribe()
      );

      // 3) AuthSessionService uid$ (sua fonte de verdade no app)
      this.subs.add(
        this.authSession.uid$.pipe(
          distinctUntilChanged(),
          tap(uid => this.log('info', 'session.uid', 'authSession.uid$ →', { uid })),
          catchError(err => this.handle('AuthDebugService: falha no authSession.uid$', err))
        ).subscribe()
      );

      // 4) NgRx selectors
      const storeUid$ = this.store.select(selectAuthUid).pipe(distinctUntilChanged());
      const storeReady$ = this.store.select(selectAuthReady).pipe(distinctUntilChanged());
      const storeVerified$ = this.store.select(selectAuthEmailVerified).pipe(distinctUntilChanged());
      const storeAuthed$ = this.store.select(selectIsAuthenticated).pipe(distinctUntilChanged());

      this.subs.add(storeReady$.subscribe(ready => this.log('info', 'ngrx.ready', 'ngrx.auth.ready →', ready)));
      this.subs.add(storeAuthed$.subscribe(isAuth => this.log('info', 'ngrx.authed', 'ngrx.auth.isAuthenticated →', isAuth)));
      this.subs.add(storeUid$.subscribe(uid => this.log('info', 'ngrx.uid', 'ngrx.auth.userId(uid) →', uid)));
      this.subs.add(storeVerified$.subscribe(v => this.log('info', 'ngrx.verified', 'ngrx.auth.emailVerified →', v)));

      // 5) Cross-check: AuthSession vs NgRx
      // Evita falsos positivos na transição imediata após login
      const sessionReady$ = defer(() => from(this.authSession.whenReady())).pipe(
        map(() => true),
        startWith(false),
        shareReplay({ bufferSize: 1, refCount: true })
      );

      const cross$ = combineLatest({
        sessionReady: sessionReady$,
        sessionUid: this.authSession.uid$.pipe(distinctUntilChanged()),
        ngrxReady: storeReady$,
        ngrxAuthed: storeAuthed$.pipe(auditTime(0)),
        ngrxUid: storeUid$.pipe(auditTime(0)),
      }).pipe(
        filter(({ sessionReady, ngrxReady }) => sessionReady === true && ngrxReady === true),
        debounceTime(25),
        map(({ sessionUid, ngrxUid, ngrxAuthed }) => ({
          sessionUid: sessionUid ?? null,
          ngrxUid: ngrxUid ?? null,
          ngrxAuthed,
        })),
        // estado transitório esperado: sessionUid já existe, mas ngrx ainda não atualizou
        filter(({ sessionUid, ngrxAuthed, ngrxUid }) => !(!!sessionUid && !ngrxAuthed && !ngrxUid)),
        distinctUntilChanged((a, b) =>
          a.sessionUid === b.sessionUid && a.ngrxUid === b.ngrxUid && a.ngrxAuthed === b.ngrxAuthed
        ),
        tap(({ sessionUid, ngrxUid, ngrxAuthed }) => {
          if (sessionUid !== ngrxUid) {
            this.log('warn', 'cross.uidMismatch', 'UID MISMATCH (session vs ngrx)', { sessionUid, ngrxUid, ngrxAuthed });
          }
        }),
        catchError(err => this.handle('AuthDebugService: falha no cross-check uid', err))
      );

      this.subs.add(cross$.subscribe());
    });
  }

  /** Para tudo (idempotente). */
  stop(): void {
    if (!this.started) return;

    this.subs.unsubscribe();
    this.subs = new Subscription();

    try { this.offIdTokenChanged?.(); } catch { /* noop */ }
    this.offIdTokenChanged = undefined;

    this.started = false;
  }

  // ----------------------------
  // Internals
  // ----------------------------

  private readConfig() {
    const hasWindow = typeof window !== 'undefined';

    const level = (hasWindow ? (localStorage.getItem('AUTH_DEBUG_LEVEL') as LogLevel) : null) ?? 'info';
    const traceTokens = hasWindow ? localStorage.getItem('AUTH_DEBUG_TRACE_TOKENS') === '1' : false;
    const traceStack = hasWindow ? localStorage.getItem('AUTH_DEBUG_TRACE_STACK') === '1' : false;

    return {
      level,
      traceTokens,
      traceStack,
      // rate-limit padrão (ms) para logs “repetitivos”
      spamMs: 2000,
      // rate-limit específico do trace de token (ms)
      tokenTraceMs: 5000,
      // quantas linhas do stack imprimir (quando habilitado)
      stackLines: 12,
    };
  }

  private handle(context: string, err: unknown) {
    // Centraliza no GlobalErrorHandlerService (como você já vem fazendo no app)
    const e = err instanceof Error ? err : new Error(context);
    this.globalErrorHandler.handleError(e);
    return EMPTY;
  }

  private canLog(level: LogLevel): boolean {
    const order: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
    return order[level] >= order[this.cfg.level];
  }

  private log(level: LogLevel, key: string, ...args: any[]): void {
    if (!this.canLog(level)) return;

    // Em produção, normalmente nem chamar start(); mas mesmo assim, segurança:
    // (deixar para você controlar via environment)
    // Aqui só faz log.
    const prefix = `[AUTH][${ts()}]`;

    switch (level) {
      case 'debug': console.debug(prefix, ...args); break;
      case 'info': console.log(prefix, ...args); break;
      case 'warn': console.warn(prefix, ...args); break;
      case 'error': console.error(prefix, ...args); break;
    }
  }

  private logOnce(level: LogLevel, key: string, ms: number, ...args: any[]): void {
    if (!this.canLog(level)) return;

    const now = Date.now();
    const last = this.lastLogAt.get(key) ?? 0;
    if (now - last < ms) return;

    this.lastLogAt.set(key, now);
    this.log(level, key, ...args);
  }

  /**
   * PATCH OPT-IN:
   * Intercepta getIdToken/getIdTokenResult para descobrir QUEM está pedindo token.
   * Isso é extremamente verboso se stack estiver ligado.
   * Por padrão fica desligado. Use localStorage para habilitar.
   */
  private patchTokenMethodsIfEnabled(u: FirebaseUser): void {
    if (!this.cfg.traceTokens) return;
    if (this.patchedUsers.has(u)) return;

    this.patchedUsers.add(u);

    const origGetIdToken = u.getIdToken.bind(u);
    const origGetIdTokenResult = u.getIdTokenResult.bind(u);

    u.getIdToken = (forceRefresh?: boolean) => {
      // Loga com rate-limit (não a cada chamada)
      this.logOnce(
        'debug',
        'trace.getIdToken',
        this.cfg.tokenTraceMs,
        `getIdToken(forceRefresh=${!!forceRefresh}) chamado`
      );

      if (this.cfg.traceStack) {
        this.printStackOnce('trace.getIdToken.stack', this.cfg.tokenTraceMs);
      }

      return origGetIdToken(forceRefresh);
    };

    u.getIdTokenResult = (forceRefresh?: boolean) => {
      this.logOnce(
        'debug',
        'trace.getIdTokenResult',
        this.cfg.tokenTraceMs,
        `getIdTokenResult(forceRefresh=${!!forceRefresh}) chamado`
      );

      if (this.cfg.traceStack) {
        this.printStackOnce('trace.getIdTokenResult.stack', this.cfg.tokenTraceMs);
      }

      return origGetIdTokenResult(forceRefresh);
    };
  }

  private printStackOnce(key: string, ms: number): void {
    const now = Date.now();
    const last = this.lastLogAt.get(key) ?? 0;
    if (now - last < ms) return;

    this.lastLogAt.set(key, now);

    // Limita tamanho do stack para não “explodir” o console
    const stack = (new Error('[AUTH] stack')).stack?.split('\n') ?? [];
    const limited = stack.slice(0, this.cfg.stackLines).join('\n');
    console.log(limited);
  }
}
