import { BehaviorSubject, firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { VisitedProfileFriendshipFacade } from './visited-profile-friendship.facade';

describe('VisitedProfileFriendshipFacade', () => {
  function setup(input?: {
    outbound?: any[];
    friends?: any[];
    outboundError?: unknown;
    friendsError?: unknown;
  }) {
    const watchOutboundRequests = vi.fn(() =>
      input?.outboundError
        ? throwError(() => input.outboundError)
        : of(input?.outbound ?? [])
    );
    const watchFriends = vi.fn(() =>
      input?.friendsError
        ? throwError(() => input.friendsError)
        : of(input?.friends ?? [])
    );
    const report = vi.fn();

    const facade = new VisitedProfileFriendshipFacade(
      { watchOutboundRequests, watchFriends } as any,
      { report } as any
    );

    return { facade, watchOutboundRequests, watchFriends, report };
  }

  it('marca amizade existente', async () => {
    const { facade } = setup({
      friends: [{ friendUid: 'target' }],
    });

    await expect(
      firstValueFrom(facade.observe$(of('viewer'), of('target')))
    ).resolves.toEqual({
      isFriend: true,
      hasPendingOutboundRequest: false,
      statusVerified: true,
    });
  });

  it('marca solicitação pendente de saída', async () => {
    const { facade } = setup({
      outbound: [{ targetUid: 'target', status: 'pending' }],
    });

    await expect(
      firstValueFrom(facade.observe$(of('viewer'), of('target')))
    ).resolves.toEqual({
      isFriend: false,
      hasPendingOutboundRequest: true,
      statusVerified: true,
    });
  });

  it('não observa backend para perfil próprio ou uid ausente', async () => {
    const { facade, watchOutboundRequests, watchFriends } = setup();

    await expect(
      firstValueFrom(facade.observe$(of('viewer'), of('viewer')))
    ).resolves.toEqual({
      isFriend: false,
      hasPendingOutboundRequest: false,
      statusVerified: false,
    });

    expect(watchOutboundRequests).not.toHaveBeenCalled();
    expect(watchFriends).not.toHaveBeenCalled();
  });

  it('mantém fallback conservador e diagnóstico silencioso em falha', async () => {
    const error = new Error('friendship failed');
    const { facade, report } = setup({
      friendsError: error,
    });

    await expect(
      firstValueFrom(facade.observe$(of('viewer'), of('target')))
    ).resolves.toEqual({
      isFriend: false,
      hasPendingOutboundRequest: false,
      statusVerified: false,
    });

    expect(report).toHaveBeenCalledWith(error, {
      feature: 'profile-view',
      operation: 'VisitedProfileFriendshipFacade.watchFriends',
      fallbackMessage:
        'Não foi possível atualizar o estado de conexão deste perfil.',
      presentation: { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'VisitedProfileFriendshipFacade',
        hasTargetUid: true,
      },
    });
  });
  it('bloqueia interesse caso o observador de solicitações falhe', async () => {
    const { facade, report } = setup({
      outboundError: new Error('requests unreadable'),
      friends: [],
    });
    await expect(
      firstValueFrom(facade.observe$(of('viewer'), of('target')))
    ).resolves.toEqual({
      isFriend: false,
      hasPendingOutboundRequest: false,
      statusVerified: false,
    });
    expect(report).toHaveBeenCalledOnce();
  });

  it('pode recuperar o estado de conexão por refresh sem trocar o UID', () => {
    const { facade, watchFriends } = setup();
    const target$ = new BehaviorSubject('target');
    vi.mocked(watchFriends)
      .mockImplementationOnce(() => throwError(() => new Error('offline')))
      .mockImplementation(() => of([{ friendUid: 'target' }]));
    const states: boolean[] = [];
    const subscription = facade.observe$(of('viewer'), target$)
      .subscribe((relation) => states.push(relation.statusVerified));
    expect(states).toEqual([false]);
    facade.refresh();
    expect(states).toEqual([false, true]);
    expect(watchFriends).toHaveBeenCalledTimes(2);
    subscription.unsubscribe();
  });
});
