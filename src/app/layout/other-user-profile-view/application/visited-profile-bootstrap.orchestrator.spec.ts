import { convertToParamMap } from '@angular/router';
import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { VisitedProfileBootstrapOrchestrator } from './visited-profile-bootstrap.orchestrator';

describe('VisitedProfileBootstrapOrchestrator', () => {
  function setup(input?: {
    route?: Record<string, string>;
    authUid?: string | null;
    profile?: any | null;
    navigateOk?: boolean;
  }) {
    const navigate = vi.fn(() =>
      input?.navigateOk === false
        ? Promise.reject(new Error('navigation failed'))
        : Promise.resolve(true)
    );
    const getPublicUserById$ = vi.fn(() => of(input?.profile ?? null));
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

    expect(getPublicUserById$).toHaveBeenCalledWith('target');
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
