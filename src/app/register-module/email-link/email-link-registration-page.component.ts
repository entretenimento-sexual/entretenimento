import { Location, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { Observable, catchError, defer, filter, finalize, from, map, of, switchMap, take, timeout } from 'rxjs';

import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import {
  EMAIL_LINK_PASSWORD_ROUTE, EMAIL_LINK_REGISTRATION_ROUTE, EmailLinkRegistrationService, isEmailLinkPreviewUid, type EmailLinkInspectionState,
} from '@core/services/autentication/register/email-link-registration.service';
import { RegistrationBootstrapService } from '@core/services/autentication/register/registration-bootstrap.service';
import { RegistrationRecoveryService } from '@core/services/autentication/register/registration-recovery.service';
import { ADULT_SELF_DECLARATION_TEXT_PT_BR } from '@core/services/compliance/platform-legal.constants';
import { FooterModule } from '../../footer/footer.module';
import { RegisterFlowFacade } from '../data-access/register-flow.facade';
import { clearSignupDraft } from '../data-access/signup-draft.storage';
import { RegisterProgressComponent } from '../register-progress/register-progress.component';

type LinkMode = 'confirm' | 'password' | 'unavailable';

@Component({
  selector: 'app-email-link-registration-page',
  imports: [ReactiveFormsModule, RouterLink, NgTemplateOutlet, RegisterProgressComponent, FooterModule],
  templateUrl: './email-link-registration-page.component.html',
  styleUrls: ['../register.component.css', './email-link-registration-page.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmailLinkRegistrationPageComponent {
  private readonly auth = inject(Auth);
  private readonly session = inject(AuthSessionService);
  private readonly emailLink = inject(EmailLinkRegistrationService);
  private readonly bootstrap = inject(RegistrationBootstrapService);
  private readonly recovery = inject(RegistrationRecoveryService);
  private readonly flow = inject(RegisterFlowFacade);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder).nonNullable;
  readonly mode = this.route.snapshot.data['emailLinkMode'] as LinkMode;
  private readonly hasActionCode = this.route.snapshot.queryParamMap.has('oobCode');
  private readonly authLink = this.mode === 'confirm' && this.hasActionCode &&
    typeof window !== 'undefined' ? window.location.href : '';

  readonly hasLink = Boolean(this.authLink);
  readonly linkState = signal<EmailLinkInspectionState | 'retry' | 'active-session'>(this.hasLink ? 'retry' : 'unavailable');
  readonly title = computed(() => {
    if (this.mode === 'unavailable') return 'Cadastro por link indisponível';
    if (this.mode === 'password') return 'Defina sua senha';
    switch (this.linkState()) {
      case 'confirm': return 'Confirme sua maioridade';
      case 'sign-in':
      case 'active-session': return 'Retome sua conta';
      case 'draft-expired': return 'Solicite um novo link';
      default: return 'Link de cadastro';
    }
  });
  readonly declaration = ADULT_SELF_DECLARATION_TEXT_PT_BR;
  readonly emailForm = this.fb.group({ adult: false });
  readonly passwordForm = this.fb.group({ password: '', confirmation: '' });
  readonly busy = signal(false);
  readonly error = signal('');
  readonly status = signal('');
  readonly passwordReady = signal(false);
  protected readonly showPassword = signal(false);
  protected readonly showConfirmPassword = signal(false);
  private readonly heading = viewChild<ElementRef<HTMLHeadingElement>>('heading');
  protected ownerUid: string | null = null;
  private skipNickname = false;

  constructor() {
    afterNextRender(() => this.heading()?.nativeElement.focus({ preventScroll: true }));
    if (this.mode !== 'password' && this.hasActionCode) {
      inject(Location).replaceState(EMAIL_LINK_REGISTRATION_ROUTE);
    }
    if (this.mode === 'password') {
      this.checkPasswordState();
    } else if (this.mode === 'confirm') {
      this.checkLink();
    }
  }

  checkLink(): void {
    if (this.mode !== 'confirm' || this.busy()) return;
    this.linkState.set('retry');
    this.run(() => this.session.readyAuthUser$.pipe(
      take(1),
      switchMap(user => {
        if (user) return of('active-session' as const);
        return this.hasLink ? this.emailLink.inspectLink$(this.authLink) : of('unavailable' as const);
      }),
      map(state => this.linkState.set(state)),
    ));
  }

  resumeActiveSession(): void {
    const uid = this.auth.currentUser?.uid;
    if (!uid || this.linkState() !== 'active-session') return;
    this.run(() => this.flow.vm$.pipe(
      filter(vm => vm.authReady && vm.uid === uid && vm.currentStep !== 'loading'),
      take(1),
      timeout({ first: 10_000 }),
      switchMap(vm => this.auth.currentUser?.uid === uid && !this.session.isTerminatingSnapshot
        ? this.open(vm.nextRoute) : of(void 0)),
    ));
  }

  confirm(): void {
    if (this.busy() || this.linkState() !== 'confirm') return;
    if (!this.emailForm.controls.adult.value) {
      this.error.set('Confirme a declaração de maioridade para continuar.');
      return;
    }

    this.run(() => this.session.readyAuthUser$.pipe(
      take(1),
      switchMap(() => this.emailLink.completeLink$(this.authLink, true)),
      switchMap(() => this.open(EMAIL_LINK_PASSWORD_ROUTE)),
    ));
  }

  checkPasswordState(): void {
    this.run(() => this.session.readyAuthUser$.pipe(
      take(1),
      switchMap(user => {
        if (!user || !isEmailLinkPreviewUid(user.uid)) return this.open('/register/welcome');
        this.ownerUid = user.uid;
        return this.emailLink.passwordRequired$(user.uid).pipe(
          catchError(error => {
            if (error?.code !== 'functions/unauthenticated') throw error;
            this.status.set('Se você já escolheu uma senha, informe a mesma para retomar o cadastro.');
            return of(true);
          }),
          switchMap(required => {
            if (!required) return this.continueRegistration(user.uid);
            this.passwordReady.set(true);
            return of(void 0);
          }),
        );
      }),
    ));
  }

  setPassword(): void {
    if (!this.passwordReady() || !this.ownerUid) return;
    const uid = this.ownerUid;
    const { password, confirmation } = this.passwordForm.getRawValue();
    const email = this.auth.currentUser?.email ?? '';
    this.run(() => this.emailLink.setPassword$(uid, email, password, confirmation).pipe(
      switchMap(() => {
        this.passwordForm.reset();
        this.showPassword.set(false);
        this.showConfirmPassword.set(false);
        this.passwordReady.set(false);
        return this.continueRegistration(uid);
      }),
    ));
  }

  private continueRegistration(uid: string): Observable<void> {
    const user = this.auth.currentUser;
    if (user?.uid !== uid || this.session.isTerminatingSnapshot) {
      this.error.set('A sessão mudou. Entre na conta usada no cadastro para continuar.');
      return of(void 0);
    }

    const recover$ = defer(() => this.recovery.recoverForUser$(uid)).pipe(map(() => void 0));
    return this.emailLink.preparedNickname$(uid).pipe(
      switchMap(nickname => {
        // Após autenticar, só o recibo vinculado ao UID pode fornecer o apelido inicial.
        if (!nickname || this.skipNickname) return recover$;
        return this.bootstrap.reserveNickname$(uid, nickname).pipe(
          catchError(error => {
            if (error?.details?.reason === 'nickname/change-not-allowed') return recover$;
            throw error;
          }),
        );
      }),
      map(() => true),
      catchError(error => {
        if (error?.details?.reason === 'nickname/in-use') {
          this.skipNickname = true;
          this.status.set('A senha foi confirmada. O apelido escolhido ficou indisponível. Ao continuar, escolha outro na conclusão do perfil.');
        } else {
          this.error.set('A senha foi confirmada. Não foi possível preparar o cadastro. Tente continuar novamente.');
        }
        return of(false);
      }),
      switchMap(reserved => {
        if (!reserved || this.auth.currentUser?.uid !== uid || this.session.isTerminatingSnapshot) return of(void 0);
        clearSignupDraft();
        return this.flow.vm$.pipe(
          filter(vm => vm.authReady && vm.uid === uid && vm.currentStep !== 'loading' && vm.currentStep !== 'passwordSetup'),
          take(1),
          timeout({ first: 10_000 }),
          switchMap(vm => this.open(vm.nextRoute)),
        );
      }),
    );
  }

  private open(path: string): Observable<void> {
    return defer(() => from(this.router.navigateByUrl(path, { replaceUrl: true }))).pipe(
      map(navigated => {
        if (!navigated) this.error.set('Não foi possível abrir a próxima etapa. Tente continuar novamente.');
      }),
    );
  }

  private run(action: () => Observable<void>): void {
    if (this.busy()) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.error.set('Você está sem conexão. Aguarde a internet voltar e tente novamente.');
      return;
    }
    this.error.set('');
    this.status.set('');
    this.busy.set(true);
    defer(action).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.busy.set(false)),
    ).subscribe({ error: error => this.error.set(this.feedback(error)) });
  }

  private feedback(error: { code?: string; message?: string; localValidation?: boolean; details?: { reason?: string } } | null): string {
    if (error?.localValidation && error.message) return error.message;
    if (error?.details?.reason === 'registration/account-already-created') {
      this.linkState.set('sign-in');
      return '';
    }
    if (error?.details?.reason === 'registration/email-link-draft-expired') {
      this.linkState.set('draft-expired');
      return '';
    }
    if (error?.details?.reason === 'registration/email-link-unavailable' ||
        error?.code === 'auth/invalid-action-code' || error?.code === 'auth/expired-action-code') {
      this.linkState.set('unavailable');
      return '';
    }
    if (error?.code === 'functions/not-found' || error?.code === 'functions/unavailable') {
      return 'A confirmação está indisponível. Verifique se os emuladores de Auth e Functions estão ativos e tente novamente.';
    }
    if (error?.code === 'auth/requires-recent-login') {
      return 'A confirmação ficou antiga. Saia e solicite um novo link para definir sua senha.';
    }
    if (this.mode === 'password' &&
        (error?.code === 'auth/invalid-credential' || error?.code === 'auth/wrong-password')) {
      return 'Confira a senha usada no cadastro. Se você já definiu uma senha e esqueceu, use a recuperação de acesso.';
    }
    if (this.mode === 'password') {
      return 'Não foi possível confirmar a senha agora. Tente novamente. Vamos verificar o que ficou salvo antes de repetir a gravação.';
    }
    return 'Não foi possível confirmar o e-mail agora. Confira a conexão e tente novamente. Se o link já tiver sido usado, solicite outro.';
  }
}
