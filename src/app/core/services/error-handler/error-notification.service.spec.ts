// src/app/core/services/error-handler/error-notification.service.spec.ts
// -----------------------------------------------------------------------------
// Testes do ErrorNotificationService
// -----------------------------------------------------------------------------
//
// Cobertura principal:
// - mensagens visuais e classes CSS;
// - deduplicação temporal;
// - fechamento e liberação das mensagens;
// - garantia de que detalhes técnicos não são expostos ao usuário.

import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';

import { ErrorNotificationService } from './error-notification.service';

describe('ErrorNotificationService', () => {
  let service: ErrorNotificationService;

  const snackBar: {
    open: Mock;
    dismiss: Mock;
  } = {
    open: vi.fn(),
    dismiss: vi.fn(),
  };

  beforeEach(() => {
    vi.useFakeTimers();

    TestBed.configureTestingModule({
      providers: [
        ErrorNotificationService,
        { provide: MatSnackBar, useValue: snackBar },
      ],
    });

    service = TestBed.inject(ErrorNotificationService);

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('deve ser criado', () => {
    expect(service).toBeTruthy();
  });

  it('showSuccess abre snackbar seguro com classe e duração padrão', () => {
    service.showSuccess('Operação concluída.');

    expect(snackBar.open).toHaveBeenCalledTimes(1);

    const [message, action, config] = snackBar.open.mock.calls[0];

    expect(message).toBe('Operação concluída.');
    expect(action).toBe('Fechar');
    expect(config.duration).toBe(3000);
    expect(config.panelClass).toEqual(['success-snackbar']);
  });

  it('showError abre snackbar sem ação de detalhes técnicos', () => {
    service.showError('Falha ao concluir.');

    expect(snackBar.open).toHaveBeenCalledTimes(1);

    const [message, action, config] = snackBar.open.mock.calls[0];

    expect(message).toBe('Falha ao concluir.');
    expect(action).toBe('Fechar');
    expect(config.duration).toBe(5000);
    expect(config.panelClass).toEqual(['error-snackbar']);
  });

  it('showError não expõe details por alert ou pelo texto visual', () => {
    const alertSpy = vi
      .spyOn(window, 'alert')
      .mockImplementation(() => undefined);

    service.showError(
      'Não foi possível salvar.',
      'permission-denied: checkout_sessions/internal-id',
      1234
    );

    const [message, action, config] = snackBar.open.mock.calls[0];

    expect(message).toBe('Não foi possível salvar.');
    expect(message).not.toContain('permission-denied');
    expect(message).not.toContain('checkout_sessions');
    expect(action).toBe('Fechar');
    expect(config.duration).toBe(1234);
    expect(config.panelClass).toEqual(['error-snackbar']);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('showInfo abre snackbar com classe informativa', () => {
    service.showInfo('Atualização disponível.', 2222);

    const [message, action, config] = snackBar.open.mock.calls[0];

    expect(message).toBe('Atualização disponível.');
    expect(action).toBe('Fechar');
    expect(config.duration).toBe(2222);
    expect(config.panelClass).toEqual(['info-snackbar']);
  });

  it('showWarning abre snackbar com classe de aviso', () => {
    service.showWarning('Revise os dados.', 3333);

    const [message, action, config] = snackBar.open.mock.calls[0];

    expect(message).toBe('Revise os dados.');
    expect(action).toBe('Fechar');
    expect(config.duration).toBe(3333);
    expect(config.panelClass).toEqual(['warning-snackbar']);
  });

  it('showPersistent abre snackbar sem duração automática', () => {
    service.showPersistent('Sua conta precisa de atenção.');

    const [message, action, config] = snackBar.open.mock.calls[0];

    expect(message).toBe('Sua conta precisa de atenção.');
    expect(action).toBe('Fechar');
    expect(config.duration).toBeUndefined();
    expect(config.panelClass).toEqual(['persistent-snackbar']);
  });

  it('clearError fecha snackbar e permite exibir novamente a mesma mensagem', () => {
    service.showInfo('Mensagem repetível');
    service.clearError();
    service.showInfo('Mensagem repetível');

    expect(snackBar.dismiss).toHaveBeenCalledTimes(1);
    expect(snackBar.open).toHaveBeenCalledTimes(2);
  });

  it('deduplica mensagens dentro da janela padrão e permite após o TTL', () => {
    service.showInfo('Mensagem repetida');
    service.showInfo('Mensagem repetida');

    expect(snackBar.open).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5000);

    service.showInfo('Mensagem repetida');

    expect(snackBar.open).toHaveBeenCalledTimes(2);
  });

  it('showNotification delega corretamente notificações de sucesso', () => {
    service.showNotification('success', 'Tudo certo.', 1111);

    const [message, action, config] = snackBar.open.mock.calls[0];

    expect(message).toBe('Tudo certo.');
    expect(action).toBe('Fechar');
    expect(config.duration).toBe(1111);
    expect(config.panelClass).toEqual(['success-snackbar']);
  });

  it('showNotification delega erro sem expor ação de detalhes', () => {
    service.showNotification('error', 'Operação falhou.', 4444);

    const [message, action, config] = snackBar.open.mock.calls[0];

    expect(message).toBe('Operação falhou.');
    expect(action).toBe('Fechar');
    expect(config.duration).toBe(4444);
    expect(config.panelClass).toEqual(['error-snackbar']);
  });

  it('normaliza valor inválido recebido como mensagem de erro', () => {
    service.showError({ code: 'permission-denied' } as unknown as string);

    const [message] = snackBar.open.mock.calls[0];

    expect(message).toBe(
      'Não foi possível concluir a ação. Tente novamente.'
    );
  });
});