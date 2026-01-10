// src/app/core/services/autentication/auth/auth-orchestrator.service.ts
import { Injectable, Injector, runInInjectionContext } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { combineLatest, firstValueFrom, from, of, Subscription, timer } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  exhaustMap,
  filter,
  map,
  scan,
  startWith,
  switchMap,
  take,
} from 'rxjs/operators';

import { AuthSessionService } from './auth-session.service';
import { FirestoreUserQueryService } from '@core/services/data-handling/firestore-user-query.service';
import { CurrentUserStoreService } from './current-user-store.service';

import { Auth, signOut } from '@angular/fire/auth';
import { doc, docSnapshots, Firestore } from '@angular/fire/firestore';

import { PresenceService } from './presence.service';

// ✅ central error routing
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';

type TerminateReason =
  | 'deleted'
  | 'suspended'
  | 'auth-invalid'
  | 'doc-missing-confirmed'
  | 'forbidden';

@Injectable({ providedIn: 'root' })
export class AuthOrchestratorService {
  // keepAlive era setInterval
  // private authKeepAliveTimer: any = null;

  // ✅ keepAlive RxJS
  private keepAliveSub: Subscription | null = null;

  private docSub: Subscription | null = null;
  private deletedSub: Subscription | null = null;

  private terminating = false;

  private freshUntil = 0;
  private sawUserDocOnce = false;
  private missingDocProbe?: any;

  private started = false;

  // ✅ presence guard
  private presenceUid: string | null = null;

  constructor(
    private authSession: AuthSessionService,
    private userQuery: FirestoreUserQueryService,
    private currentUserStore: CurrentUserStoreService,
    private router: Router,
    private auth: Auth,
    private db: Firestore,
    private injector: Injector,
    private presence: PresenceService,

    // ✅ centralizado
    private globalErrorHandler: GlobalErrorHandlerService,
    private errorNotifier: ErrorNotificationService
  ) { }

  start(): void {
    if (this.started) return;
    this.started = true;

    const url$ = this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(e => e.urlAfterRedirects || e.url),
      startWith(this.router.url || ''),
      distinctUntilChanged()
    );

