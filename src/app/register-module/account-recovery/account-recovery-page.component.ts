import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';

import { EMPTY, of } from 'rxjs';
import {
  catchError,
  filter,
  finalize,
  map,
  switchMap,
  take,
  timeout,
} from 'rxjs/operators';

import { LogoutService } from 'src/app/core/services/autentication/auth/logout.service';
import { RegistrationRecoveryService } from 'src/app/core/services/autentication/register/registration-recovery.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { RegisterFlowFacade } from '../data-access/register-flow.facade';
import { RegisterFlowVm } from '../data-access/register-flow.model';

type RecoveryStatus = 'working' | 'success' | 'error';

@Component({
  selector: 'app-account-recovery-page',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './account-recovery-page.component.html',
  styleUrls: ['./account-recovery-page.component.css'],
})
export class AccountRecoveryPageComponent implements OnInit {
  private readonly FLOW_RESOLUTION_TIMEOUT_MS = 8_000;

  readonly status = signal<RecoveryStatus>('working');
  readonly isWorking = signal(false);
  readonly message = signal(
    'Estamos reconstruindo os dados básicos da sua conta com segurança.'
  );

  constructor(
    private readonly recovery: RegistrationRecoveryService,
    private readonly registerFlow: RegisterFlowFacade,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly logout: LogoutService,
    private readonly errorNotifier: ErrorNotificationService
  ) {}

  ngOnInit(): void {
    this.recover();
  }

  recover(): void {
    if (this.isWorking()) {
      return;
    }

    this.isWorking.set(true);
    this.status.set('working');
    this.message.set(
      'Estamos reconstruindo os dados básicos da sua conta com segurança.'
    );

    this.recovery.recoverCurrentRegistration$()
      .pipe(
        switchMap(({ user }) =>
          this.registerFlow.vm$.pipe(
            filter(
              (vm) =>
                vm.uid === user.uid &&
                vm.userResolved === true &&
                vm.userExists === true &&
                vm.currentStep !== 'accountRecovery'
            ),
            take(1),
            timeout({
              first: this.FLOW_RESOLUTION_TIMEOUT_MS,
              with: () => of(null as RegisterFlowVm | null),
            }),
            map((vm) => this.resolveNextRoute(vm, user.uid))
          )
        ),
        catchError(() => {
          this.status.set('error');
          this.message.set(
            'Não foi possível recuperar os dados da conta agora. Verifique a conexão e tente novamente.'
          );
          this.errorNotifier.showError(
            'Falha ao recuperar os dados da conta. Tente novamente.'
          );
          return EMPTY;
        }),
        finalize(() => {
          this.isWorking.set(false);
        })
      )
      .subscribe((target) => {
        this.status.set('success');
        this.message.set('Dados recuperados. Continuando seu cadastro…');

        this.router.navigateByUrl(target, { replaceUrl: true }).catch(() => {
          this.status.set('error');
          this.message.set(
            'Os dados foram recuperados, mas não foi possível abrir a próxima etapa.'
          );
        });
      });
  }

  leaveAccount(): void {
    if (this.isWorking()) {
      return;
    }

    this.isWorking.set(true);

    this.logout.logout$()
      .pipe(
        take(1),
        catchError(() => {
          this.errorNotifier.showError(
            'Não foi possível encerrar sua sessão. Tente novamente.'
          );
          return EMPTY;
        }),
        finalize(() => {
          this.isWorking.set(false);
        })
      )
      .subscribe();
  }

  private resolveNextRoute(vm: RegisterFlowVm | null, uid: string): string {
    const redirectTo = this.resolveSafeRedirectTo();
    const preferencesRoute = `/preferencias/editar/${encodeURIComponent(uid)}`;

    if (!vm) {
      return this.buildTermsRoute(redirectTo ?? preferencesRoute);
    }

    switch (vm.currentStep) {
      case 'emailVerification':
        return '/register/welcome?autocheck=1';

      case 'termsAcceptance':
        return this.buildTermsRoute(redirectTo ?? preferencesRoute);

      case 'profileCompletion':
        return this.buildProfileCompletionRoute(
          redirectTo ?? preferencesRoute
        );

      case 'adultConsent':
        return redirectTo
          ? `/adulto/confirmar?redirectTo=${encodeURIComponent(redirectTo)}`
          : '/adulto/confirmar';

      case 'preferences':
        return redirectTo ?? vm.nextRoute ?? preferencesRoute;

      case 'loading':
      case 'signup':
      case 'accountRecovery':
      default:
        return vm.nextRoute && vm.nextRoute !== '/register/recuperar-conta'
          ? vm.nextRoute
          : this.buildTermsRoute(redirectTo ?? preferencesRoute);
    }
  }

  private buildTermsRoute(redirectTo: string): string {
    return `/register/aceitar-termos?redirectTo=${encodeURIComponent(redirectTo)}`;
  }

  private buildProfileCompletionRoute(redirectTo: string): string {
    return `/register/finalizar-cadastro?reason=profile_incomplete&redirectTo=${encodeURIComponent(redirectTo)}`;
  }

  private resolveSafeRedirectTo(): string | null {
    const value = String(
      this.route.snapshot.queryParamMap.get('redirectTo') ?? ''
    ).trim();

    if (
      !value ||
      !value.startsWith('/') ||
      value.startsWith('//') ||
      value.startsWith('/login') ||
      value.startsWith('/register') ||
      value.startsWith('/adulto/confirmar')
    ) {
      return null;
    }

    return value;
  }
}
