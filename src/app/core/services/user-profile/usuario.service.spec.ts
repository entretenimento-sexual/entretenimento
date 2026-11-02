import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { UsuarioService } from './usuario.service';

describe('UsuarioService / proteção da identidade registrada', () => {
  function setup() {
    const updateDocument = vi.fn(() => of(void 0));
    return {
      service: new UsuarioService({ updateDocument } as any),
      updateDocument,
    };
  }

  it('salva descrição normalmente sem enviar autoridade de identidade', async () => {
    const { service, updateDocument } = setup();
    await firstValueFrom(service.atualizarUsuario('u1', {
      nickname: 'Perfil', descricao: 'Texto atualizado',
    }));

    const call = updateDocument.mock.lastCall as unknown as [
      string, string, Record<string, unknown>, Record<string, unknown>
    ];
    expect(call[0]).toBe('users');
    expect(call[1]).toBe('u1');
    expect(call[2]).not.toHaveProperty('nickname');
    expect(call[2]).not.toHaveProperty('gender');
    expect(call[2]).not.toHaveProperty('declaredIdentityCode');
    expect(call[2]).toHaveProperty('descricao', 'Texto atualizado');
  });

  it('não aceita envio de gênero nem de campos canônicos, mesmo por cliente manipulado', async () => {
    const { service, updateDocument } = setup();
    for (const input of [
      { gender: 'homem' },
      { declaredIdentityCode: 'mulher' },
      { identityCatalogVersion: 2 },
    ]) {
      await expect(firstValueFrom(service.atualizarUsuario('u1', input)))
        .rejects.toMatchObject({ code: 'profile/identity-change-requires-review' });
    }
    expect(updateDocument).not.toHaveBeenCalled();
  });
});
