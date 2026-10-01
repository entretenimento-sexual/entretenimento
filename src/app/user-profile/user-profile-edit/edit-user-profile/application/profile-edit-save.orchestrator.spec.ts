import { firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ProfileEditSaveOrchestrator } from './profile-edit-save.orchestrator';

describe('ProfileEditSaveOrchestrator', () => {
  function setup(error?: unknown) {
    const atualizarUsuario = vi.fn(() =>
      error ? throwError(() => error) : of(void 0)
    );
    const report = vi.fn();

    return {
      orchestrator: new ProfileEditSaveOrchestrator(
        { atualizarUsuario } as any,
        { report } as any
      ),
      atualizarUsuario,
      report,
    };
  }

  it('salva perfil individual com normalização canônica', async () => {
    const { orchestrator, atualizarUsuario } = setup();

    await firstValueFrom(
      orchestrator.save$(
        ' u1 ',
        {
          nickname: '  Alex  ',
          estado: ' RJ ',
          municipio: ' Rio de Janeiro ',
          gender: 'homem',
          descricao: 'Descrição',
          orientation: ' heterossexual ',
          idade: '30',
          partner1Orientation: 'bissexual',
          partner2Orientation: 'pansexual',
        },
        false,
        'photo-url'
      )
    );

    expect(atualizarUsuario).toHaveBeenCalledWith('u1', {
      nickname: 'Alex',
      estado: 'RJ',
      municipio: 'Rio de Janeiro',
      gender: 'homem',
      descricao: 'Descrição',
      orientation: 'heterossexual',
      idade: 30,
      partner1Orientation: undefined,
      partner2Orientation: undefined,
      photoURL: 'photo-url',
    });
  });

  it('salva casal usando orientações dos dois perfis', async () => {
    const { orchestrator, atualizarUsuario } = setup();

    await firstValueFrom(
      orchestrator.save$(
        'u1',
        {
          nickname: 'Casal',
          gender: 'casal-ele-ela',
          orientation: 'heterossexual',
          idade: 101,
          partner1Orientation: ' bissexual ',
          partner2Orientation: ' pansexual ',
        },
        true,
        null
      )
    );

    expect(atualizarUsuario).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({
        orientation: '',
        idade: undefined,
        partner1Orientation: 'bissexual',
        partner2Orientation: 'pansexual',
        photoURL: null,
      })
    );
  });

  it('diagnostica falha de persistência e não inventa sucesso', () => {
    const error = new Error('save failed');
    const { orchestrator, report } = setup(error);

    const values: unknown[] = [];
    orchestrator
      .save$('u1', {}, false, null)
      .subscribe((value) => values.push(value));

    expect(values).toEqual([]);
    expect(report).toHaveBeenCalledWith(error, {
      feature: 'profile-edit',
      operation: 'ProfileEditSaveOrchestrator.save',
      fallbackMessage: 'Não foi possível salvar agora.',
      metadata: {
        scope: 'ProfileEditSaveOrchestrator',
      },
    });
  });
});
