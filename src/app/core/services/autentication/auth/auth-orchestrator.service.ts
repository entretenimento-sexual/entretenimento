// src/app/core/services/autentication/auth/auth-orchestrator.service.ts
import { Injectable, Injector, runInInjectionContext } from '@angular/core';
import { Router } from '@angular/router';
import { of, Subscription } from 'rxjs';
import { filter, switchMap, scan, take } from 'rxjs/operators';

import { AuthSessionService } from './auth-session.service';
import { FirestoreUserQueryService } from '@core/services/data-handling/firestore-user-query.service';
import { CurrentUserStoreService } from './current-user-store.service';

import { Auth, signOut } from '@angular/fire/auth';
import { doc, docSnapshots, Firestore } from '@angular/fire/firestore';

type TerminateReason =
  | 'deleted'
  | 'suspended'
  | 'auth-invalid'
  | 'doc-missing-confirmed'
  | 'forbidden';

@Injectable({ providedIn: 'root' })
export class AuthOrchestratorService {
  private authKeepAliveTimer: any = null;
  private docSub: Subscription | null = null;
  private deletedSub: Subscription | null = null;
  private terminating = false;

  private freshUntil = 0;
  private sawUserDocOnce = false;
  private missingDocProbe?: any;

  private started = false;

  constructor(
    private authSession: AuthSessionService,
    private userQuery: FirestoreUserQueryService,
    private currentUserStore: CurrentUserStoreService,
    private router: Router,
    private auth: Auth,
    private db: Firestore,
    private injector: Injector
  ) { }

  start(): void {
    if (this.started) return;
    this.started = true;

    this.authSession.authUser$
      .pipe(
        filter(() => typeof window !== 'undefined' && typeof document !== 'undefined'),
        switchMap(u => {
          this.stopKeepAlive();
          this.unwatchUserDoc();
          this.unwatchDeleted();
          this.sawUserDocOnce = false;
          this.freshUntil = 0;
          if (this.missingDocProbe) { clearTimeout(this.missingDocProbe); this.missingDocProbe = undefined; }

          if (!u) {
            this.currentUserStore.clear();
            return of(null);
          }

          const now = Date.now();
          const createdAt = u.metadata?.creationTime ? new Date(u.metadata.creationTime).getTime() : now;
          const graceNewUser = createdAt + 30_000;
          const graceAnyLogin = now + 6_000;
          this.freshUntil = Math.max(graceNewUser, graceAnyLogin);

          this.watchUserDoc(u.uid);
          this.startKeepAlive();
          this.watchUserDocDeleted(u.uid);

          return of(null);
        })
      )
      .subscribe();
  }

  private inRegistrationFlow(url: string): boolean {
    return /^\/(register(\/|$)|__\/auth\/action|post-verification\/action)/.test(url || '');
  }

  private async confirmUserDocMissing(uid: string, delayMs = 1200): Promise<boolean> {
    // Cancela probe anterior, se houver
    if (this.missingDocProbe) {
      clearTimeout(this.missingDocProbe);
      this.missingDocProbe = undefined;
    }

    // Se estiver offline, não confirma como "missing"
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return false;
    }

    // Pequeno atraso para evitar falso positivo logo após login/criação
    await new Promise<void>(res => this.missingDocProbe = setTimeout(res, delayMs));

    try {
      const exists = await this.userQuery.checkUserExistsFromServer(uid);
      return !exists; // true = doc ausente confirmado
    } catch {
      // Em erro de rede/perm, seja conservador: não derruba sessão
      return false;
    }
  }

  private async confirmAndSignOutIfMissing(uid: string, reason: Extract<TerminateReason, 'deleted' | 'doc-missing-confirmed'>) {
    const allowAct = this.sawUserDocOnce || Date.now() > this.freshUntil;
    if (!allowAct) return;
    const stillMissing = await this.confirmUserDocMissing(uid);
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
          data.isSuspended === true || data.isBanned === true ||
          status === 'suspended' || status === 'banned';
        const deletedByUser =
          data.isDeleted === true || !!data.deletedAt || status === 'deleted';

        if (suspended) this.hardSignOutToEntry('suspended');
        else if (deletedByUser) this.hardSignOutToEntry('deleted');
      },
      error: (err: any) => {
        const code = (err?.code || '').toString();
        if (code === 'permission-denied') {
          this.hardSignOutToEntry('forbidden');
          return;
        }
      }
    });
  }

  private unwatchUserDoc(): void {
    if (this.docSub) { this.docSub.unsubscribe(); this.docSub = null; }
  }

  private watchUserDocDeleted(uid: string): void {
    this.deletedSub = this.userQuery.watchUserDocDeleted$(uid)
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
      .subscribe(() => {
        this.confirmAndSignOutIfMissing(uid, 'deleted');
      });
  }

  private unwatchDeleted(): void {
    if (this.deletedSub) { this.deletedSub.unsubscribe(); this.deletedSub = null; }
  }

  private startKeepAlive(): void {
    if (this.authKeepAliveTimer) return;
    this.authKeepAliveTimer = setInterval(async () => {
      const u = this.auth.currentUser;
      if (!u) return;
      try {
        await u.reload();
      } catch (e: any) {
        const code = e?.code || '';
        if (
          code === 'auth/user-token-expired' ||
          code === 'auth/user-disabled' ||
          code === 'auth/user-not-found' ||
          code === 'auth/invalid-user-token'
        ) {
          this.hardSignOutToEntry('auth-invalid');
        }
      }
    }, 30_000);
  }

  private stopKeepAlive(): void {
    if (this.authKeepAliveTimer) {
      clearInterval(this.authKeepAliveTimer);
      this.authKeepAliveTimer = null;
    }
  }

  private hardSignOutToEntry(reason: TerminateReason): void {
    if (this.terminating) return;
    this.terminating = true;

    this.stopKeepAlive();
    this.unwatchUserDoc();
    this.unwatchDeleted();
    if (this.missingDocProbe) { clearTimeout(this.missingDocProbe); this.missingDocProbe = undefined; }

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