    combineLatest([this.authSession.authUser$, url$]).pipe(
      filter(() => typeof window !== 'undefined' && typeof document !== 'undefined'),
      switchMap(([u, url]) => {
        // reset watchers/keepAlive (mantive sua estratégia)
        this.stopKeepAlive();
        this.unwatchUserDoc();
        this.unwatchDeleted();

        this.sawUserDocOnce = false;
        this.freshUntil = 0;

        if (this.missingDocProbe) {
          clearTimeout(this.missingDocProbe);
          this.missingDocProbe = undefined;
        }

        // sem user: limpa e para presence
        if (!u) {
          this.currentUserStore.clear();
          this.stopPresenceIfRunning();
          return of(null);
        }

        const now = Date.now();
        const createdAt = u.metadata?.creationTime ? new Date(u.metadata.creationTime).getTime() : now;
        const graceNewUser = createdAt + 30_000;
        const graceAnyLogin = now + 6_000;
        this.freshUntil = Math.max(graceNewUser, graceAnyLogin);

        const inReg = this.inRegistrationFlow(url);
        const unverified = u.emailVerified !== true;

        this.startKeepAlive();

        // ✅ presença só fora do registro e com e-mail verificado
        const shouldRunPresence = !inReg && !unverified;
        this.syncPresence(u.uid, shouldRunPresence);

        if (shouldRunPresence) {
          this.watchUserDoc(u.uid);
          this.watchUserDocDeleted(u.uid);
        } else {
          this.unwatchUserDoc();
          this.unwatchDeleted();
        }

        return of(null);
      }),
      catchError((err) => {
        // Orquestrador nunca deve derrubar a app
        this.reportSilent(err, { phase: 'start.pipeline' });
        return of(null);
      })
    ).subscribe();
  }

  // =========================================================
  // Error routing (central)
  // =========================================================

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

  private notifySessionEnded(reason: TerminateReason): void {
    // evita toast no registro (UX e evita loops)
    const url = this.router.url || '';
    if (this.inRegistrationFlow(url)) return;

    // mensagem genérica (privacy friendly)
    this.errorNotifier.showError('Sua sessão foi encerrada. Faça login novamente.');
    // também registra no global handler
    this.reportSilent(new Error('Session terminated'), { reason });
  }

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

  private stopPresenceIfRunning(): void {
    if (!this.presenceUid) return;
    this.presence.stop();
    this.presenceUid = null;
  }

  private inRegistrationFlow(url: string): boolean {
    return /^\/(register(\/|$)|__\/auth\/action|post-verification\/action)/.test(url || '');
  }

  private confirmUserDocMissing$(uid: string, delayMs = 1200) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return of(false);

    return timer(delayMs).pipe(
      switchMap(() => from(this.userQuery.checkUserExistsFromServer(uid))),
      map(exists => !exists),
      catchError((err) => {
        this.reportSilent(err, { phase: 'confirmUserDocMissing', uid });
        return of(false);
      }),
      take(1)
    );
  }

  private async confirmAndSignOutIfMissing(
    uid: string,
    reason: Extract<TerminateReason, 'deleted' | 'doc-missing-confirmed'>
  ) {
    const allowAct = this.sawUserDocOnce || Date.now() > this.freshUntil;
    if (!allowAct) return;

    const stillMissing = await firstValueFrom(this.confirmUserDocMissing$(uid));
    if (stillMissing) this.hardSignOutToEntry(reason);
  }

  private watchUserDoc(uid: string): void {
    const ref = runInInjectionContext(this.injector, () => doc(this.db, 'users', uid));

    this.docSub = runInInjectionContext(this.injector, () => docSnapshots(ref)).subscribe({
      next: (snap) => {
        if (!snap.exists()) {
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

        if (suspended) this.hardSignOutToEntry('suspended');
        else if (deletedByUser) this.hardSignOutToEntry('deleted');
      },
      error: (err: any) => {
        const code = (err?.code || '').toString();

        // sempre reporta (silent)
        this.reportSilent(err, { phase: 'watchUserDoc', uid, code });

        if (code === 'permission-denied') {
          const url = this.router.url || '';
          if (this.inRegistrationFlow(url)) return;

          const allowAct = this.sawUserDocOnce || Date.now() > this.freshUntil;
          if (!allowAct) return;

          this.hardSignOutToEntry('forbidden');
        }
      }
    });
  }

  private unwatchUserDoc(): void {
    if (this.docSub) {
      this.docSub.unsubscribe();
      this.docSub = null;
    }
  }

  private watchUserDocDeleted(uid: string): void {
    this.deletedSub = this.userQuery.watchUserDocDeleted$(uid).pipe(
      scan((state, deleted) => {
        if (state.fired) return state;

        const allowAct = this.sawUserDocOnce || Date.now() > this.freshUntil;
        const shouldFire = deleted && allowAct;

        return { fired: shouldFire || state.fired };
      }, { fired: false as boolean }),
      take(1)
    ).subscribe({
      next: () => {
        this.confirmAndSignOutIfMissing(uid, 'deleted');
      },
      error: (err) => {
        this.reportSilent(err, { phase: 'watchUserDocDeleted', uid });
      }
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

  private startKeepAlive(): void {
    if (this.keepAliveSub) return;

    // 10 min
    this.keepAliveSub = timer(600_000, 600_000).pipe(
      exhaustMap(() => {
        const u = this.auth.currentUser;
        if (!u) return of(null);

        return from(u.reload()).pipe(
          map(() => null),
          catchError((e: any) => {
            const code = e?.code || '';

            if (
              code === 'auth/user-token-expired' ||
              code === 'auth/user-disabled' ||
              code === 'auth/user-not-found' ||
              code === 'auth/invalid-user-token'
            ) {
              this.hardSignOutToEntry('auth-invalid');
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
    ).subscribe();
  }

  private stopKeepAlive(): void {
    this.keepAliveSub?.unsubscribe();
    this.keepAliveSub = null;
  }

  private hardSignOutToEntry(reason: TerminateReason): void {
    if (this.terminating) return;
    this.terminating = true;

    // toast + global report (comportamento controlado)
    this.notifySessionEnded(reason);

    this.stopKeepAlive();
    this.unwatchUserDoc();
    this.unwatchDeleted();
    this.stopPresenceIfRunning();

    if (this.missingDocProbe) {
      clearTimeout(this.missingDocProbe);
      this.missingDocProbe = undefined;
    }

    signOut(this.auth).finally(() => {
      this.currentUserStore.clear();

      const url = this.router.url || '';
      if (!this.inRegistrationFlow(url)) {
        this.router.navigate(['/register/welcome'], {
          queryParams: { reason, autocheck: '1' },
          replaceUrl: true,
        }).finally(() => (this.terminating = false));
        return;
      }

      this.terminating = false;
    });
  }
}
 /* Linha 378, está grande demais, considerar refatorar em partes menores ou
  buscar realocar métodos para outros serviços mais especializados, mesmo
  que tenha que criar novos e não esquercer que o método logout() do auth.service.ts
  ainda está sendo usado em alguns lugares e precisa ser migrado.
  */
