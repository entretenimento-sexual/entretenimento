// src/app/core/services/autentication/auth/auth-orchestrator.service.ts
import { Injectable, Inject } from '@angular/core';
import { Router } from '@angular/router';
import { of, Subscription } from 'rxjs';
import { filter, switchMap, scan, take } from 'rxjs/operators';

import { AuthSessionService } from './auth-session.service';
import { FirestoreUserQueryService } from '@core/services/data-handling/firestore-user-query.service';
import { CurrentUserStoreService } from './current-user-store.service';

import { FIREBASE_AUTH } from '@core/firebase/firebase.tokens';
import { signOut, type Auth } from 'firebase/auth';
import { doc, onSnapshot,  getDocFromServer, // ✅ confirma no servidor (sem cache)
         type Unsubscribe as FsUnsub } from 'firebase/firestore';
import { FirestoreService } from '../../data-handling/firestore.service';

type TerminateReason =
  | 'deleted'
  | 'suspended'
  | 'auth-invalid'
  | 'doc-missing-confirmed'
  | 'forbidden'; // 🔸 regras Firestore / permission-denied

@Injectable({ providedIn: 'root' })
export class AuthOrchestratorService {
  private authKeepAliveTimer: any = null;
  private docUnsub: FsUnsub | null = null;
  private deletedSub: Subscription | null = null;
  private terminating = false;

  // Janela de graça e “já vi o doc existir”
  private freshUntil = 0;          // timestamp (ms)
  private sawUserDocOnce = false;  // true assim que o doc existir em algum momento
  private missingDocProbe?: any;   // timeout para rechecagem

  // Evita múltiplas inicializações acidentais
  private started = false;

  constructor(
    private authSession: AuthSessionService,
    private userQuery: FirestoreUserQueryService,
    private currentUserStore: CurrentUserStoreService,
    private router: Router,
    private firestoreService: FirestoreService,
    @Inject(FIREBASE_AUTH) private auth: Auth
  ) { }

  /** Inicia watchers – chame no AppComponent ngOnInit (idempotente). */
  start(): void {
    if (this.started) return; // 🚦 idempotente
    this.started = true;

    this.authSession.authUser$
      .pipe(
        // SSR-safe
        filter(() => typeof window !== 'undefined' && typeof document !== 'undefined'),
        switchMap(u => {
          // limpar estado/watchers da sessão anterior
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

          // 🎯 Graça híbrida:
          // - usuários novos (creationTime recente): ~30s
          // - usuários antigos: pelo menos 6s no login
          const now = Date.now();
          const createdAt = u.metadata?.creationTime
            ? new Date(u.metadata.creationTime).getTime()
            : now;
          const graceNewUser = createdAt + 30_000;
          const graceAnyLogin = now + 6_000;
          this.freshUntil = Math.max(graceNewUser, graceAnyLogin);

          // 1) Watcher direto no doc (existe/suspenso/deletado soft)
          this.watchUserDoc(u.uid);

          // 2) Keep-alive do Auth (user disabled/deleted no Console)
          this.startKeepAlive();

          // 3) Watcher “redundante” (doc ausente) com scan + confirmação
          this.watchUserDocDeleted(u.uid);

          return of(null);
        })
      )
      .subscribe();
  }

  // ---------------- helpers ----------------
  private inRegistrationFlow(url: string): boolean {
    // cobre /register e subrotas (inclui welcome), e handlers do e-mail
    return /^\/(register(\/|$)|__\/auth\/action|post-verification\/action)/.test(url || '');
  }

  // Confirma se o users/{uid} segue ausente após pequena espera (server-first)
  private async confirmUserDocMissing(uid: string, delayMs = 1200): Promise<boolean> {
    if (this.missingDocProbe) { clearTimeout(this.missingDocProbe); this.missingDocProbe = undefined; }

    // Se offline, não confirmamos ausência
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;

    await new Promise(res => this.missingDocProbe = setTimeout(res, delayMs));
    try {
      const db = this.firestoreService.getFirestoreInstance();
      // tenta do servidor; se indisponível, cai no catch e não confirma ausência
      const again = await getDocFromServer(doc(db, 'users', uid));
      return !again.exists();
    } catch {
      // Falha de rede/servidor: não confirmar “missing”
      return false;
    }
  }

  private async confirmAndSignOutIfMissing(uid: string, reason: Extract<TerminateReason, 'deleted' | 'doc-missing-confirmed'>) {
    const allowAct = this.sawUserDocOnce || Date.now() > this.freshUntil;
    if (!allowAct) return; // ainda em graça
    const stillMissing = await this.confirmUserDocMissing(uid);
    if (stillMissing) this.hardSignOutToEntry(reason);
  }

  // ---------------- Firestore doc watcher ----------------
  private watchUserDoc(uid: string): void {
    const db = this.firestoreService.getFirestoreInstance();
    const ref = doc(db, 'users', uid);

    this.docUnsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          // Não derruba de imediato: confirma ausência
          this.confirmAndSignOutIfMissing(uid, 'doc-missing-confirmed');
          return;
        }

        // Doc existe
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
      (err: any) => {
        // 🔐 Erros do snapshot: trate os relevantes
        const code = (err?.code || '').toString();
        // permission-denied: regras bloqueando leitura do próprio doc
        if (code === 'permission-denied') {
          this.hardSignOutToEntry('forbidden'); // mapeie no welcome
          return;
        }
        // unavailable / network: ignore (não derruba), os watchers continuam
        // outros erros → silencioso para não travar navegação
      }
    );
  }

  private unwatchUserDoc(): void {
    if (this.docUnsub) { this.docUnsub(); this.docUnsub = null; }
  }

  // ---------------- Serviço extra (doc ausente) ----------------
  private watchUserDocDeleted(uid: string): void {
    this.deletedSub = this.userQuery.watchUserDocDeleted$(uid)
      .pipe(
        // Gatilho único respeitando graça + sawOnce
        scan(
          (state, deleted) => {
            if (state.fired) return state; // já disparamos
            const allowAct = this.sawUserDocOnce || Date.now() > this.freshUntil;
            const shouldFire = deleted && allowAct;
            return { fired: shouldFire || state.fired };
          },
          { fired: false as boolean }
        ),
        take(1)
      )
      .subscribe(() => {
        // Confirmar antes de derrubar
        this.confirmAndSignOutIfMissing(uid, 'deleted');
      });
  }

  private unwatchDeleted(): void {
    if (this.deletedSub) { this.deletedSub.unsubscribe(); this.deletedSub = null; }
  }

  // ---------------- AUTH keep-alive ----------------
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

  // ---------------- Encerramento comum → bem-comportado ----------------
  /** Nunca envia para /login; leva para /register/welcome com motivo. */
  private hardSignOutToEntry(reason: TerminateReason): void {
    if (this.terminating) return;
    this.terminating = true;

    this.stopKeepAlive();
    this.unwatchUserDoc();
    this.unwatchDeleted();
    if (this.missingDocProbe) { clearTimeout(this.missingDocProbe); this.missingDocProbe = undefined; }

    signOut(this.auth).finally(() => {
      this.currentUserStore.clear();

      // Se já está em telas de registro, mantenha nelas; senão vá ao welcome
      const url = this.router.url || '';
      if (!this.inRegistrationFlow(url)) {
        this.router.navigate(['/register/welcome'], {
          queryParams: { reason, autocheck: '1' },
          replaceUrl: true,
        }).finally(() => (this.terminating = false));
        return;
      }

      // Permite que o feedback local (welcome) informe o usuário
      this.terminating = false;
    });
  }
}
