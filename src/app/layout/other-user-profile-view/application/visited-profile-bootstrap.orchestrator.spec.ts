import { convertToParamMap } from '@angular/router';
import { firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { VisitedProfileBootstrapOrchestrator } from './visited-profile-bootstrap.orchestrator';

describe('VisitedProfileBootstrapOrchestrator', () => {
  function setup(input?: {
    route?: Record<string, string>;
    authUid?: string | null;
    profile?: any | null;
    navigateOk?: boolean;
    profileError?: Error;
  }) {
    const navigate = vi.fn(() =>
      input?.navigateOk === false
        ? Promise.reject(new Error('navigation failed'))
        : Promise.resolve(true)
    );
    const getPublicUserById$ = vi.fn(() =>
      input?.profileError
        ? throwError(() => input.profileError)
        : of(input?.profile ?? null)
    );
    const report = vi.fn();

    const orchestrator = new VisitedProfileBootstrapOrchestrator(
      {
        snapshot: {
          paramMap: convertToParamMap(input?.route ?? { id: 'target' }),
        },
      } as any,
      { navigate } as any,
      { uid$: of(input?.authUid ?? 'viewer') } as any,
      { getPublicUserById$ } as any,
      { report } as any
    );

    return {
      orchestrator,
      navigate,
      getPublicUserById$,
      report,
    };
  }

  it('prioriza UID explícito emitido pela rota reutilizada, não o snapshot anterior', async () => {
    const profile = { uid: 'novo-alvo', nickname: 'Outro perfil' };
    const { orchestrator, getPublicUserById$ } = setup({
      route: { id: 'alvo-anterior' },
      profile,
    });

    await expect(firstValueFrom(orchestrator.load$('novo-alvo'))).resolves.toEqual({
      kind: 'loaded',
      targetUid: 'novo-alvo',
      profile,
    });
    expect(getPublicUserById$).toHaveBeenCalledWith('novo-alvo', {
      propagateErrors: true,
    });
  });

  it('não reutiliza o snapshot ao receber rota atual sem UID', async () => {
    const { orchestrator, getPublicUserById$ } = setup({
      route: { id: 'alvo-anterior' },
    });

    await expect(firstValueFrom(orchestrator.load$(''))).resolves.toEqual({
      kind: 'missing',
      targetUid: null,
    });
    expect(getPublicUserById$).not.toHaveBeenCalled();
  });

  it('carrega apenas a projeção pública do perfil alheio', async () => {
    const profile = { uid: 'target', nickname: 'Pessoa' };
    const { orchestrator, getPublicUserById$, navigate } = setup({
      profile,
    });

    await expect(firstValueFrom(orchestrator.load$())).resolves.toEqual({
      kind: 'loaded',
      targetUid: 'target',
      profile,
    });

    expect(getPublicUserById$).toHaveBeenCalledWith('target', {
      propagateErrors: true,
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('redireciona perfil próprio sem consultar a projeção pública', async () => {
    const { orchestrator, getPublicUserById$, navigate } = setup({
      authUid: 'target',
      profile: { uid: 'target' },
    });

    await expect(firstValueFrom(orchestrator.load$())).resolves.toEqual({
      kind: 'redirect-own-profile',
      targetUid: 'target',
    });

    expect(navigate).toHaveBeenCalledWith(['/perfil'], {
      replaceUrl: true,
    });
    expect(getPublicUserById$).not.toHaveBeenCalled();
  });

  it('trata rota sem UID como missing e diagnóstico silencioso', async () => {
    const { orchestrator, report, getPublicUserById$ } = setup({
      route: {},
    });

    await expect(firstValueFrom(orchestrator.load$())).resolves.toEqual({
      kind: 'missing',
      targetUid: null,
    });

    expect(getPublicUserById$).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith(
      expect.any(Error),
      {
        feature: 'profile-view',
        operation: 'VisitedProfileBootstrapOrchestrator.route',
        fallbackMessage: 'UID não encontrado na rota.',
        presentation: { surface: 'none', severity: 'error' },
        metadata: {
          scope: 'VisitedProfileBootstrapOrchestrator',
        },
      }
    );
  });

  it('distingue quota 429 de perfil inexistente e permite retry da tela', async () => {
    const error = Object.assign(new Error('Muitas consultas de perfis'), {
      code: 'functions/resource-exhausted',
    });
    const { orchestrator, report } = setup({ profileError: error });

    await expect(firstValueFrom(orchestrator.load$())).resolves.toEqual({
      kind: 'load-error',
      targetUid: 'target',
    });

    expect(report).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        feature: 'profile-view',
        operation: 'VisitedProfileBootstrapOrchestrator.loadPublicProfile',
      })
    );
  });

  it('mantém perfil público inexistente como missing com feedback canônico', async () => {
    const { orchestrator, report } = setup({
      profile: null,
    });

    await expect(firstValueFrom(orchestrator.load$())).resolves.toEqual({
      kind: 'missing',
      targetUid: 'target',
    });

    expect(report).toHaveBeenCalledWith(
      expect.any(Error),
      {
        feature: 'profile-view',
        operation:
          'VisitedProfileBootstrapOrchestrator.missingPublicProfile',
        fallbackMessage: 'Usuário não encontrado ou indisponível.',
        presentation: undefined,
        metadata: {
          scope: 'VisitedProfileBootstrapOrchestrator',
        },
      }
    );
  });
});
