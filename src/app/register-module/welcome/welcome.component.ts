// src/app/register-module/welcome/welcome.component.ts
import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';

import { EMPTY, Observable, Subscription, interval, of } from 'rxjs';
import {
  catchError,
  exhaustMap,
  filter,
  finalize,
  map,
  startWith,
  switchMap,
  take,
  tap,
  timeout,
} from 'rxjs/operators';

import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { EmailVerificationService } from 'src/app/core/services/autentication/register/email-verification.service';
import { EmulatorEmailVerifyDevService } from 'src/app/core/services/autentication/register/emulator-email-verify-dev.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { environment } from 'src/environments/environment';

import { RegisterFlowFacade } from '../data-access/register-flow.facade';
import { RegisterFlowVm } from '../data-access/register-flow.model';

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
  standalone: false,
})
export class WelcomeComponent implements OnInit {
  checkingVerification = false;
  resendingVerificationEmail = false;
  markingVerifiedDev = false;
  sessionInvalid = false;

  banner: UiBanner | null = null;
  showTech = false;

  emailVerified = false;
  email: string | null = null;
  lastCheckedAt: Date | null = null;
  profileCompleted = false;
  profileStateLoaded = false;

  private latestVm: RegisterFlowVm | null = null;
  private redirecting = false;
  private pollingSub: Subscription | null = null;
  private pollTries = 0;

  private readonly destroyRef = inject(DestroyRef);
  private readonly ACTION_TIMEOUT_MS = 15_000;

  debugEnabled(): boolean {
    return (
      !environment.production &&
      environment.enableDebugTools === true &&
      typeof localStorage !== 'undefined' &&
      localStorage.getItem('debugRegister') === '1'
    );
  }

  get isDevEmu(): boolean {
    return (
      environment.useEmulators === true &&
      environment.env === 'dev-emu' &&
      this.debugEnabled()
    );
  }

  get busy(): boolean {
    return (
      this.checkingVerification ||
      this.resendingVerificationEmail ||
      this.markingVerifiedDev
    );
  }

