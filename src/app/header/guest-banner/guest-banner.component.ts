// src/app/header/guest-banner/guest-banner.component.ts
// Banner somente para usuários autenticados com e-mail ainda não verificado.
// - Não exibe CTA para visitante.
// - “Soneca” por 24h via localStorage.
// - Observable-first.
// - Força refresh do token ao confirmar verificação para atualizar claim email_verified.

import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { Auth } from '@angular/fire/auth';
import { EMPTY, Observable, defer, from, of } from 'rxjs';
import { catchError, finalize, map, shareReplay, switchMap, take, tap } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AppState } from 'src/app/store/states/app.state';
import { selectCurrentUser } from 'src/app/store/selectors/selectors.user/user.selectors';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { EmailVerificationService } from 'src/app/core/services/autentication/register/email-verification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

const SNOOZE_KEY = 'banner:verifyEmail:snoozeUntil';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

@Component({
  selector: 'app-guest-banner',
  templateUrl: './guest-banner.component.html',
  styleUrls: ['./guest-banner.component.css'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GuestBannerComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);

  private readonly auth = inject(Auth);
  private readonly store = inject<Store<AppState>>(Store as any);
  private readonly email = inject(EmailVerificationService);
  private readonly globalError = inject(GlobalErrorHandlerService);

  readonly user$: Observable<IUserDados | null> = this.store.select(selectCurrentUser).pipe(
    map((user) => user ?? null),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly show = signal<boolean>(false);
  readonly isSending = signal<boolean>(false);
  readonly info = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.user$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((u) => {
        if (!u?.uid) {
          this.show.set(false);
          return;
        }

        if (u.emailVerified === true) {
          this.show.set(false);
          this.safeLocalStorageRemove(SNOOZE_KEY);
          return;
        }

        this.show.set(!this.hasActiveSnooze());
      });
  }

  isUnverified(u: IUserDados | null): boolean {
    return !!u?.uid && u.emailVerified !== true;
  }

  resend(): void {
    this.isSending.set(true);
    this.error.set(null);
    this.info.set(null);

    this.email.resendVerificationEmail()
      .pipe(
        take(1),
        tap((msg) => this.info.set(msg ?? 'E-mail enviado. Verifique sua caixa de entrada.')),
        catchError((err) => {
          this.report(err, 'GuestBannerComponent.resend');
          this.error.set(this.pickMessage(err, 'Não foi possível reenviar agora.'));
          return EMPTY;
        }),
        finalize(() => this.isSending.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  iAlreadyVerified(): void {
    this.isSending.set(true);
    this.error.set(null);
    this.info.set(null);

    this.email.reloadCurrentUser()
      .pipe(
        take(1),
        switchMap((ok) => {
          if (!ok) return of(false);

          return this.forceRefreshIdToken$().pipe(
            switchMap(() => this.email.getCurrentUserUid().pipe(take(1))),
            switchMap((uid) => {
              if (!uid) return of(true);

              return this.email.updateEmailVerificationStatus(uid, true).pipe(
                map(() => true),
                catchError((err) => {
                  this.report(err, 'GuestBannerComponent.updateEmailVerificationStatus', true);
                  return of(true);
                })
              );
            }),
            map(() => true)
          );
        }),
        tap((ok) => {
          if (ok) {
            this.info.set('Obrigado! Atualizamos seu status.');
            this.safeLocalStorageRemove(SNOOZE_KEY);
            this.show.set(false);
          } else {
            this.error.set('Ainda não conseguimos confirmar a verificação. Tente novamente em instantes.');
          }
        }),
        catchError((err) => {
          this.report(err, 'GuestBannerComponent.iAlreadyVerified');
          this.error.set(this.pickMessage(err, 'Não foi possível confirmar agora.'));
          return EMPTY;
        }),
        finalize(() => this.isSending.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  snoozeOneDay(): void {
    const until = Date.now() + ONE_DAY_MS;
    this.safeLocalStorageSet(SNOOZE_KEY, String(until));
    this.show.set(false);
  }

  private forceRefreshIdToken$(): Observable<void> {
    return defer(() => {
      const u = this.auth.currentUser;
      if (!u) return of(void 0);
      return from(u.getIdToken(true)).pipe(map(() => void 0));
    });
  }

  private hasActiveSnooze(): boolean {
    const snoozeRaw = this.safeLocalStorageGet(SNOOZE_KEY);
    const snoozeUntil = snoozeRaw ? Number(snoozeRaw) : 0;
    return Number.isFinite(snoozeUntil) && snoozeUntil > Date.now();
  }

  private report(err: unknown, context: string, silent = true): void {
    try {
      const e = err instanceof Error ? err : new Error(String(err ?? 'unknown error'));
      (e as any).silent = silent;
      (e as any).skipUserNotification = true;
      (e as any).context = context;
      (e as any).feature = 'guest-banner';
      (e as any).original = err;
      this.globalError.handleError(e);
    } catch {}
  }

  private pickMessage(err: any, fallback: string): string {
    return typeof err?.message === 'string' && err.message.trim().length
      ? err.message
      : fallback;
  }

  private safeLocalStorageGet(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  private safeLocalStorageSet(key: string, value: string): void {
    try { localStorage.setItem(key, value); } catch {}
  }

  private safeLocalStorageRemove(key: string): void {
    try { localStorage.removeItem(key); } catch {}
  }
}
