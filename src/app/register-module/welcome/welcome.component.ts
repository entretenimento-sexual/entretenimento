// src/app/authentication/register-module/welcome/welcome.component.ts
import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';

import { firstValueFrom } from 'rxjs';
import { take, tap } from 'rxjs/operators';

import { EmailVerificationService } from 'src/app/core/services/autentication/register/email-verification.service';
// (Se não precisar mais do wrapper, pode remover o FirestoreService do projeto)
import { ValidGenders } from 'src/app/core/enums/valid-genders.enum';
import { ValidPreferences } from 'src/app/core/enums/valid-preferences.enum';

// ✅ AngularFire
import { Auth } from '@angular/fire/auth';
import { Firestore } from '@angular/fire/firestore';
import { onAuthStateChanged, signOut  } from 'firebase/auth';
import { doc, getDoc, onSnapshot, setDoc, Timestamp, Unsubscribe } from 'firebase/firestore';

type UiBannerVariant = 'info' | 'warn' | 'error' | 'success';
type UiBanner = {
  variant: UiBannerVariant;
  title: string;
  message: string;
  details?: string;
};

@Component({
  selector: 'app-welcome',
  templateUrl: './welcome.component.html',
  styleUrls: ['./welcome.component.css'],
  standalone: false
})
export class WelcomeComponent implements OnInit, OnDestroy {
  // estados
  busy = false;
  savingOptional = false;
  sessionInvalid = false;

  // banner robusto
  banner: UiBanner | null = null;
  showTech = false;

  // status
  emailVerified = false;
  email: string | null = null;
  lastCheckedAt: Date | null = null;

  validGenders = Object.values(ValidGenders);
  validPreferences = Object.values(ValidPreferences);

  selectedGender = '';
  selectedPreferencesMap: Record<string, boolean> = {};

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pollTries = 0;
  private unsubscribeAuth: (() => void) | null = null;
  private userDocUnsub: Unsubscribe | null = null;

  constructor(
    private emailVerificationService: EmailVerificationService,
    private router: Router,
    private route: ActivatedRoute,
    // ✅ mesmas instâncias fornecidas no app.module
    private auth: Auth,
    private db: Firestore
  ) { }

  // ---------------- lifecycle ----------------
  ngOnInit(): void {
    const autoCheck = this.route.snapshot.queryParamMap.get('autocheck') === '1';

    this.unsubscribeAuth = onAuthStateChanged(this.auth, (u) => {

      if (!u) {
        this.email = null;
        this.emailVerified = false;
        this.sessionInvalid = true;
        this.setBanner('warn', 'Sessão não encontrada',
          'Não encontramos uma sessão ativa. Você pode tentar reconectar, recarregar a página ou refazer o cadastro.');
        if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
        return;
      }

      this.sessionInvalid = false;
      this.email = u.email ?? null;
      this.emailVerified = !!u.emailVerified;

      const ref = doc(this.db, 'users', u.uid);
      this.userDocUnsub?.();
      this.userDocUnsub = onSnapshot(ref, (snap) => {
        if (!snap.exists()) {
          this.setBanner('warn', 'Conta removida durante o cadastro', 'Você pode refazer o cadastro.');
          signOut(this.auth).finally(() => { this.sessionInvalid = true; });
        }
      }, () => {/* opcional: handler de erro */ });

         if (autoCheck || !this.emailVerified) this.startPolling();
    });
  }

  ngOnDestroy(): void {
    this.userDocUnsub?.(); this.userDocUnsub = null;
    this.unsubscribeAuth?.(); this.unsubscribeAuth = null;

    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  // ---------------- banner helpers ----------------
  private setBanner(variant: UiBannerVariant, title: string, message: string, details?: any) {
    let det: string | undefined = undefined;
    if (details !== undefined) {
      try { det = typeof details === 'string' ? details : JSON.stringify(details, null, 2); }
      catch { det = String(details); }
    }
    this.banner = { variant, title, message, details: det };
    this.showTech = false;
  }

  toggleTech(): void { this.showTech = !this.showTech; }

  copyDetails(): void {
    const det = this.banner?.details;
    if (!det || !navigator?.clipboard) return;
    navigator.clipboard.writeText(det).catch(() => { });
  }

  // CTA: reabrir fluxo de cadastro (sem login)
  restartRegistration(): void {
    this.router.navigate(['/register'], { replaceUrl: true });
  }

  // ---------------- verificação de e-mail ----------------
  private async reloadAndSync(): Promise<boolean> {
    const u = this.auth.currentUser;
    if (!u) return false;

    try { await u.reload(); } catch { /* rede intermitente */ }

    this.emailVerified = !!u.emailVerified;
    this.email = u.email ?? null;
    this.lastCheckedAt = new Date();

    if (this.emailVerified) {
      try {
        await firstValueFrom(this.emailVerificationService.updateEmailVerificationStatus(u.uid, true).pipe(take(1)));
      } catch { /* idempotente */ }
      this.setBanner('success', 'E-mail verificado com sucesso!', 'Você já pode seguir para o painel.');
      return true;
    }

    // Fallback: Firestore já marcou como verificado (ex.: pelo handler)
    try {
      const snap = await getDoc(doc(this.db, 'users', u.uid));
      const fsVerified = snap.exists() && (snap.data() as any)?.emailVerified === true;
      if (fsVerified) {
        this.emailVerified = true;
        this.setBanner('success', 'E-mail verificado (sincronizado)', 'Você já pode seguir para o painel.');
        return true;
      }
    } catch { /* ignore */ }

    return false;
  }

  async checkNow(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const ok = await this.reloadAndSync();
      if (!ok) {
        this.setBanner(
          'info',
          'Ainda não encontramos a verificação',
          'Tente novamente em alguns segundos. Se preferir, reenvie o e-mail.'
        );
        this.restartPolling();
      }
    } finally {
      this.busy = false;
    }
  }

