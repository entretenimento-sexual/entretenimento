import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IUserDados } from '@core/interfaces/iuser-dados';
import { AgeVerificationService } from './age-verification.service';

describe('AgeVerificationService legacy boundary', () => {
  const report = vi.fn();
  const user$ = new BehaviorSubject<IUserDados | null | undefined>(null);

  let service: AgeVerificationService;

  beforeEach(() => {
    vi.clearAllMocks();
    user$.next(null);

    service = new AgeVerificationService(
      { user$: user$.asObservable() } as any,
      { report } as any
    );
  });

  it('preserva erro de sessão inválida sem qualquer caminho de persistência', async () => {
    await expect(
      firstValueFrom(
        service.submitAgeDeclaration$({
          uid: '',
          declaredBirthDate: '1990-01-01',
          declaredAdult: true,
        })
      )
    ).rejects.toThrow('Sessão inválida para validar idade.');

    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Sessão inválida para validar idade.',
      }),
      {
        feature: 'age-verification',
        operation: 'submitAgeDeclaration$',
        fallbackMessage:
          'Não foi possível concluir uma etapa interna da validação de idade.',
        presentation: { surface: 'none', severity: 'error' },
        metadata: {
          scope: 'AgeVerificationService',
          phase: 'submitAgeDeclaration$',
        },
      }
    );
  });

  it('bloqueia submissão válida porque a decisão etária não pode mais nascer no cliente', async () => {
    await expect(
      firstValueFrom(
        service.submitAgeDeclaration$({
          uid: 'user-1',
          declaredBirthDate: '1990-01-01',
          declaredAdult: true,
        })
      )
    ).rejects.toThrow(
      'A verificação etária legada foi desativada. Use o fluxo de verificação de maioridade da plataforma.'
    );

    expect(report).toHaveBeenCalledTimes(1);
  });

  it('não trata verified-adult legado como autorização', async () => {
    user$.next({
      uid: 'user-1',
      ageVerification: {
        declaredBirthDate: '1990-01-01',
        declaredAdult: true,
        status: 'verified-adult',
        checkedAt: Date.now(),
      },
    } as unknown as IUserDados);

    const result = await firstValueFrom(service.eligibility$);

    expect(result).toEqual({
      status: 'verified-adult',
      isEligible: false,
      isResolved: false,
      reason:
        'A verificação etária legada não é fonte válida de autorização.',
    });
  });

  it('preserva rejeição de menor como estado não elegível', async () => {
    user$.next({
      uid: 'user-1',
      ageVerification: {
        status: 'rejected-minor',
        reason: 'Cadastro incompatível com a idade mínima da plataforma.',
      },
    } as unknown as IUserDados);

    const result = await firstValueFrom(service.getEligibilityOnce$());

    expect(result).toEqual({
      status: 'rejected-minor',
      isEligible: false,
      isResolved: true,
      reason: 'Cadastro incompatível com a idade mínima da plataforma.',
    });
  });

  it('não altera o erro original se a camada canônica de diagnóstico falhar', async () => {
    report.mockImplementationOnce(() => {
      throw new Error('diagnostic unavailable');
    });

    let received: unknown;

    try {
      await firstValueFrom(
        service.submitAgeDeclaration$({
          uid: 'user-1',
          declaredBirthDate: '1990-01-01',
          declaredAdult: true,
        })
      );
    } catch (error) {
      received = error;
    }

    expect(received).toBeInstanceOf(Error);
    expect((received as Error).message).toContain(
      'verificação etária legada foi desativada'
    );
    expect(report).toHaveBeenCalledTimes(1);
  });
});
