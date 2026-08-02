import { TestBed } from '@angular/core/testing';

import { ErrorNotificationService } from './error-notification.service';
import { CallableCooldownService } from './callable-cooldown.service';

describe('CallableCooldownService', () => {
  let service: CallableCooldownService;
  let warnings: string[];
  let infos: string[];

  beforeEach(() => {
    warnings = [];
    infos = [];

    TestBed.configureTestingModule({
      providers: [
        CallableCooldownService,
        {
          provide: ErrorNotificationService,
          useValue: {
            showWarning: (message: string) => warnings.push(message),
            showInfo: (message: string) => infos.push(message),
          },
        },
      ],
    });

    service = TestBed.inject(CallableCooldownService);
  });

  it('registra resource-exhausted e expõe snapshot ativo', () => {
    const error = {
      code: 'functions/resource-exhausted',
      details: { retryAfterMs: 4_000 },
    };

    expect(service.captureResourceExhausted(error, 'admin')).toBe(true);
    expect(service.snapshot('admin').active).toBe(true);
    expect(service.snapshot('admin').remainingSeconds).toBeGreaterThan(0);
    expect(service.wasHandled(error)).toBe(true);
    expect(warnings.length).toBe(1);
  });

  it('ignora erros que não representam limite', () => {
    const error = { code: 'functions/permission-denied' };

    expect(service.captureResourceExhausted(error, 'admin')).toBe(false);
    expect(service.snapshot('admin').active).toBe(false);
    expect(service.wasHandled(error)).toBe(false);
    expect(warnings).toEqual([]);
  });

  it('orienta o usuário quando a ação ainda está bloqueada', () => {
    service.captureResourceExhausted(
      {
        code: 'resource-exhausted',
        details: { retryAfterMs: 3_000 },
      },
      'admin'
    );

    expect(service.notifyIfActive('admin')).toBe(true);
    expect(infos.length).toBe(1);
  });
});
