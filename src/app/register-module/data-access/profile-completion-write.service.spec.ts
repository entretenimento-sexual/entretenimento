import { firstValueFrom } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ProfileCompletionWriteService } from './profile-completion-write.service';

function createService(): ProfileCompletionWriteService {
  return new ProfileCompletionWriteService(
    {} as any,
    {} as any,
    { handleError: vi.fn() } as any
  );
}

function validInput() {
  return {
    uid: 'user-1',
    nickname: 'perfil teste',
    gender: 'homem',
    orientation: 'bissexual',
    estado: 'RJ',
    municipio: 'Rio de Janeiro',
  };
}

describe('ProfileCompletionWriteService validation', () => {
  it('rejeita gênero fora das opções canônicas antes de gravar', async () => {
    const service = createService();

    await expect(
      firstValueFrom(
        service.complete$({
          ...validInput(),
          gender: 'valor-inventado',
        })
      )
    ).rejects.toMatchObject({ code: 'profile/invalid-gender' });
  });

  it('rejeita UF inválida antes de marcar o perfil como concluído', async () => {
    const service = createService();

    await expect(
      firstValueFrom(
        service.complete$({
          ...validInput(),
          estado: 'XX',
        })
      )
    ).rejects.toMatchObject({ code: 'profile/invalid-state' });
  });

  it('rejeita município vazio antes de marcar o perfil como concluído', async () => {
    const service = createService();

    await expect(
      firstValueFrom(
        service.complete$({
          ...validInput(),
          municipio: '   ',
        })
      )
    ).rejects.toMatchObject({ code: 'profile/invalid-city' });
  });

  it('permite orientação vazia como campo opcional e avança para a transação', async () => {
    const transactionError = new Error('transaction reached');
    const ctx = {
      run: vi.fn(() => ({})),
      deferPromise$: vi.fn(() => {
        throw transactionError;
      }),
    };
    const service = new ProfileCompletionWriteService(
      {} as any,
      ctx as any,
      { handleError: vi.fn() } as any
    );

    expect(() =>
      service.complete$({
        ...validInput(),
        orientation: '',
      })
    ).toThrow(transactionError);
  });
});
