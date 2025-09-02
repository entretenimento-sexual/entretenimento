// src/app/authentication/register-module/welcome/welcome.component.ts
import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';

import { Auth } from '@angular/fire/auth';
import { Timestamp, doc, setDoc } from '@angular/fire/firestore';

import { firstValueFrom } from 'rxjs';

import { EmailVerificationService } from 'src/app/core/services/autentication/register/email-verification.service';
import { FirestoreService } from 'src/app/core/services/data-handling/firestore.service';
import { ValidGenders } from 'src/app/core/enums/valid-genders.enum';
import { ValidPreferences } from 'src/app/core/enums/valid-preferences.enum';

@Component({
  selector: 'app-welcome',
  templateUrl: './welcome.component.html',
  styleUrls: ['./welcome.component.css'],
  standalone: false
})
export class WelcomeComponent implements OnInit, OnDestroy {
  busy = false;
  savingOptional = false;
  message = '';
  emailVerified = false;
  email: string | null = null;

  validGenders = Object.values(ValidGenders);
  validPreferences = Object.values(ValidPreferences);

  selectedGender = '';
  selectedPreferencesMap: Record<string, boolean> = {};

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pollTries = 0;

  constructor(
    private emailVerificationService: EmailVerificationService,
    private firestore: FirestoreService,
    private router: Router,
    private route: ActivatedRoute,
    private auth: Auth // ✅ injeta a instância do Auth (AngularFire)
  ) { }

  ngOnInit(): void {
    const u = this.auth.currentUser;
    this.email = u?.email ?? null;
    this.emailVerified = !!u?.emailVerified;

    const autoCheck = this.route.snapshot.queryParamMap.get('autocheck') === '1';
    if (autoCheck || !this.emailVerified) {
      this.startPolling();
    }
  }

  ngOnDestroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  /** Recarrega o usuário e sincroniza o emailVerified no Firestore quando virar true */
  private async reloadAndSync(): Promise<boolean> {
    const u = this.auth.currentUser;
    if (!u) return false;

    await u.reload();
    this.emailVerified = !!u.emailVerified;

    if (this.emailVerified && u.uid) {
      await firstValueFrom(this.emailVerificationService.updateEmailVerificationStatus(u.uid, true));
      this.message = 'E-mail verificado com sucesso!';
    }
    return this.emailVerified;
  }

  /** Botão: "Já verifiquei — checar agora" */
  async checkNow(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.reloadAndSync();
      if (!this.emailVerified) {
        this.message = 'Ainda não encontramos a verificação. Tente novamente em alguns segundos.';
      }
    } finally {
      this.busy = false;
    }
  }

  /** Botão: "Reenviar e-mail" */
  resendVerificationEmail(): void {
    if (this.busy) return;
    this.busy = true;
    this.emailVerificationService.resendVerificationEmail().subscribe({
      next: msg => this.message = msg || 'E-mail reenviado. Confira sua caixa de entrada e spam.',
      error: (err: any) => {
        const code = err?.code || '';
        if (code === 'auth/too-many-requests') this.message = 'Muitas tentativas. Aguarde alguns minutos e tente de novo.';
        else if (code === 'auth/quota-exceeded') this.message = 'Limite de envio atingido temporariamente. Tente novamente mais tarde.';
        else this.message = 'Erro ao reenviar o e-mail. Tente novamente.';
      },
      complete: () => this.busy = false
    });
  }

  /** Continuar sem verificar (não bloqueia) */
  proceedToDashboard(): void {
    const redirectTo = this.route.snapshot.queryParamMap.get('redirectTo') || '/dashboard/principal';
    this.router.navigateByUrl(redirectTo).then(ok => {
      if (!ok) this.router.navigate(['/dashboard/principal']);
    }).catch(() => {
      this.router.navigate(['/dashboard/principal']);
    });
  }

  /** Salva dados opcionais (se o usuário quiser adiantar) */
  async saveOptionalProfile(): Promise<void> {
    const uid = this.auth.currentUser?.uid;
    if (!uid) return;

    const selectedPreferences = Object.entries(this.selectedPreferencesMap)
      .filter(([_, ok]) => ok)
      .map(([k]) => k);

    this.savingOptional = true;
    try {
      const db = this.firestore.getFirestoreInstance();
      await setDoc(
        doc(db, 'user_profile', uid),
        {
          gender: this.selectedGender || null,
          preferences: selectedPreferences,
          updatedAt: Timestamp.now()
        },
        { merge: true }
      );
      this.message = 'Preferências salvas.';
    } catch {
      this.message = 'Não foi possível salvar suas preferências agora.';
    } finally {
      this.savingOptional = false;
    }
  }

  /** Polling leve (até ~30s) para detectar verificação sem recarregar a página */
  private startPolling(): void {
    if (this.pollTimer) return;
    this.pollTries = 0;
    this.pollTimer = setInterval(async () => {
      this.pollTries++;
      await this.reloadAndSync();
      if (this.emailVerified || this.pollTries >= 8) {
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
}