  constructor(
    private readonly registerFlow: RegisterFlowFacade,
    private readonly authSession: AuthSessionService,
    private readonly emailVerificationService: EmailVerificationService,
    private readonly router: Router,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly notify: ErrorNotificationService,
    private readonly emulatorEmailVerifyDev: EmulatorEmailVerifyDevService
  ) {}

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => this.stopPolling());

    this.registerFlow.vm$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (vm) => this.applyVm(vm),
        error: (err) => {
          this.sessionInvalid = true;
          this.setBanner(
            'error',
            'Erro ao ler sessão',
            'Tente recarregar a página.',
            err
          );
          this.reportError('WelcomeComponent.registerFlow.vm$', err);
        },
      });
  }

  private applyVm(vm: RegisterFlowVm): void {
    this.latestVm = vm;
    this.email = vm.email;
    this.emailVerified = vm.emailVerified;
    this.profileCompleted = vm.profileCompleted;
    this.profileStateLoaded = vm.userResolved;
    this.sessionInvalid = vm.authReady && !vm.uid;

    if (this.sessionInvalid) {
      this.stopPolling();
      this.setBanner(
        'warn',
        'Sessão não encontrada',
        'Não encontramos uma sessão ativa. Recarregue a página ou refaça o cadastro.'
      );
      return;
    }

    if (vm.currentStep === 'emailVerification') {
      if (!this.banner) {
        this.setBanner(
          'info',
          'Confirme seu e-mail',
          vm.blockingMessage ??
            'Confirme seu e-mail para continuar com segurança.'
        );
      }

      this.startPolling();
      return;
    }

    this.stopPolling();

    if (
      vm.emailVerified &&
      this.router.url.startsWith('/register/welcome')
    ) {
      this.tryAutoRedirectToNextStep();
    }
  }

  markVerifiedDev(): void {
    if (
      !this.isDevEmu ||
      this.markingVerifiedDev ||
      this.checkingVerification ||
      this.resendingVerificationEmail
    ) {
      return;
    }

    this.stopPolling();
    this.markingVerifiedDev = true;

    this.emulatorEmailVerifyDev
      .markVerifiedInEmulatorDebug$()
      .pipe(
        take(1),
        tap((dbg: any) => {
          this.lastCheckedAt = new Date();

          if (dbg?.after?.emailVerified) {
            this.emailVerified = true;
            this.setBanner(
              'info',
              `DEV OK (trace: ${dbg.traceId})`,
              'O Auth Emulator já marcou o e-mail como verificado. Finalizando a sincronização no app…',
              dbg
            );
          }
        }),
        switchMap((dbg: any) =>
          this.reloadAndSync$().pipe(
            take(1),
            timeout({ first: this.ACTION_TIMEOUT_MS }),
            map((syncedOk) => ({ dbg, syncedOk })),
            catchError((err) =>
              of({ dbg, syncedOk: false, syncError: err })
            )
          )
        ),
        tap(({ dbg, syncedOk, syncError }: any) => {
          const details = {
            traceId: dbg?.traceId,
            okAuth: dbg?.after?.emailVerified === true,
            okSync: syncedOk,
            uid: dbg?.uid,
            email: dbg?.email,
            syncError: syncError ?? undefined,
          };

          if (dbg?.after?.emailVerified) {
            this.emailVerified = true;
            this.setBanner(
              syncedOk ? 'success' : 'info',
              syncedOk
                ? `DEV OK (trace: ${dbg.traceId})`
                : `DEV parcial (trace: ${dbg.traceId})`,
              syncedOk
                ? 'E-mail verificado no Auth Emulator e sincronizado no app.'
                : 'O Auth já está verificado. A sincronização final ainda está propagando, mas você já pode seguir o fluxo.',
              details
            );

            this.tryAutoRedirectToNextStep();
            return;
          }

          this.emailVerified = false;
          this.setBanner(
            'warn',
            `DEV não verificou${dbg?.traceId ? ` (trace: ${dbg.traceId})` : ''}`,
            dbg?.note ??
              'Não foi possível aplicar a verificação no emulador.',
            details
          );
          this.restartPolling();
        }),
        catchError((err) => {
          this.setBanner(
            'error',
            'DEV erro',
            'Falha ao marcar como verificado no emulador.',
            err
          );
          this.reportError(
            'WelcomeComponent.markVerifiedDev',
            err,
            true
          );
          return of(void 0);
        }),
        finalize(() => {
          this.markingVerifiedDev = false;
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  checkNow(): void {
    if (
      this.checkingVerification ||
      this.resendingVerificationEmail ||
      this.markingVerifiedDev
    ) {
      return;
    }

    this.stopPolling();
    this.checkingVerification = true;

    this.reloadAndSync$()
      .pipe(
        take(1),
        tap((ok) => {
          if (ok) {
            this.setBanner(
              'success',
              'E-mail verificado com sucesso!',
              'Sua conta foi validada. Vamos continuar para a próxima etapa.'
            );
            this.tryAutoRedirectToNextStep();
            return;
          }

          this.setBanner(
            'info',
            'Ainda não encontramos a verificação',
            'Tente novamente em alguns segundos. Se preferir, reenvie o e-mail.'
          );
          this.restartPolling();
        }),
        finalize(() => {
          this.checkingVerification = false;
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  resendVerificationEmail(): void {
    if (
      this.resendingVerificationEmail ||
      this.checkingVerification ||
      this.markingVerifiedDev
    ) {
      return;
    }

    this.stopPolling();
    this.resendingVerificationEmail = true;

    this.emailVerificationService
      .resendVerificationEmail()
      .pipe(
        take(1),
        timeout({ first: this.ACTION_TIMEOUT_MS }),
        tap((msg) => {
          this.setBanner(
            'info',
            'E-mail reenviado',
            msg || 'Confira sua caixa de entrada e spam.'
          );

          if (!this.emailVerified && !this.sessionInvalid) {
            this.restartPolling();
          }
        }),
        catchError((err: any) => {
          const code = err?.code || '';

          if (code === 'auth/too-many-requests') {
            this.setBanner(
              'warn',
              'Muitas tentativas',
              'Aguarde alguns minutos e tente novamente.',
              err
            );
          } else if (code === 'auth/quota-exceeded') {
            this.setBanner(
              'warn',
              'Limite de envio atingido',
              'Tente novamente mais tarde.',
              err
            );
          } else {
            this.setBanner(
              'error',
              'Erro ao reenviar o e-mail',
              'Tente novamente em instantes.',
              err
            );
          }

          this.reportError(
            'WelcomeComponent.resendVerificationEmail',
            err
          );
          return EMPTY;
        }),
        finalize(() => {
          this.resendingVerificationEmail = false;
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  continueToPreferences(): void {
    const vm = this.latestVm;

    if (!vm?.uid) {
      this.setBanner(
        'warn',
        'Sessão não encontrada',
        'Não foi possível identificar sua conta para continuar.'
      );
      return;
    }

    if (!this.emailVerified && !vm.emailVerified) {
      this.setBanner(
        'info',
        'E-mail ainda não verificado',
        'Confirme seu e-mail antes de continuar.'
      );
      return;
    }

    if (!vm.userResolved) {
      this.setBanner(
        'info',
        'Carregando perfil',
        'Ainda estamos confirmando o estado do seu cadastro. Tente novamente em instantes.'
      );
      return;
    }

    this.navigateToFlowRoute(vm);
  }

  proceedToDashboard(): void {
    this.continueToPreferences();
  }

  private reloadAndSync$(): Observable<boolean> {
    return this.authSession.refreshCurrentUser$().pipe(
      timeout({ first: this.ACTION_TIMEOUT_MS }),
      switchMap((user) => {
        this.lastCheckedAt = new Date();
        this.email = user?.email ?? this.email ?? null;
        this.emailVerified = user?.emailVerified === true;

        if (!user?.uid) {
          return of(false);
        }

        if (!user.emailVerified) {
          return of(false);
        }

        return this.emailVerificationService
          .updateEmailVerificationStatus(user.uid, true)
          .pipe(
            take(1),
            map(() => true),
            catchError((err) => {
              this.reportError(
                'WelcomeComponent.updateEmailVerificationStatus',
                err,
                true
              );

              return of(true);
            })
          );
      }),
      catchError((err) => {
        this.setBanner(
          'error',
          'Erro ao verificar e-mail',
          'Tente novamente em instantes.',
          err
        );
        this.reportError('WelcomeComponent.reloadAndSync$', err);
        return of(false);
      })
    );
  }

  private tryAutoRedirectToNextStep(): void {
    const vm = this.latestVm;

    if (
      !vm?.uid ||
      this.sessionInvalid ||
      this.redirecting ||
      !this.router.url.startsWith('/register/welcome')
    ) {
      return;
    }

    if (!this.emailVerified && !vm.emailVerified) {
      return;
    }

    if (!vm.userResolved) {
      return;
    }

    this.navigateToFlowRoute(vm);
  }

  private navigateToFlowRoute(vm: RegisterFlowVm): void {
    const target = this.resolveTargetRoute(vm);

    if (
      !target ||
      this.router.url === target ||
      this.router.url.startsWith(target)
    ) {
      return;
    }

    this.redirecting = true;

    this.router
      .navigateByUrl(target, { replaceUrl: true })
      .finally(() => {
        this.redirecting = false;
      });
  }

  private resolveTargetRoute(vm: RegisterFlowVm): string {
    if (vm.currentStep === 'profileCompletion' && vm.uid) {
      return `/register/finalizar-cadastro?reason=profile_incomplete&redirectTo=${encodeURIComponent(`/preferencias/editar/${vm.uid}`)}`;
    }

    return vm.nextRoute;
  }

  private startPolling(): void {
    if (this.pollingSub || this.emailVerified || this.sessionInvalid) {
      return;
    }

    const maxTries = this.isDevEmu ? 30 : 8;
    this.pollTries = 0;

    this.pollingSub = interval(4000)
      .pipe(
        startWith(0),
        filter(
          () =>
            !this.checkingVerification &&
            !this.resendingVerificationEmail &&
            !this.markingVerifiedDev &&
            !this.sessionInvalid &&
            !this.emailVerified
        ),
        exhaustMap(() => this.reloadAndSync$().pipe(take(1))),
        tap((ok) => {
          this.pollTries++;

          if (ok) {
            this.stopPolling();
            this.tryAutoRedirectToNextStep();
            return;
          }

          if (this.pollTries >= maxTries) {
            this.stopPolling();
            this.setBanner(
              'warn',
              'Tempo esgotado',
              'Não conseguimos sincronizar a verificação a tempo. Clique em “Checar agora” em alguns segundos.'
            );
          }
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private stopPolling(): void {
    this.pollingSub?.unsubscribe();
    this.pollingSub = null;
  }

  private restartPolling(): void {
    this.stopPolling();
    this.startPolling();
  }

  private setBanner(
    variant: UiBannerVariant,
    title: string,
    message: string,
    details?: unknown
  ): void {
    let det: string | undefined;

    /**
     * Em produção, detalhes técnicos não entram no estado renderizável da UI.
     * O erro completo continua sendo encaminhado ao handler global.
     */
    if (details !== undefined && this.debugEnabled()) {
      try {
        det = typeof details === 'string'
          ? details
          : JSON.stringify(details, null, 2);
      } catch {
        det = String(details);
      }
    }

    this.banner = { variant, title, message, details: det };
    this.showTech = false;
  }

  toggleTech(): void {
    if (!this.debugEnabled()) return;
    this.showTech = !this.showTech;
  }

  copyDetails(): void {
    if (!this.debugEnabled()) return;

    const det = this.banner?.details;
    if (
      !det ||
      typeof navigator === 'undefined' ||
      !navigator.clipboard
    ) {
      return;
    }

    navigator.clipboard.writeText(det).catch(() => {});
  }

  restartRegistration(): void {
    this.router.navigate(['/register'], { replaceUrl: true });
  }

  reloadPage(): void {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  }

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
      'ig.com.br': 'https://email.ig.com.br',
    };

    const url = map[domain] || '';
    if (url && typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  copyEmail(): void {
    if (
      !this.email ||
      typeof navigator === 'undefined' ||
      !navigator.clipboard
    ) {
      return;
    }

    navigator.clipboard.writeText(this.email).catch(() => {});
  }

  private reportError(
    origin: string,
    err: unknown,
    silentToast: boolean = false
  ): void {
    try {
      const reportable = err instanceof Error
        ? err
        : new Error(`[${origin}] Erro desconhecido.`);

      (reportable as any).context = origin;
      (reportable as any).original = err;
      (reportable as any).skipUserNotification = true;

      this.globalErrorHandler.handleError(reportable);
    } catch {
      // O relatório não pode quebrar o fluxo de verificação.
    }

    if (!silentToast) {
      this.notify.showError('Ocorreu um erro. Tente novamente.');
    }

    if (this.debugEnabled()) {
      console.error(`[${origin}]`, err);
    }
  }
}
