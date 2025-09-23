// src/app/header/guest-banner/guest-banner.component.ts
import { Component, OnInit, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable, firstValueFrom } from 'rxjs';
import { AppState } from 'src/app/store/states/app.state';
import { selectCurrentUser } from 'src/app/store/selectors/selectors.user/user.selectors';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { EmailVerificationService } from 'src/app/core/services/autentication/register/email-verification.service';
import { AuthService } from 'src/app/core/services/autentication/auth.service';

@Component({
  selector: 'app-guest-banner',
  templateUrl: './guest-banner.component.html',
  styleUrls: ['./guest-banner.component.css'],
  standalone: false
})
export class GuestBannerComponent implements OnInit {
  user$: Observable<IUserDados | null>;
  show = signal<boolean>(true);
  isSending = signal<boolean>(false);
  info = signal<string | null>(null);
  error = signal<string | null>(null);

  constructor(
    private store: Store<AppState>,
    private email: EmailVerificationService,
    private auth: AuthService
  ) {
    this.user$ = this.store.select(selectCurrentUser);
  }

  ngOnInit(): void {
    const snooze = localStorage.getItem('banner:verifyEmail:snoozeUntil');
    if (snooze && Date.now() < Number(snooze)) this.show.set(false);
  }

  isVisitor(u: IUserDados | null): boolean {
    return !u || !u.uid;
  }

  isUnverified(u: IUserDados | null): boolean {
    return !!u && !!u.uid && u.emailVerified !== true;
  }

  async resend(): Promise<void> {
    this.isSending.set(true);
    this.error.set(null);
    this.info.set(null);
    try {
      const msg = await firstValueFrom(this.email.resendVerificationEmail());
      this.info.set(msg ?? 'E-mail enviado. Verifique sua caixa de entrada.');
    } catch (e: any) {
      this.error.set(e?.message ?? 'Não foi possível reenviar agora.');
    } finally {
      this.isSending.set(false);
    }
  }

  async iAlreadyVerified(): Promise<void> {
    this.isSending.set(true);
    this.error.set(null);
    try {
      const ok = await firstValueFrom(this.email.reloadCurrentUser());
      if (ok) {
        const uid = await firstValueFrom(this.email.getCurrentUserUid());
        if (uid) {
          await firstValueFrom(this.email.updateEmailVerificationStatus(uid, true)).catch(() => { });
        }
        this.info.set('Obrigado! Atualizamos seu status.');
        setTimeout(() => location.reload(), 500);
      } else {
        this.error.set('Ainda não conseguimos confirmar a verificação. Tente novamente em instantes.');
      }
    } finally {
      this.isSending.set(false);
    }
  }

  snoozeOneDay(): void {
    const until = Date.now() + 24 * 60 * 60 * 1000;
    localStorage.setItem('banner:verifyEmail:snoozeUntil', String(until));
    this.show.set(false);
  }
}
