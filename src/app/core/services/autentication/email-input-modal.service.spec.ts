import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { of, Subject } from 'rxjs';
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
});
