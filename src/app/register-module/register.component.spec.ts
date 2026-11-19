// src/app/register-module/register.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { describe, beforeEach, it, expect, vi } from 'vitest';
import { ReactiveFormsModule } from '@angular/forms';
import { MatTooltip, MatTooltipModule } from '@angular/material/tooltip';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { Auth } from '@angular/fire/auth';
import type { User } from 'firebase/auth';

import { RegisterComponent } from './register.component';
import { SIGNUP_DRAFT_KEY } from './data-access/signup-draft.storage';
import { RegistrationFeedbackTooltipDirective } from './registration-feedback-tooltip.directive';
import { FirestoreValidationService } from '../core/services/data-handling/firestore/validation/firestore-validation.service';
import { RegisterService } from '../core/services/autentication/register/register.service';
import { EmailVerificationService } from '../core/services/autentication/register/email-verification.service';
import { EmailLinkRegistrationService } from '../core/services/autentication/register/email-link-registration.service';
import { AuthSessionService } from '../core/services/autentication/auth/auth-session.service';
import { ApplicationErrorService } from '../core/services/error-handler/application-error.service';
import { ErrorNotificationService } from '../core/services/error-handler/error-notification.service';
import { ActionStateDirective } from '../shared/action-state/action-state.directive';
import { FormValidationFocusDirective } from '../shared/form-validation-focus/form-validation-focus.directive';
import { RegisterProgressComponent } from './register-progress/register-progress.component';
import { environment } from 'src/environments/environment';

class MockFirestoreValidationService {
  checkIfNicknameExists = vi.fn().mockReturnValue(of(false));
}

const registrationResult = (verificationEmailSent = true) => ({
  user: { uid: 'u-test' },
  providerId: null,
  operationType: 'signIn',
  verificationEmailSent,
  registrationWarnings: verificationEmailSent
    ? []
    : ['email-verification-failed'],
});

class MockRegisterService {
  registerUser = vi.fn().mockReturnValue(of(registrationResult()));
}

class MockEmailVerificationService {
  resendVerificationEmail = vi.fn().mockReturnValue(of(void 0));
}

class MockErrorNotificationService {
  showError = vi.fn();
  showInfo = vi.fn();
}

