import { firstValueFrom, Observable, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { RegistrationRecoveryService } from './registration-recovery.service';

describe('RegistrationRecoveryService canonical errors', () => {
  let service: RegistrationRecoveryService;
  let recoverCallable: ReturnType<typeof vi.fn>;
  let uid$: Observable<string | null>;
  let getUserOnceFromFirestore$: ReturnType<typeof vi.fn>;
  let setCurrentUser: ReturnType<typeof vi.fn>;
  let report: ReturnType<typeof vi.fn>;

  const user = {
    uid: 'user-1',
    email: 'user@example.com',
  } as IUserDados;

  beforeEach(() => {
    vi.clearAllMocks();

    recoverCallable = vi.fn();
    uid$ = of('user-1');
    getUserOnceFromFirestore$ = vi.fn(() => of(user));
    setCurrentUser = vi.fn();
    report = vi.fn();

    service = Object.create(
      RegistrationRecoveryService.prototype
    ) as RegistrationRecoveryService;

    Object.assign(service as any, {
      session: { uid$ },
      users: { getUserOnceFromFirestore$ },
      currentUserStore: { set: setCurrentUser },
      applicationError: { report },
      ACTION_TIMEOUT_MS: 15_000,
      recoverCallable,
    });
  });

  it('mantém sessão ausente como validação local sem diagnóstico técnico', async () => {
    Object.assign(service as any, {
      session: { uid$: of(null) },
    });

    await expect(
      firstValueFrom(service.recoverCurrentRegistration$())
    ).rejects.toThrow('Usuário não autenticado.');

    expect(recoverCallable).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it('mantém UID vazio como validação local sem diagnóstico técnico', async () => {
    await expect(
      firstValueFrom(service.recoverForUser$('   '))
    ).rejects.toThrow('UID inválido para recuperação.');

    expect(recoverCallable).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it('preserva o resultado público e atualiza o store no caminho de sucesso', async () => {
    recoverCallable.mockResolvedValue({
      data: {
        ok: true,
        uid: 'user-1',
        created: true,
        recoveredAtMs: 1_790_000_000_000,
      },
    });

    await expect(
      firstValueFrom(service.recoverForUser$('user-1'))
    ).resolves.toEqual({
      user,
      created: true,
      recoveredAtMs: 1_790_000_000_000,
    });

    expect(recoverCallable).toHaveBeenCalledTimes(1);
    expect(getUserOnceFromFirestore$).toHaveBeenCalledWith('user-1');
    expect(setCurrentUser).toHaveBeenCalledWith(user);
    expect(report).not.toHaveBeenCalled();
  });

  it('diagnostica falha do callable silenciosamente e repropaga o erro original', async () => {
    const original = Object.assign(new Error('callable unavailable'), {
      code: 'functions/unavailable',
    });
    recoverCallable.mockRejectedValue(original);

    let received: unknown;
    try {
      await firstValueFrom(service.recoverForUser$('user-1'));
    } catch (error) {
      received = error;
    }

    expect(received).toBe(original);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(original, {
      feature: 'registration-recovery',
      operation: 'recoverForUser',
      fallbackMessage:
        'Não foi possível recuperar os dados básicos da conta.',
      presentation: { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'RegistrationRecoveryService',
        uid: 'user-1',
      },
    });
  });

  it('diagnostica resposta inválida do backend e preserva o erro público', async () => {
    recoverCallable.mockResolvedValue({
      data: {
        ok: true,
        uid: 'other-user',
        created: false,
        recoveredAtMs: 1_790_000_000_000,
      },
    });

    await expect(
      firstValueFrom(service.recoverForUser$('user-1'))
    ).rejects.toThrow('A recuperação retornou dados inválidos.');

    expect(getUserOnceFromFirestore$).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('diagnostica documento ausente após recuperação e não atualiza o store', async () => {
    recoverCallable.mockResolvedValue({
      data: {
        ok: true,
        uid: 'user-1',
        created: false,
        recoveredAtMs: 1_790_000_000_000,
      },
    });
    getUserOnceFromFirestore$.mockReturnValue(of(null));

    await expect(
      firstValueFrom(service.recoverForUser$('user-1'))
    ).rejects.toThrow(
      'O documento da conta não ficou disponível após a recuperação.'
    );

    expect(setCurrentUser).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('mantém o erro original se a própria camada canônica de diagnóstico falhar', async () => {
    const original = new Error('callable failed');
    recoverCallable.mockRejectedValue(original);
    report.mockImplementationOnce(() => {
      throw new Error('diagnostic unavailable');
    });

    let received: unknown;
    try {
      await firstValueFrom(service.recoverForUser$('user-1'));
    } catch (error) {
      received = error;
    }

    expect(received).toBe(original);
    expect(report).toHaveBeenCalledTimes(1);
  });
});
