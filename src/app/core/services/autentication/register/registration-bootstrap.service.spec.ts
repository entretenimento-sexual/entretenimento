import { firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RegistrationBootstrapService } from './registration-bootstrap.service';

describe('RegistrationBootstrapService canonical errors', () => {
  let service: RegistrationBootstrapService;
  let report: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    report = vi.fn();

    service = Object.create(
      RegistrationBootstrapService.prototype
    ) as RegistrationBootstrapService;

    Object.assign(service as any, {
      applicationError: { report },
      diagnosedErrors: new WeakSet<object>(),
    });
  });

  it('mantém UID social inválido como validação local sem diagnóstico técnico', async () => {
    await expect(
      firstValueFrom(
        service.createSocialSeed$({
          uid: '   ',
          email: 'user@example.com',
          emailVerified: true,
        })
      )
    ).rejects.toThrow('[RegistrationBootstrapService] UID inválido.');

    expect(report).not.toHaveBeenCalled();
  });

  it('assume ownership de falha operacional, reporta uma vez e preserva o erro original', () => {
    const original = Object.assign(new Error('firestore unavailable'), {
      code: 'unavailable',
    });

    (service as any).reportOperationalError(
      original,
      'createSocialSeed',
      {
        uid: 'user-1',
        emailPresent: true,
        providerId: 'google.com',
      }
    );

    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(original, {
      feature: 'registration-bootstrap',
      operation: 'createSocialSeed',
      fallbackMessage:
        'Não foi possível concluir a preparação inicial da conta.',
      presentation: { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'RegistrationBootstrapService',
        uid: 'user-1',
        emailPresent: true,
        providerId: 'google.com',
      },
    });
    expect(service.hasDiagnosticOwnership(original)).toBe(true);

    (service as any).reportOperationalError(
      original,
      'createSocialSeed',
      {
        uid: 'user-1',
      }
    );

    expect(report).toHaveBeenCalledTimes(1);
  });

  it('permite fallback do consumidor quando a camada canônica não consegue diagnosticar', () => {
    const original = new Error('firestore unavailable');
    report.mockImplementationOnce(() => {
      throw new Error('diagnostic unavailable');
    });

    (service as any).reportOperationalError(
      original,
      'createEmailPasswordSeed',
      {
        uid: 'user-1',
        traceId: 'trace-1',
      }
    );

    expect(report).toHaveBeenCalledTimes(1);
    expect(service.hasDiagnosticOwnership(original)).toBe(false);
  });

  it('não atribui ownership a valores primitivos que não podem ser rastreados por identidade', () => {
    (service as any).reportOperationalError(
      'primitive failure',
      'createSocialSeed',
      {
        uid: 'user-1',
      }
    );

    expect(report).toHaveBeenCalledTimes(1);
    expect(service.hasDiagnosticOwnership('primitive failure')).toBe(false);
  });
});
