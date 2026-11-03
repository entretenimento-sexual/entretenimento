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
  });  it('re-emite um estado igual ao mudar de perfil sem repetir eventos dentro do mesmo perfil', () => {
    const { facade, watchFriends, watchOutboundRequests } = setup();
    const target$ = new BehaviorSubject('profile-a');
    const relations: Array<{ statusVerified: boolean; isFriend: boolean }> = [];
    const sub = facade.observe$(of('viewer'), target$).subscribe((relation) => {
      relations.push({
        statusVerified: relation.statusVerified,
        isFriend: relation.isFriend,
      });
    });

    expect(relations).toEqual([{ statusVerified: true, isFriend: false }]);
    facade.refresh();
    // Refreshing a confirmed, unchanged relation need not repaint the UI.
    expect(relations).toHaveLength(1);

    target$.next('profile-b');
    // A new profile must emit even if its relationship data is identical.
    // The component depends on this emission to refresh aria-labels.
    expect(relations).toEqual([
      { statusVerified: true, isFriend: false },
      { statusVerified: true, isFriend: false },
    ]);
    expect(watchFriends).toHaveBeenCalledTimes(3);
    expect(watchOutboundRequests).toHaveBeenCalledTimes(3);
    sub.unsubscribe();
  });

  it('não mantém estado desconhecido do perfil anterior após troca de alvo', () => {
    const { facade, watchFriends } = setup({ friendsError: new Error('offline') });
    const target$ = new BehaviorSubject('profile-a');
    const verified: boolean[] = [];
    const sub = facade.observe$(of('viewer'), target$)
      .subscribe(({ statusVerified }) => verified.push(statusVerified));

    target$.next('profile-b');
    expect(verified).toEqual([false, false]);
    expect(watchFriends).toHaveBeenCalledTimes(2);
    sub.unsubscribe();
  });
});
