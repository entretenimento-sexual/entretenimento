import { CommonModule } from '@angular/common';
import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';

import { EMPTY, defer, of } from 'rxjs';
import {
  catchError,
  filter,
  finalize,
  map,
  switchMap,
  take,
  tap,
  timeout,
} from 'rxjs/operators';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { LogoutService } from 'src/app/core/services/autentication/auth/logout.service';
import { RegistrationRecoveryService } from 'src/app/core/services/autentication/register/registration-recovery.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { RegisterFlowFacade } from '../data-access/register-flow.facade';
import { REGISTRATION_COMPLETION_ROUTE, resolveRegistrationReturnUrl, type RegisterFlowVm } from '../data-access/register-flow.model';
import {
  isRegistrationConfirmationUncertain,
  isRegistrationSessionChange,
  REGISTRATION_ACTION_TIMEOUT_MS,
} from '../data-access/register-action.policy';

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
  private readonly destroyRef = inject(DestroyRef);
  private readonly session = inject(AuthSessionService);
  private readonly errors = inject(ApplicationErrorService);
  private pageUid: string | undefined;
  private confirmedUser: IUserDados | null = null;

  get hasConfirmedAccount(): boolean {
    return this.confirmedUser !== null;
  }

  readonly status = signal<RecoveryStatus>('working');
  readonly isWorking = signal(false);
  readonly message = signal(
    'Estamos confirmando os dados básicos da sua conta com segurança.'
  );

  constructor(
    private readonly recovery: RegistrationRecoveryService,
    private readonly registerFlow: RegisterFlowFacade,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly logout: LogoutService,
  ) {}

  ngOnInit(): void {
    this.pageUid = this.session.currentAuthUser?.uid;
    this.recover();
  }

  recover(): void {
    if (this.isWorking()) {
      return;
    }

    const uid = this.pageUid;
    if (!uid || !this.isCurrentAccount(uid)) {
      this.status.set('error');
      this.message.set('A sessão mudou. Entre na conta que deseja usar para retomar o cadastro.');
      return;
    }

    this.isWorking.set(true);
    this.status.set('working');
    this.message.set(
      this.confirmedUser
        ? 'Dados da conta confirmados. Procurando a próxima etapa…'
        : 'Estamos confirmando os dados básicos da sua conta com segurança.'
    );

    const confirmedUser$ = this.confirmedUser
      ? of(this.confirmedUser)
      : this.recovery.recoverForUser$(uid).pipe(map(({ user }) => user));

    confirmedUser$
      .pipe(
        switchMap((user) => {
          if (!this.isCurrentAccount(uid)) throw new Error('A sessão mudou.');
          this.confirmedUser = user;
          this.message.set('Dados da conta confirmados. Procurando a próxima etapa…');
          const lifecycleRoute = this.resolveAccountLifecycleRoute(user);

          if (lifecycleRoute) {
            return of(lifecycleRoute);
          }

          return this.registerFlow.vm$.pipe(
            filter(
              (vm) =>
                vm.uid === user.uid &&
                vm.userResolved === true &&
                vm.userExists === true &&
                vm.currentStep !== 'loading' &&
                vm.currentStep !== 'accountRecovery'
            ),
            take(1),
            timeout({ first: this.FLOW_RESOLUTION_TIMEOUT_MS }),
            map((vm) => this.resolveNextRoute(vm))
          );
        }),
        switchMap((target) => {
          if (!this.isCurrentAccount(uid)) throw new Error('A sessão mudou.');
          return defer(() => this.router.navigateByUrl(target, { replaceUrl: true })).pipe(
            timeout({ first: REGISTRATION_ACTION_TIMEOUT_MS }),
            tap((navigated) => {
              if (!this.isCurrentAccount(uid)) throw new Error('A sessão mudou.');
              if (!navigated || this.router.url.split(/[?#]/)[0] === '/register/recuperar-conta') {
                throw new Error('A próxima etapa do cadastro não abriu.');
              }
              this.status.set('success');
            })
          );
        }),
        catchError((error: unknown) => {
          this.status.set('error');
          if (!this.isCurrentAccount(uid) || isRegistrationSessionChange(error)) {
            this.message.set('A sessão mudou. Entre na conta que deseja usar para retomar o cadastro.');
          } else if (this.confirmedUser) {
            this.message.set('Os dados da conta foram confirmados. Use Continuar cadastro para tentar abrir a próxima etapa.');
            this.errors.report(error, {
              feature: 'registration',
              operation: 'openAfterRecovery',
              fallbackMessage: 'Não foi possível abrir a próxima etapa do cadastro.',
              presentation: { surface: 'none', severity: 'warning' },
            });
          } else {
            this.message.set(isRegistrationConfirmationUncertain(error)
              ? 'Ainda não conseguimos confirmar os dados da conta. Verifique a conexão e tente novamente. Você pode usar a mesma conta.'
              : 'Não foi possível confirmar os dados da conta. Tente novamente ou saia e entre com a mesma conta.');
          }
          return EMPTY;
        }),
        finalize(() => {
          this.isWorking.set(false);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  leaveAccount(): void {
    if (this.isWorking()) {
      return;
    }

    this.isWorking.set(true);

    this.logout.logout$()
      .pipe(
        take(1),
        catchError(() => EMPTY),
        finalize(() => {
          this.isWorking.set(false);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private isCurrentAccount(uid: string): boolean {
    return this.session.currentAuthUser?.uid === uid && !this.session.isTerminatingSnapshot;
  }

  private resolveNextRoute(vm: RegisterFlowVm): string {
    const redirectTo = resolveRegistrationReturnUrl(this.route.snapshot.queryParamMap.get('redirectTo'));

    switch (vm.currentStep) {
      case 'emailVerification':
        return '/register/welcome?autocheck=1';

      case 'termsAcceptance':
        return this.buildTermsRoute(redirectTo ?? REGISTRATION_COMPLETION_ROUTE);

      case 'ageVerification':
        return redirectTo
          ? `${vm.nextRoute}?redirectTo=${encodeURIComponent(redirectTo)}`
          : vm.nextRoute;

      case 'profileCompletion':
        return this.buildProfileCompletionRoute(
          redirectTo ?? REGISTRATION_COMPLETION_ROUTE
        );

      case 'preferences':
        return redirectTo ?? vm.nextRoute ?? REGISTRATION_COMPLETION_ROUTE;

      case 'loading':
      case 'signup':
      case 'accountRecovery':
      default:
        return vm.nextRoute && vm.nextRoute !== '/register/recuperar-conta'
          ? vm.nextRoute
          : this.buildTermsRoute(redirectTo ?? REGISTRATION_COMPLETION_ROUTE);
    }
  }

  private resolveAccountLifecycleRoute(user: IUserDados): string | null {
    const status = String(user?.accountStatus ?? '').trim().toLowerCase();

    if (status === 'deleted') {
      return '/conta/status?reason=deleted';
    }

    if (
      status === 'self_suspended' ||
      status === 'moderation_suspended' ||
      status === 'pending_deletion' ||
      status === 'suspended' ||
      status === 'locked' ||
      user?.suspended === true ||
      user?.accountLocked === true
    ) {
      return '/conta/status';
    }

    return null;
  }

  private buildTermsRoute(redirectTo: string): string {
    return `/register/aceitar-termos?redirectTo=${encodeURIComponent(redirectTo)}`;
  }

  private buildProfileCompletionRoute(redirectTo: string): string {
    return `/register/finalizar-cadastro?reason=profile_incomplete&redirectTo=${encodeURIComponent(redirectTo)}`;
  }
}
