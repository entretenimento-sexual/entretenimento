import { BehaviorSubject, firstValueFrom, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IUserDados } from '@core/interfaces/iuser-dados';
import { AgeVerificationService } from './age-verification.service';

describe('AgeVerificationService canonical errors', () => {
  const updateDocument = vi.fn();
  const patch = vi.fn();
  const report = vi.fn();
  const user$ = new BehaviorSubject<IUserDados | null | undefined>(null);

  let service: AgeVerificationService;

  beforeEach(() => {
    vi.clearAllMocks();
    user$.next(null);

    service = new AgeVerificationService(
      { updateDocument } as any,
      { user$: user$.asObservable(), patch } as any,
      { report } as any
    );
  });

  it('diagnostica validação local silenciosamente e preserva a mensagem pública', async () => {
    await expect(
      firstValueFrom(
        service.submitAgeDeclaration$({
          uid: '',
          declaredBirthDate: '1990-01-01',
          declaredAdult: true,
        })
      )
    ).rejects.toThrow('Sessão inválida para validar idade.');

    expect(updateDocument).not.toHaveBeenCalled();
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

  it('usa snackbar canônico em falha de persistência e repropaga o erro original', async () => {
    const original = Object.assign(new Error('firestore unavailable'), {
      code: 'firestore/unavailable',
    });
    updateDocument.mockReturnValue(
      throwError(() => original)
    );

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

    expect(received).toBe(original);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(original, {
      feature: 'age-verification',
      operation: 'submitAgeDeclaration',
      fallbackMessage:
        'Não foi possível validar a idade agora. Tente novamente.',
      presentation: { surface: 'snackbar', severity: 'error' },
      metadata: {
        scope: 'AgeVerificationService',
        phase: 'submitAgeDeclaration',
        uid: 'user-1',
        declaredBirthDate: '1990-01-01',
      },
    });
  });

  it('persiste, atualiza o runtime e não diagnostica no caminho de sucesso', async () => {
    updateDocument.mockReturnValue(of(void 0));

    const result = await firstValueFrom(
      service.submitAgeDeclaration$({
        uid: 'user-1',
        declaredBirthDate: '1990-01-01',
        declaredAdult: true,
      })
    );

    expect(updateDocument).toHaveBeenCalledWith(
      'users',
      'user-1',
      expect.objectContaining({
        ageVerification: expect.objectContaining({
          declaredBirthDate: '1990-01-01',
          declaredAdult: true,
          status: 'verified-adult',
        }),
      }),
      {
        context: 'AgeVerificationService.submitAgeDeclaration',
      }
    );
    expect(patch).toHaveBeenCalledWith(
      expect.objectContaining({
        ageVerification: expect.objectContaining({
          status: 'verified-adult',
          declaredBirthDate: '1990-01-01',
          declaredAdult: true,
        }),
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: 'verified-adult',
        isEligible: true,
        isResolved: true,
      })
    );
    expect(report).not.toHaveBeenCalled();
  });

  it('não altera o erro original se a própria camada canônica falhar', async () => {
    const original = new Error('write failed');
    updateDocument.mockReturnValue(
      throwError(() => original)
    );
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

    expect(received).toBe(original);
    expect(report).toHaveBeenCalledTimes(1);
  });
});
