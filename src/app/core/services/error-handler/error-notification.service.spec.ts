// src/app/core/services/error-handler/error-notification.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject, of } from 'rxjs';

import { ErrorNotificationService } from './error-notification.service';

describe('ErrorNotificationService', () => {
  let service: ErrorNotificationService;

  // mocks do snackbar (com controle do onAction)
  let action$: Subject<void>;
  const snackBar = {
    open: jest.fn(),
    dismiss: jest.fn(),
  } as unknown as jest.Mocked<MatSnackBar>;

  beforeEach(() => {
    jest.useFakeTimers();
    action$ = new Subject<void>();

    // toda chamada a open retorna um ref com onAction/afterDismissed
    (snackBar.open as jest.Mock).mockImplementation((_msg: string, _action?: string, _cfg?: any) => {
      return {
        onAction: () => action$.asObservable(),
        afterDismissed: () => of({ dismissedByAction: false }),
      } as any;
    });

    TestBed.configureTestingModule({
      providers: [
        ErrorNotificationService,
        { provide: MatSnackBar, useValue: snackBar },
      ],
    });

    service = TestBed.inject(ErrorNotificationService);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('deve ser criado', () => {
    expect(service).toBeTruthy();
  });

  it('showSuccess: abre snackbar com action "Fechar", classe e duração padrão (3000ms)', () => {
    service.showSuccess('ok');

    expect(snackBar.open).toHaveBeenCalledTimes(1);
    const [msg, action, cfg] = (snackBar.open as jest.Mock).mock.calls[0];

    expect(msg).toBe('ok');
    expect(action).toBe('Fechar');
    expect(cfg.duration).toBe(3000);
    expect(cfg.panelClass).toEqual(['success-snackbar']);
  });

  it('showError: abre snackbar com action "Detalhes", classe e duração padrão (5000ms)', () => {
    service.showError('falhou');

    expect(snackBar.open).toHaveBeenCalledTimes(1);
    const [msg, action, cfg] = (snackBar.open as jest.Mock).mock.calls[0];

    expect(msg).toBe('falhou');
    expect(action).toBe('Detalhes');
    expect(cfg.duration).toBe(5000);
    expect(cfg.panelClass).toEqual(['error-snackbar']);
  });

  it('showError: respeita duração customizada e dispara alert com detalhes ao clicar em "Detalhes"', () => {
    const spyAlert = jest.spyOn(window, 'alert').mockImplementation(() => { /* noop */ });

    service.showError('ops', 'STACK TRACE', 1234);

    const [msg, action, cfg] = (snackBar.open as jest.Mock).mock.calls[0];
    expect(msg).toBe('ops');
    expect(action).toBe('Detalhes');
    expect(cfg.duration).toBe(1234);
    expect(cfg.panelClass).toEqual(['error-snackbar']);

    // simula clique no botão de ação do snackbar
    action$.next();
    expect(spyAlert).toHaveBeenCalledWith('STACK TRACE');

    spyAlert.mockRestore();
  });

  it('showInfo: abre snackbar com classe "info-snackbar"', () => {
    service.showInfo('informação', 2222);

    const [msg, action, cfg] = (snackBar.open as jest.Mock).mock.calls[0];
    expect(msg).toBe('informação');
    expect(action).toBe('Fechar');
    expect(cfg.duration).toBe(2222);
    expect(cfg.panelClass).toEqual(['info-snackbar']);
  });

  it('showWarning: abre snackbar com classe "warning-snackbar"', () => {
    service.showWarning('cuidado', 3333);

    const [msg, action, cfg] = (snackBar.open as jest.Mock).mock.calls[0];
    expect(msg).toBe('cuidado');
    expect(action).toBe('Fechar');
    expect(cfg.duration).toBe(3333);
    expect(cfg.panelClass).toEqual(['warning-snackbar']);
  });

  it('clearError: chama dismiss do MatSnackBar', () => {
    service.clearError();
    expect(snackBar.dismiss).toHaveBeenCalledTimes(1);
  });

  it('desduplica mensagens dentro da janela padrão (5000ms) e permite novamente após o TTL', () => {
    service.showInfo('msg repetida');
    service.showInfo('msg repetida'); // deve ser ignorada
    expect(snackBar.open).toHaveBeenCalledTimes(1);

    // avança o relógio além do TTL (5s) para liberar a mesma mensagem novamente
    jest.advanceTimersByTime(5000);

    service.showInfo('msg repetida');
    expect(snackBar.open).toHaveBeenCalledTimes(2);
  });

  it('showNotification delega corretamente por tipo: success', () => {
    service.showNotification('success', 'yay', 1111);

    const [msg, action, cfg] = (snackBar.open as jest.Mock).mock.calls[0];
    expect(msg).toBe('yay');
    expect(action).toBe('Fechar');
    expect(cfg.duration).toBe(1111);
    expect(cfg.panelClass).toEqual(['success-snackbar']);
  });

  it('showNotification delega corretamente por tipo: error (com duração passada)', () => {
    service.showNotification('error', 'nope', 4444);

    const [msg, action, cfg] = (snackBar.open as jest.Mock).mock.calls[0];
    expect(msg).toBe('nope');
    expect(action).toBe('Detalhes');
    expect(cfg.duration).toBe(4444);
    expect(cfg.panelClass).toEqual(['error-snackbar']);
  });
});