describe('RegisterComponent', () => {
  let fixture: ComponentFixture<RegisterComponent>;
  let component: RegisterComponent;

  let registerService: MockRegisterService;
  let errorNotification: MockErrorNotificationService;
  let router: Router;
  let authUser: BehaviorSubject<Pick<User, 'uid' | 'email' | 'emailVerified'> | null>;

  beforeEach(async () => {
    authUser = new BehaviorSubject<Pick<User, 'uid' | 'email' | 'emailVerified'> | null>(null);
    window.sessionStorage.removeItem(SIGNUP_DRAFT_KEY);
    await TestBed.configureTestingModule({
      declarations: [RegisterComponent],
      imports: [
        ReactiveFormsModule,
        MatTooltipModule,
        RegistrationFeedbackTooltipDirective,
        RouterTestingModule,
        ActionStateDirective,
        FormValidationFocusDirective,
        RegisterProgressComponent,
      ],
      providers: [
        { provide: FirestoreValidationService, useClass: MockFirestoreValidationService },
        { provide: RegisterService, useClass: MockRegisterService },
        { provide: EmailVerificationService, useClass: MockEmailVerificationService },
        { provide: EmailLinkRegistrationService, useValue: { requestLink$: vi.fn(() => of(void 0)) } },
        { provide: ErrorNotificationService, useClass: MockErrorNotificationService },
        { provide: ApplicationErrorService, useValue: {
          report: vi.fn((_error, options) => ({ userMessage: options.fallbackMessage })),
        } },
        { provide: Auth, useValue: { currentUser: { uid: 'u-test' } } },
        { provide: AuthSessionService, useValue: { authUser$: authUser.asObservable() } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(RegisterComponent);
    component = fixture.componentInstance;

    registerService = TestBed.inject(RegisterService) as unknown as MockRegisterService;
    errorNotification = TestBed.inject(ErrorNotificationService) as unknown as MockErrorNotificationService;
    router = TestBed.inject(Router);

    vi.spyOn(router, 'navigate').mockResolvedValue(true);

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('avança do apelido para a confirmação de e-mail e envia o link no próprio formulário em dev-emu', async () => {
    const original = { ...environment };
    Object.assign(environment, {
      production: false,
      useEmulators: true,
      features: { ...environment.features, emailFirstSignupPreview: true },
    });
    const preview = TestBed.createComponent(RegisterComponent);
    try {
      const registration = preview.componentInstance;
      const view = preview.nativeElement as HTMLElement;
      const lookup = new Subject<boolean>();
      const validation = TestBed.inject(FirestoreValidationService);
      vi.mocked(validation.checkIfNicknameExists).mockReturnValueOnce(lookup);
      preview.detectChanges();

      registration.form.patchValue({ apelidoPrincipal: 'visualteste' });
      view.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
      expect(registration.sectionIndex()).toBe(0);
      lookup.next(false);
      preview.detectChanges();
      await preview.whenStable();
      preview.detectChanges();

      expect(registration.sectionIndex()).toBe(1);
      expect(view.querySelector('[aria-current="step"]')?.textContent).toContain('E-mail');
      expect(view.querySelector('#register-section-title')?.textContent).toContain('Confirme seu e-mail');
      expect(view.querySelector('.signup-scene--email')?.classList.contains('signup-scene--inactive')).toBe(false);
      expect(view.querySelector('.auth-container--stage-detail')).toBeNull();
      expect(view.querySelector('#email')).not.toBeNull();
      expect(view.querySelector('#password, #confirmPassword, .signup-section-count')).toBeNull();
      expect(view.querySelector('button[type=submit]')?.textContent).toContain('Enviar link');

      registration.form.patchValue({ email: 'teste@example.com' });
      const submit = view.querySelector<HTMLButtonElement>('button[type=submit]')!;
      const request = vi.mocked(TestBed.inject(EmailLinkRegistrationService).requestLink$);
      const response = new Subject<void>();
      request.mockReturnValueOnce(response);
      window.dispatchEvent(new Event('offline'));
      preview.detectChanges();
      expect(submit.disabled).toBe(true);
      expect(view.querySelector('header p')?.textContent).toContain('Aguarde a conexão voltar');
      window.dispatchEvent(new Event('online'));
      preview.detectChanges();
      expect(submit.disabled).toBe(false);
      expect(view.querySelector('header p')?.textContent).toContain('Informe o endereço');
      expect(request).not.toHaveBeenCalled();
      vi.useFakeTimers();
      submit.click();
      preview.detectChanges();
      expect(submit.textContent).toContain('Enviando link');
      expect(request).toHaveBeenCalledWith('teste@example.com', 'visualteste');
      expect(registerService.registerUser).not.toHaveBeenCalled();
      response.next();
      response.complete();
      preview.detectChanges();

      expect(view.querySelector('#register-section-title')?.textContent).toContain('Confira seu e-mail');
      expect(view.querySelector('header p')?.textContent).toContain('caixa de entrada ou no spam');
      expect(view.textContent).not.toMatch(/emulador|Authentication/i);
      expect(view.querySelector('#email')).toBeNull();
      expect(view.textContent).not.toContain('teste@example.com');
      expect(submit.disabled).toBe(true);
      expect(submit.textContent).toContain('Reenviar em 30 s');
      vi.advanceTimersByTime(30_000);
      preview.detectChanges();
      expect(submit.textContent).toContain('Reenviar link');
      expect(submit.disabled).toBe(false);

      request.mockReturnValueOnce(throwError(() => ({ code: 'auth/network-request-failed' })));
      submit.click();
      preview.detectChanges();
      expect(request).toHaveBeenCalledTimes(2);
      expect(request).toHaveBeenLastCalledWith('teste@example.com', 'visualteste');
      expect(view.querySelector('header p')?.textContent).toContain('Envio sem confirmação');
      expect(view.querySelector('.alert')).toBeNull();
      view.querySelector<HTMLButtonElement>('.signup-actions button[type=button]')!.click();
      preview.detectChanges();
      expect(registration.sectionIndex()).toBe(1);
      const input = view.querySelector<HTMLInputElement>('#email')!;
      expect(input.readOnly).toBe(false);
      expect(input.value).toBe('teste@example.com');
      expect(view.querySelector('#register-section-title')?.textContent).toContain('Confirme seu e-mail');

      vi.advanceTimersByTime(30_000);
      preview.detectChanges();
      view.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
      preview.detectChanges();
      authUser.next({ uid: 'other', email: 'other@example.com', emailVerified: true });
      preview.detectChanges();
      expect(view.querySelector('h1')?.textContent).toContain('Retome sua conta');
      expect(view.textContent).not.toContain('E-mail confirmado');
      expect(view.textContent).not.toContain('other@example.com');

      authUser.next({ uid: 'signup', email: 'Teste@example.com', emailVerified: true });
      preview.detectChanges();
      expect(view.querySelector('h1')?.textContent).toContain('E-mail confirmado');
      expect(view.querySelector('.signup-resume')?.getAttribute('href')).toBe('/register/welcome');
      expect(view.querySelector('form')).toBeNull();
    } finally {
      preview.destroy();
      vi.useRealTimers();
      Object.assign(environment, original);
    }
  });

  it('retoma a segunda etapa após refresh sem guardar senha nem aceites', () => {
    component.form.patchValue({ apelidoPrincipal: 'visualteste', complementoApelido: 'RJ' });
    component.onNicknameBlur();
    component.submitSection();
    expect(component.sectionIndex()).toBe(1);
    component.form.patchValue({
      email: 'teste@example.com', password: 'SenhaSegura123',
      confirmPassword: 'SenhaSegura123', confirmarMaioridade: true, aceitarTermos: true,
    });
    const snapshot = window.sessionStorage.getItem(SIGNUP_DRAFT_KEY) ?? '';
    expect(snapshot).toContain('visualteste');
    expect(snapshot).toContain('teste@example.com');
    expect(snapshot).not.toContain('SenhaSegura123');
    expect(snapshot).not.toContain('confirmarMaioridade');
    expect(snapshot).not.toContain('aceitarTermos');
    fixture.destroy();

    const reopened = TestBed.createComponent(RegisterComponent);
    reopened.detectChanges();
    expect(reopened.componentInstance.sectionIndex()).toBe(1);
    expect(reopened.componentInstance.form.get('apelidoPrincipal')?.value).toBe('visualteste');
    expect(reopened.componentInstance.form.get('complementoApelido')?.value).toBe('RJ');
    expect(reopened.componentInstance.form.get('email')?.value).toBe('teste@example.com');
    expect(reopened.componentInstance.form.get('password')?.value).toBe('');
    expect(reopened.componentInstance.form.get('aceitarTermos')?.value).toBe(false);
    expect(reopened.componentInstance.form.get('confirmarMaioridade')?.value).toBe(false);
    reopened.destroy();
  });

  it('restaura a espera pelo link e mantém a entrada de retomada após recarregar', () => {
    const original = { ...environment };
    Object.assign(environment, {
      production: false, useEmulators: true,
      features: { ...environment.features, emailFirstSignupPreview: true },
    });
    window.sessionStorage.setItem(SIGNUP_DRAFT_KEY, JSON.stringify({
      version: 1, updatedAt: Date.now(), sectionIndex: 1,
      apelidoPrincipal: 'retomada', complementoApelido: '', email: 'teste@example.test',
      linkConfirmation: 'requested',
    }));
    const resumed = TestBed.createComponent(RegisterComponent);
    try {
      resumed.detectChanges();
      const view = resumed.nativeElement as HTMLElement;
      expect(view.querySelector('h1')?.textContent).toContain('Confira seu e-mail');
      expect(view.querySelector('#email')).toBeNull();
      expect(view.querySelector('.login-redirect a')?.getAttribute('href')).toBe('/login?retomarCadastro=1');
    } finally {
      resumed.destroy();
      Object.assign(environment, original);
    }
  });

  it('reabre apelido recusado se foi reservado antes da recarga', () => {
    window.sessionStorage.setItem(SIGNUP_DRAFT_KEY, JSON.stringify({
      version: 1, updatedAt: Date.now(), sectionIndex: 1,
      apelidoPrincipal: 'ocupado', complementoApelido: '', email: 'teste@example.com',
    }));
    const validation = TestBed.inject(FirestoreValidationService) as unknown as MockFirestoreValidationService;
    validation.checkIfNicknameExists.mockReturnValueOnce(of(true));
    fixture.destroy();
    const reopened = TestBed.createComponent(RegisterComponent);
    reopened.detectChanges();
    expect(reopened.componentInstance.sectionIndex()).toBe(0);
    expect(reopened.componentInstance.apelidoEmUso()).toBe(true);
    reopened.destroy();
  });

  it('descarta rascunho vencido sem interromper o cadastro', () => {
    window.sessionStorage.setItem(SIGNUP_DRAFT_KEY, JSON.stringify({
      version: 1, updatedAt: Date.now() - 31 * 60_000, sectionIndex: 1,
      apelidoPrincipal: 'antigo', complementoApelido: '', email: 'teste@example.com',
    }));
    fixture.destroy();
    const reopened = TestBed.createComponent(RegisterComponent);
    reopened.detectChanges();
    expect(reopened.componentInstance.sectionIndex()).toBe(0);
    expect(reopened.componentInstance.form.get('apelidoPrincipal')?.value).toBe('');
    reopened.destroy();
  });

  it('troca as cenas fotográficas sem deslocar o formulário', () => {
    const view = fixture.nativeElement as HTMLElement;
    const shell = view.querySelector('.auth-container') as HTMLElement;
    expect(shell.classList.contains('auth-container--stage-detail')).toBe(false);
    const original = () => view.querySelector('.signup-scene--original') as HTMLElement;
    const email = () => view.querySelector('.signup-scene--email') as HTMLElement;
    const confirm = () => view.querySelector('.signup-scene--confirm') as HTMLElement;
    expect(email().querySelector('img')?.getAttribute('src')).toBe('assets/registration/signup-stage-email.webp');
    expect(confirm().querySelector('img')?.getAttribute('src')).toBe('assets/registration/signup-stage-confirm.webp');
    expect(original().classList.contains('signup-scene--inactive')).toBe(false);
    expect(email().classList.contains('signup-scene--inactive')).toBe(true);
    expect(confirm().classList.contains('signup-scene--inactive')).toBe(true);

    component.form.patchValue({ apelidoPrincipal: 'visualteste' });
    component.onNicknameBlur();
    component.submitSection();
    fixture.detectChanges();

    expect(component.sectionIndex()).toBe(1);
    expect(shell.classList.contains('auth-container--stage-detail')).toBe(true);
    expect(original().classList.contains('signup-scene--inactive')).toBe(true);
    expect(email().classList.contains('signup-scene--inactive')).toBe(false);
    expect(confirm().classList.contains('signup-scene--inactive')).toBe(true);

    component.sectionIndex.set(2);
    fixture.detectChanges();
    expect(confirm().classList.contains('signup-scene--inactive')).toBe(false);
    component.previousSection();
    fixture.detectChanges();
    expect(email().classList.contains('signup-scene--inactive')).toBe(false);
    component.previousSection();
    fixture.detectChanges();
    expect(shell.classList.contains('auth-container--stage-detail')).toBe(false);
  });

  it('mostra os detalhes da consulta no botão do visto sem enviar o formulário', () => {
    component.form.patchValue({ apelidoPrincipal: 'visualteste' });
    component.onNicknameBlur();
    fixture.detectChanges();

    const indicator = fixture.debugElement.query(By.css('.nickname-indicator--checked'));
    expect(indicator.nativeElement.type).toBe('button');
    expect(indicator.injector.get(MatTooltip).message)
      .toBe('Apelido disponível');
    expect(registerService.registerUser).not.toHaveBeenCalled();
  });

  it('explica quando o apelido está em uso ou quando o formato é inválido', () => {
    const validation = TestBed.inject(FirestoreValidationService) as unknown as MockFirestoreValidationService;
    validation.checkIfNicknameExists.mockReturnValueOnce(of(true));
    component.form.patchValue({ apelidoPrincipal: 'visualteste' });
    component.onNicknameBlur();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#apelidoTooltip')?.textContent)
      .toContain('Este apelido já está em uso.');
    expect(fixture.nativeElement.querySelector('.nickname-indicator--checked')).toBeNull();
    expect(fixture.debugElement.query(By.css('.nickname-indicator--rejected')).injector.get(MatTooltip).message)
      .toBe('Este apelido já está em uso.');

    component.form.patchValue({ apelidoPrincipal: 'visual@teste' });
    component.onNicknameTyping();
    component.onNicknameBlur();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#apelidoTooltip')?.textContent)
      .toContain('Use letras sem acento, números, ponto, hífen ou sublinhado.');
    expect(fixture.debugElement.query(By.css('.nickname-indicator--rejected')).injector.get(MatTooltip).message)
      .toContain('Use letras sem acento, números, ponto, hífen ou sublinhado.');
  });

  it('aceita dois campos de 12 caracteres e explica a regra no campo inválido', () => {
    const validation = TestBed.inject(FirestoreValidationService) as unknown as MockFirestoreValidationService;
    component.form.patchValue({ apelidoPrincipal: 'dd', complementoApelido: 'Complemento1' });
    component.onNicknameBlur();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#apelidoTooltip.sr-only')?.textContent)
      .toContain('Use de 4 a 12 caracteres no apelido.');
    expect(validation.checkIfNicknameExists).not.toHaveBeenCalled();

    component.form.patchValue({ apelidoPrincipal: 'ApelidoTeste', complementoApelido: 'Complemento12' });
    component.onNicknameBlur();
    component.onComplementoBlur();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#complementoTooltip.sr-only')?.textContent)
      .toContain('Use até 12 caracteres no complemento.');
    expect(validation.checkIfNicknameExists).toHaveBeenCalledWith('ApelidoTeste', { mode: 'soft' });

    component.form.patchValue({ complementoApelido: 'Complemento1' });
    component.onComplementoBlur();
    fixture.detectChanges();

    expect(validation.checkIfNicknameExists).toHaveBeenCalledTimes(1);
    expect(component.nicknameCheckState()).toBe('provisional');
    expect(component.form.hasError('invalidFullNickname')).toBe(false);
    expect(fixture.nativeElement.querySelector('#apelidoPrincipal').maxLength).toBe(12);
    expect(fixture.nativeElement.querySelector('#complementoApelido').maxLength).toBe(12);
  });

  it('preserva o resultado durante a edição do complemento e reconsulta ao trocar o principal', () => {
    const validation = TestBed.inject(FirestoreValidationService) as unknown as MockFirestoreValidationService;
    component.form.patchValue({ apelidoPrincipal: 'Ocupado' });
    validation.checkIfNicknameExists.mockReturnValueOnce(of(true));
    component.onNicknameBlur();
    for (const value of ['RJ', 'Inválido!', 'Oficial', '']) {
      component.form.patchValue({ complementoApelido: value });
      component.onComplementoTyping();
      component.onComplementoBlur();
      component.onNicknameBlur();
      expect(component.form.get('apelidoPrincipal')?.hasError('apelidoEmUso')).toBe(true);
    }
    expect(validation.checkIfNicknameExists).toHaveBeenCalledTimes(1);
    component.form.patchValue({ apelidoPrincipal: 'Outro' });
    component.onNicknameTyping();
    component.onNicknameBlur();
    expect(validation.checkIfNicknameExists).toHaveBeenCalledTimes(2);
    expect(validation.checkIfNicknameExists).toHaveBeenLastCalledWith('Outro', { mode: 'soft' });
  });

  it('avisa quando a consulta falha e só avança após confirmar a disponibilidade', () => {
    const validation = TestBed.inject(FirestoreValidationService) as unknown as MockFirestoreValidationService;
    validation.checkIfNicknameExists
      .mockReturnValueOnce(throwError(() => new Error('offline')))
      .mockReturnValueOnce(throwError(() => new Error('offline')));
    component.form.patchValue({ apelidoPrincipal: 'visualteste' });
    component.onNicknameBlur();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#apelidoConsultaErro')?.textContent)
      .toContain('Não foi possível confirmar a disponibilidade.');
    expect(fixture.nativeElement.querySelector('.nickname-indicator--rejected')).toBeNull();
    expect(fixture.nativeElement.querySelector('.nickname-indicator--checked')).toBeNull();
    component.submitSection();
    expect(component.sectionIndex()).toBe(0);
    component.submitSection();
    expect(component.sectionIndex()).toBe(1);
  });

  it('fecha o balão após três segundos e permite reabri-lo no X', () => {
    vi.useFakeTimers();
    const show = vi.spyOn(MatTooltip.prototype, 'show').mockImplementation(() => {});
    const hide = vi.spyOn(MatTooltip.prototype, 'hide').mockImplementation(() => {});
    try {
      component.form.patchValue({ apelidoPrincipal: 'dd' });
      component.onNicknameBlur();
      fixture.detectChanges();
      vi.advanceTimersByTime(0);
      expect(show).toHaveBeenCalledOnce();
      hide.mockClear();

      vi.advanceTimersByTime(2999);
      expect(hide).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(hide).toHaveBeenCalledWith(0);

      fixture.nativeElement.querySelector('.nickname-indicator--rejected').click();
      vi.advanceTimersByTime(0);
      expect(show).toHaveBeenCalledTimes(2);
    } finally {
      fixture.destroy();
      show.mockRestore();
      hide.mockRestore();
      vi.useRealTimers();
    }
  });

  it('mostra o erro de e-mail em sobreposição por quatro segundos e reapresenta a cada envio inválido', () => {
    vi.useFakeTimers();
    const show = vi.spyOn(MatTooltip.prototype, 'show').mockImplementation(() => {});
    const hide = vi.spyOn(MatTooltip.prototype, 'hide').mockImplementation(() => {});
    try {
      const view = fixture.nativeElement as HTMLElement;
      component.sectionIndex.set(1);
      fixture.detectChanges();
      component.submitSection();
      fixture.detectChanges();
      vi.advanceTimersByTime(0);

      expect(show).toHaveBeenCalledOnce();
      expect(view.querySelector('.alert')).toBeNull();
      expect(view.querySelector('#emailTooltip.sr-only')?.textContent).toBe('Campo obrigatório');
      expect(view.querySelector('#email')?.getAttribute('aria-invalid')).toBe('true');
      hide.mockClear();

      vi.advanceTimersByTime(3999);
      expect(hide).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(hide).toHaveBeenCalledWith(0);
      expect(view.querySelector('#emailTooltip')?.textContent).toBe('Campo obrigatório');

      component.submitSection();
      fixture.detectChanges();
      vi.advanceTimersByTime(0);
      expect(show).toHaveBeenCalledTimes(2);

      component.form.get('email')!.setValue('teste@example.com');
      fixture.detectChanges();
      expect(view.querySelector('#email')?.hasAttribute('aria-invalid')).toBe(false);
      expect(view.querySelector('#emailTooltip')?.textContent).toBe('');
    } finally {
      fixture.destroy();
      show.mockRestore();
      hide.mockRestore();
      vi.useRealTimers();
    }
  });

  it('exibe apenas a tela atual e cria a conta somente após confirmar a última', async () => {
    const view: HTMLElement = fixture.nativeElement;
    const submit = () => {
      view.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      fixture.detectChanges();
    };

    expect(view.querySelector('#apelidoPrincipal')).not.toBeNull();
    expect(view.querySelector('#email, #password, #termos, #maioridade-inicial')).toBeNull();
    expect(view.querySelector('.signup-section-count')?.textContent).toBe('1 de 3');
    submit();
    expect(view.querySelector('#email')).toBeNull();
    expect(component.form.get('email')?.untouched).toBe(true);

    component.form.patchValue({ apelidoPrincipal: 'visualteste' });
    submit();
    expect(view.querySelector('#email')).not.toBeNull();
    expect(view.querySelector('#apelidoPrincipal, #termos')).toBeNull();
    expect(view.querySelector('.signup-section-count')?.textContent).toBe('2 de 3');
    expect(registerService.registerUser).not.toHaveBeenCalled();

    component.form.patchValue({ email: 'a@example.test', password: 'Senha123', confirmPassword: 'Outro123' });
    submit();
    expect(view.querySelector('#confirmPasswordTooltip')?.textContent).toContain('As senhas não coincidem');
    expect(view.querySelector('#termos')).toBeNull();
    component.form.patchValue({ confirmPassword: 'Senha123' });
    submit();

    expect(view.querySelector('#maioridade-inicial')).not.toBeNull();
    expect(view.querySelector('#email, #password, #apelidoPrincipal')).toBeNull();
    expect(view.querySelector('.signup-section-count')?.textContent).toBe('3 de 3');
    submit();
    expect(registerService.registerUser).not.toHaveBeenCalled();

    Array.from(view.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Voltar')!.click();
    fixture.detectChanges();
    expect(view.querySelector<HTMLInputElement>('#email')?.value).toBe('a@example.test');
    expect(view.querySelector<HTMLInputElement>('#password')?.value).toBe('Senha123');
    submit();
    component.form.patchValue({ confirmarMaioridade: true, aceitarTermos: true });
    submit();
    await fixture.whenStable();
    expect(registerService.registerUser).toHaveBeenCalledTimes(1);
  });

  it('aguarda a checagem de apelido que já está em andamento ao continuar', async () => {
    const check$ = new Subject<boolean>();
    const validation = TestBed.inject(FirestoreValidationService) as unknown as MockFirestoreValidationService;
    validation.checkIfNicknameExists.mockReturnValue(check$);
    component.form.patchValue({ apelidoPrincipal: 'visualteste' });
    component.onNicknameBlur();
    component.submitSection();
    fixture.detectChanges();
    expect(component.sectionIndex()).toBe(0);
    expect(validation.checkIfNicknameExists).toHaveBeenCalledTimes(1);

    check$.next(false);
    check$.complete();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.sectionIndex()).toBe(1);
  });

  it('mantém o botão de cadastro acionável para revelar erros', () => {
    const submit = fixture.debugElement.query(
      By.css('button[type="submit"]')
    ).nativeElement as HTMLButtonElement;

    expect(component.form.invalid).toBe(true);
    expect(submit.disabled).toBe(false);
    expect(
      fixture.debugElement.query(By.directive(FormValidationFocusDirective))
    ).toBeTruthy();
  });

  it('mantém o feedback de apelido no indicador sem banner ou snackbar duplicado', () => {
    component.onSubmit();
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('.nickname-indicator--rejected')).injector.get(MatTooltip).message)
      .toBe('Informe seu apelido.');
    expect(component.banner()).toBeNull();
    expect(errorNotification.showError).not.toHaveBeenCalled();
    expect(registerService.registerUser).not.toHaveBeenCalled();
  });

  it('anuncia erros de campo de forma acessível após submit inválido', () => {
    component.onSubmit();
    fixture.detectChanges();

    const errors = fixture.debugElement.queryAll(By.css('.nickname-field [role="alert"].sr-only'));

    expect(errors.length).toBeGreaterThan(0);
    for (const error of errors) {
      const element = error.nativeElement as HTMLElement;
      expect(element.getAttribute('role')).toBe('alert');
      expect(element.getAttribute('aria-live')).toBe('polite');
      expect(element.getAttribute('aria-atomic')).toBe('true');
    }
  });

  it('mantém o formulário inválido quando as senhas não coincidem', () => {
    component.form.patchValue({
      password: 'Senha123',
      confirmPassword: 'Outra123',
    });

    expect(component.form.hasError('passwordMismatch')).toBe(true);
    expect(component.getError('confirmPassword')).toBe(
      'As senhas não coincidem.'
    );
  });

  it('rejeita senha sem a complexidade mínima', () => {
    component.form.patchValue({
      password: '12345678',
      confirmPassword: '12345678',
    });

    expect(component.form.get('password')?.hasError('invalidPassword')).toBe(
      true
    );
  });

  it('nega criação de conta antes do Auth quando falta declaração 18+', () => {
    component.form.patchValue({
      apelidoPrincipal: 'adulteste',
      complementoApelido: '',
      email: 'teste@example.com',
      password: 'Senha123',
      confirmPassword: 'Senha123',
      aceitarTermos: true,
      confirmarMaioridade: false,
    });
    component.onSubmit();
    fixture.detectChanges();
    expect(registerService.registerUser).not.toHaveBeenCalled();
    expect(component.getError('confirmarMaioridade')).toContain('18 anos');
    expect(fixture.nativeElement.textContent).toContain('18 anos');
  });

  it('nega criação de conta quando falta aceite inicial dos termos', () => {
    component.form.patchValue({
      apelidoPrincipal: 'adulteste',
      complementoApelido: '',
      email: 'teste@example.com',
      password: 'Senha123',
      confirmPassword: 'Senha123',
      aceitarTermos: false,
      confirmarMaioridade: true,
    });
    component.onSubmit();
    expect(registerService.registerUser).not.toHaveBeenCalled();
    expect(component.getError('aceitarTermos')).toContain('Termos de Uso');
  });

  it('deve chamar register e navegar quando o form estiver válido', async () => {
    component.form.patchValue({
      apelidoPrincipal: 'john',
      complementoApelido: 'doe',
      email: 'jd@example.com',
      password: 'Senha123',
      confirmPassword: 'Senha123',
      aceitarTermos: true,
      confirmarMaioridade: true,
    });

    component.onSubmit();

    await fixture.whenStable();

    expect(registerService.registerUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'jd@example.com',
        nickname: expect.stringContaining('john'),
        acceptedTerms: expect.objectContaining({ accepted: true }),
        confirmsAdult: true,
        emailVerified: false,
      }),
      'Senha123'
    );

    expect(router.navigate).toHaveBeenCalledWith(
      ['/register/welcome'],
      {
        queryParams: {
          autocheck: '1',
          verificationEmail: 'sent',
        },
        replaceUrl: true,
      }
    );
  });

  it('encaminha falha do envio inicial sem afirmar que o e-mail foi enviado', async () => {
    registerService.registerUser.mockReturnValueOnce(
      of(registrationResult(false))
    );

    component.form.patchValue({
      apelidoPrincipal: 'falhaenvio',
      complementoApelido: '',
      email: 'falha@example.com',
      password: 'Segura123',
      confirmPassword: 'Segura123',
      aceitarTermos: true,
      confirmarMaioridade: true,
    });

    component.onSubmit();
    await fixture.whenStable();

    expect(router.navigate).toHaveBeenCalledWith(
      ['/register/welcome'],
      {
        queryParams: {
          autocheck: '1',
          verificationEmail: 'failed',
        },
        replaceUrl: true,
      }
    );
  });

  it('não envia a confirmação de senha ao serviço de registro', async () => {
    component.form.patchValue({
      apelidoPrincipal: 'maria',
      complementoApelido: '',
      email: 'maria@example.com',
      password: 'Segura123',
      confirmPassword: 'Segura123',
      aceitarTermos: true,
      confirmarMaioridade: true,
    });

    component.onSubmit();
    await fixture.whenStable();

    const [payload] = registerService.registerUser.mock.calls[0];
    expect(payload).not.toHaveProperty('confirmPassword');
  });

  it.each(['email-exists-soft', 'registration-creation-unconfirmed'])(
    'exibe feedback neutro quando recebe %s', (code) => {
    registerService.registerUser.mockReturnValueOnce(
      throwError(() => ({
        code,
        message: 'Não foi possível criar uma nova conta com este e-mail.',
      }))
    );

    component.form.patchValue({
      apelidoPrincipal: 'privado',
      complementoApelido: '',
      email: 'alguem@example.com',
      password: 'Segura123',
      confirmPassword: 'Segura123',
      aceitarTermos: true,
      confirmarMaioridade: true,
    });

    component.onSubmit();
    fixture.detectChanges();

    const feedbacks = fixture.debugElement.queryAll(
      By.css('.form-container > .alert')
    );
    const duplicatedFormFeedbacks = fixture.debugElement.queryAll(
      By.css('form .alert')
    );

    expect(feedbacks).toHaveLength(1);
    expect(duplicatedFormFeedbacks).toHaveLength(0);

    const feedback = feedbacks[0].nativeElement as HTMLElement;
    const copy = feedback.textContent?.replace(/\s+/g, ' ').trim() ?? '';

    if (code === 'registration-creation-unconfirmed') {
      expect(copy).toContain('Criação da conta ainda não confirmada');
      expect(copy).toContain('tente entrar com o e-mail e a senha que informou');
    } else {
      expect(copy).toContain('Confira seu acesso');
      expect(copy).toContain('Tente entrar com os dados informados');
    }
    expect(copy).not.toContain('nova conta com este e-mail');
    expect(copy).not.toContain('e-mail já está');
    expect(feedback.getAttribute('role')).toBe('status');
    expect(feedback.getAttribute('aria-live')).toBe('polite');
    expect(feedback.querySelectorAll('a')).toHaveLength(1);
  });

  it('alterna separadamente a visibilidade da senha e da confirmação', () => {
    const initialPassword = component.showPassword();
    const initialConfirmation = component.showConfirmPassword();

    component.togglePasswordVisibility();
    component.toggleConfirmPasswordVisibility();

    expect(component.showPassword()).toBe(!initialPassword);
    expect(component.showConfirmPassword()).toBe(!initialConfirmation);
  });
  it('mantém o feedback de conta criada e não abre o cadastro de outro UID', async () => {
    registerService.registerUser.mockReturnValueOnce(of({
      ...registrationResult(),
      user: { uid: 'conta-criada' },
    }));
    component.form.patchValue({
      apelidoPrincipal: 'novaconta',
      complementoApelido: '',
      email: 'nova@example.com',
      password: 'Senha123',
      confirmPassword: 'Senha123',
      aceitarTermos: true,
      confirmarMaioridade: true,
    });

    component.onSubmit();
    await fixture.whenStable();

    expect(router.navigate).not.toHaveBeenCalled();
    expect(component.banner()?.title).toBe('Sua conta foi criada');
    expect(component.accountCreated()).toBe(true);
    expect(component.isLoading()).toBe(false);
  });

});