  resendVerificationEmail(): void {
    if (this.busy) return;
    this.busy = true;
    this.emailVerificationService.resendVerificationEmail().pipe(
      tap(() => this.restartPolling())
    ).subscribe({
      next: msg => {
        this.setBanner('info', 'E-mail reenviado', msg || 'Confira sua caixa de entrada e spam.');
      },
      error: (err: any) => {
        const code = err?.code || '';
        if (code === 'auth/too-many-requests') {
          this.setBanner('warn', 'Muitas tentativas', 'Aguarde alguns minutos e tente novamente.', err);
        } else if (code === 'auth/quota-exceeded') {
          this.setBanner('warn', 'Limite de envio atingido', 'Tente novamente mais tarde.', err);
        } else {
          this.setBanner('error', 'Erro ao reenviar o e-mail', 'Tente novamente em instantes.', err);
        }
      },
      complete: () => { this.busy = false; }
    });
  }

  proceedToDashboard(): void {
    const redirectTo = this.route.snapshot.queryParamMap.get('redirectTo') || '/dashboard/principal';
    this.router.navigateByUrl(redirectTo).then(ok => {
      if (!ok) this.router.navigate(['/dashboard/principal']);
    }).catch(() => {
      this.router.navigate(['/dashboard/principal']);
    });
  }

  // ---------------- onboarding opcional ----------------
  async saveOptionalProfile(): Promise<void> {
    const u = this.auth.currentUser;
    const uid = u?.uid;
    if (!uid) {
      this.setBanner('warn', 'Sessão não encontrada', 'Sua sessão não está ativa. Reabra o fluxo de cadastro.');
      this.sessionInvalid = true;
      return;
    }

    const selectedPreferences = Object.entries(this.selectedPreferencesMap)
      .filter(([_, ok]) => ok)
      .map(([k]) => k);

    this.savingOptional = true;
    try {
      await setDoc(
        doc(this.db, 'user_profile', uid),
        {
          gender: this.selectedGender || null,
          preferences: selectedPreferences,
          updatedAt: Timestamp.now()
        },
        { merge: true }
      );
      this.setBanner('success', 'Preferências salvas', 'Tudo certo! Você pode continuar quando quiser.');
    } catch (e) {
      this.setBanner('error', 'Não foi possível salvar suas preferências agora', 'Tente novamente em instantes.', e);
    } finally {
      this.savingOptional = false;
    }
  }

  // ---------------- polling ----------------
  private startPolling(): void {
    if (this.pollTimer) return;
    this.pollTries = 0;
    this.pollTimer = setInterval(async () => {
      this.pollTries++;
      const ok = await this.reloadAndSync();
      if (ok || this.pollTries >= 8) {
        clearInterval(this.pollTimer!);
        this.pollTimer = null;
      }
    }, 4000);
  }

  private restartPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.startPolling();
  }

  reloadPage() {
    window.location.reload();
  }

  // ---------------- utilidades ----------------
  openInbox(): void {
    const mail = this.email || '';
    const domain = (mail.split('@')[1] || '').toLowerCase();
    const map: Record<string, string> = {
      'gmail.com': 'https://mail.google.com',
      'googlemail.com': 'https://mail.google.com',
      'outlook.com': 'https://outlook.live.com/mail',
      'hotmail.com': 'https://outlook.live.com/mail',
      'live.com': 'https://outlook.live.com/mail',
      'msn.com': 'https://outlook.live.com/mail',
      'yahoo.com': 'https://mail.yahoo.com',
      'icloud.com': 'https://www.icloud.com/mail',
      'uol.com.br': 'https://email.uol.com.br/',
      'bol.com.br': 'https://email.bol.uol.com.br/',
      'terra.com.br': 'https://mail.terra.com.br/',
      'ig.com.br': 'https://email.ig.com.br/'
    };
    const url = map[domain] || 'about:blank';
    if (url !== 'about:blank') window.open(url, '_blank', 'noopener,noreferrer');
  }

  copyEmail(): void {
    if (!this.email || !navigator?.clipboard) return;
    navigator.clipboard.writeText(this.email).catch(() => { });
  }
}
