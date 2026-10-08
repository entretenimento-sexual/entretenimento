import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { firstValueFrom, of, Subject, throwError } from 'rxjs';
import { EmailInputModalService } from './email-input-modal.service';
import { LoginService } from './login.service';

describe('EmailInputModalService', () => {
  const sendPasswordResetEmail$ = vi.fn();
  let service: EmailInputModalService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-07T12:00:00Z'));
    try {
      window.localStorage.removeItem('__AUTH_PASSWORD_RECOVERY_COOLDOWN_UNTIL__');
    } catch {
      // Ambiente sem storage.
    }
    sendPasswordResetEmail$.mockReset();
    sendPasswordResetEmail$.mockReturnValue(of(void 0));
    TestBed.configureTestingModule({
      providers: [
        EmailInputModalService,
        { provide: LoginService, useValue: { sendPasswordResetEmail$ } },
      ],
    });
    service = TestBed.inject(EmailInputModalService);
  });

  afterEach(() => {
    service.ngOnDestroy();
    try {
      window.localStorage.removeItem('__AUTH_PASSWORD_RECOVERY_COOLDOWN_UNTIL__');
    } catch {
      // Ambiente sem storage.
    }
    vi.useRealTimers();
  });

  it('impede repetição após fechar e reabrir o modal', () => {
    service.openModal();
    service.sendPasswordRecoveryEmail('person@example.com');
    service.closeModal();
    service.openModal();
    service.sendPasswordRecoveryEmail('other@example.com');
    expect(sendPasswordResetEmail$).toHaveBeenCalledTimes(1);
  });

  it('mantém o cooldown na mesma sessão mesmo sem a chave persistida', () => {
    service.openModal();
    service.sendPasswordRecoveryEmail('person@example.com');
    try {
      window.localStorage.removeItem('__AUTH_PASSWORD_RECOVERY_COOLDOWN_UNTIL__');
    } catch {
      // Simula storage não disponível.
    }
    service.closeModal();
    service.openModal();
    service.sendPasswordRecoveryEmail('other@example.com');
    expect(sendPasswordResetEmail$).toHaveBeenCalledTimes(1);
  });

  it('impede requisições simultâneas na própria camada de serviço', () => {
    const pending$ = new Subject<void>();
    sendPasswordResetEmail$.mockReturnValue(pending$.asObservable());
    service.openModal();
    service.sendPasswordRecoveryEmail('person@example.com');
    service.sendPasswordRecoveryEmail('other@example.com');
    expect(sendPasswordResetEmail$).toHaveBeenCalledTimes(1);
    pending$.complete();
  });

  it('libera novo envio após expirar o cooldown', () => {
    service.openModal();
    service.sendPasswordRecoveryEmail('person@example.com');
    vi.advanceTimersByTime(60_000);
    service.updateEmail('other@example.com');
    service.sendPasswordRecoveryEmail('other@example.com');
    expect(sendPasswordResetEmail$).toHaveBeenCalledTimes(2);
  });
  it.each([
    ['auth/user-not-found'],
    ['auth/user-disabled'],
    ['auth/invalid-email'],
  ])('não revela a existência da conta para %s', async (code) => {
    sendPasswordResetEmail$.mockReturnValue(throwError(() => ({ code })));
    service.openModal();
    service.sendPasswordRecoveryEmail('person@example.com');

    const state = await firstValueFrom(service.state$);
    expect(state.requestCompleted).toBe(true);
    expect(state.feedback?.type).toBe('success');
    expect(state.feedback?.message).toContain('Se esse e-mail estiver cadastrado');
  });

  it.each([
    ['auth/too-many-requests', 'Limite de solicitações'],
    ['auth/network-request-failed', 'Falha de conexão'],
    ['deadline-exceeded', 'demorou mais que o esperado'],
  ])('explica a falha operacional %s sem revelar dados internos', async (code, message) => {
    sendPasswordResetEmail$.mockReturnValue(throwError(() => ({ code, message: 'secret' })));
    service.openModal();
    service.sendPasswordRecoveryEmail('person@example.com');

    const state = await firstValueFrom(service.state$);
    expect(state.requestCompleted).toBe(false);
    expect(state.isSending).toBe(false);
    expect(state.feedback?.type).toBe('error');
    expect(state.feedback?.message).toContain(message);
    expect(state.feedback?.message).not.toContain('secret');
  });

  it('sincroniza cooldown da outra aba antes de permitir novo envio', async () => {
    service.openModal();
    const until = Date.now() + 60_000;
    window.localStorage.setItem('__AUTH_PASSWORD_RECOVERY_COOLDOWN_UNTIL__', String(until));
    window.dispatchEvent(new StorageEvent('storage', {
      key: '__AUTH_PASSWORD_RECOVERY_COOLDOWN_UNTIL__',
      newValue: String(until),
    }));

    const state = await firstValueFrom(service.state$);
    expect(state.cooldownUntilMs).toBe(until);
    service.sendPasswordRecoveryEmail('person@example.com');
    expect(sendPasswordResetEmail$).not.toHaveBeenCalled();
  });

  it('não remove o cooldown mais novo iniciado por outra aba', async () => {
    service.openModal();
    service.sendPasswordRecoveryEmail('person@example.com');
    vi.advanceTimersByTime(10_000);

    const until = Date.now() + 60_000;
    window.localStorage.setItem('__AUTH_PASSWORD_RECOVERY_COOLDOWN_UNTIL__', String(until));
    window.dispatchEvent(new StorageEvent('storage', {
      key: '__AUTH_PASSWORD_RECOVERY_COOLDOWN_UNTIL__',
      newValue: String(until),
    }));

    vi.advanceTimersByTime(50_000);
    const state = await firstValueFrom(service.state$);
    expect(state.cooldownUntilMs).toBe(until);
    expect(window.localStorage.getItem('__AUTH_PASSWORD_RECOVERY_COOLDOWN_UNTIL__')).toBe(String(until));
    expect(sendPasswordResetEmail$).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10_000);
    expect((await firstValueFrom(service.state$)).cooldownUntilMs).toBe(0);
    expect(window.localStorage.getItem('__AUTH_PASSWORD_RECOVERY_COOLDOWN_UNTIL__')).toBeNull();
  });

});
