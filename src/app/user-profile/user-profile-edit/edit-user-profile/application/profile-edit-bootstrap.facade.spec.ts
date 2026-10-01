import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ProfileEditBootstrapFacade } from './profile-edit-bootstrap.facade';

describe('ProfileEditBootstrapFacade', () => {
  function setup(input?: {
    uid?: string | null;
    user?: any | null;
    estados?: any[];
    municipios?: any[];
  }) {
    const get = vi.fn((name: string) =>
      name === 'id' || name === 'uid'
        ? (input?.uid === undefined ? 'u1' : input.uid)
        : null
    );
    const navigate = vi.fn(() => Promise.resolve(true));
    const getUser = vi.fn(() =>
      of(
        input?.user === undefined
          ? {
              uid: 'u1',
              nickname: 'Pessoa',
              estado: 'RJ',
              municipio: 'Rio de Janeiro',
            }
          : input.user
      )
    );
    const loadEstados$ = vi.fn(() =>
      of(input?.estados ?? [{ id: 1, sigla: 'RJ', nome: 'Rio de Janeiro' }])
    );
    const loadMunicipios$ = vi.fn(() =>
      of(input?.municipios ?? [{ id: 1, nome: 'Rio de Janeiro' }])
    );
    const showError = vi.fn();
    const report = vi.fn();

    const facade = new ProfileEditBootstrapFacade(
      { snapshot: { paramMap: { get } } } as any,
      { navigate } as any,
      { getUser } as any,
      { loadEstados$, loadMunicipios$ } as any,
      { showError } as any,
      { report } as any
    );

    return {
      facade,
      navigate,
      getUser,
      loadEstados$,
      loadMunicipios$,
      showError,
      report,
    };
  }

  it('carrega usuário owner e opções iniciais de localização', async () => {
    const { facade, getUser, loadEstados$, loadMunicipios$ } = setup();

    await expect(firstValueFrom(facade.load$())).resolves.toEqual({
      uid: 'u1',
      user: {
        uid: 'u1',
        nickname: 'Pessoa',
        estado: 'RJ',
        municipio: 'Rio de Janeiro',
      },
      estados: [{ id: 1, sigla: 'RJ', nome: 'Rio de Janeiro' }],
      municipios: [{ id: 1, nome: 'Rio de Janeiro' }],
    });

    expect(getUser).toHaveBeenCalledWith('u1');
    expect(loadEstados$).toHaveBeenCalledTimes(1);
    expect(loadMunicipios$).toHaveBeenCalledWith('RJ');
  });

  it('redireciona quando a rota não contém uid', () => {
    const { facade, getUser, showError, navigate } = setup({ uid: null });

    const values: unknown[] = [];
    facade.load$().subscribe((value) => values.push(value));

    expect(values).toEqual([]);
    expect(getUser).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith(
      'Não foi possível identificar o usuário para edição.'
    );
    expect(navigate).toHaveBeenCalledWith(['/perfil']);
  });

  it('diagnostica usuário privado ausente pelo ApplicationErrorService', () => {
    const { facade, report } = setup({ user: null });

    const values: unknown[] = [];
    facade.load$().subscribe((value) => values.push(value));

    expect(values).toEqual([]);
    expect(report).toHaveBeenCalledWith(
      expect.any(Error),
      {
        feature: 'profile-edit',
        operation: 'ProfileEditBootstrapFacade.load',
        fallbackMessage:
          'Falha ao carregar seus dados para edição.',
        metadata: {
          scope: 'ProfileEditBootstrapFacade',
          hasUid: true,
        },
      }
    );
  });
});
