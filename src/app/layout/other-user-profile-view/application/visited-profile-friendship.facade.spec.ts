import { BehaviorSubject, firstValueFrom, Observable, of, Subject, throwError } from 'rxjs';
import { filter } from 'rxjs/operators';
import { describe, expect, it, vi } from 'vitest';

import { VisitedProfileFriendshipFacade, type VisitedProfileFriendshipRelation } from './visited-profile-friendship.facade';

describe('VisitedProfileFriendshipFacade', () => {
  function setup(input?: {
    outbound?: any[];
    friends?: any[];
    blocked?: boolean;
    blocked$?: Observable<boolean>;
    outboundError?: unknown;
    friendsError?: unknown;
    blockedError?: unknown;
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
    const watchBlocked = vi.fn(() =>
      input?.blockedError
        ? throwError(() => input.blockedError)
        : input?.blocked$ ?? of(input?.blocked ?? false)
    );
    const report = vi.fn();

    const facade = new VisitedProfileFriendshipFacade(
      { watchOutboundRequests, watchFriends, watchBlocked } as any,
      { report } as any
    );

    return { facade, watchOutboundRequests, watchFriends, watchBlocked, report };
  }

  function collect(facade: VisitedProfileFriendshipFacade, target$ = of('target')) {
    const values: VisitedProfileFriendshipRelation[] = [];
    const subscription = facade.observe$(of('viewer'), target$)
      .subscribe((relation) => values.push(relation));
    return { values, subscription };
  }

  it('marca amizade existente somente após a leitura dos três estados', async () => {
    const { facade } = setup({ friends: [{ friendUid: 'target' }] });
    await expect(
      firstValueFrom(facade.observe$(of('viewer'), of('target')).pipe(
        filter((relation) => relation.statusVerified)
      ))
    ).resolves.toEqual({
      isFriend: true,
      hasPendingOutboundRequest: false,
      statusVerified: true,
      isBlocked: false,
    });
  });

  it('marca solicitação pendente de saída', async () => {
    const { facade } = setup({
      outbound: [{ targetUid: 'target', status: 'pending' }],
    });
    await expect(
      firstValueFrom(facade.observe$(of('viewer'), of('target')).pipe(
        filter((relation) => relation.statusVerified)
      ))
    ).resolves.toEqual({
      isFriend: false,
      hasPendingOutboundRequest: true,
      statusVerified: true,
      isBlocked: false,
    });
  });

  it('não observa backend para perfil próprio ou uid ausente', async () => {
    const { facade, watchOutboundRequests, watchFriends, watchBlocked } = setup();
    await expect(firstValueFrom(facade.observe$(of('viewer'), of('viewer'))))
      .resolves.toEqual({
        isFriend: false,
        hasPendingOutboundRequest: false,
        statusVerified: false,
        isBlocked: false,
      });
    expect(watchOutboundRequests).not.toHaveBeenCalled();
    expect(watchFriends).not.toHaveBeenCalled();
    expect(watchBlocked).not.toHaveBeenCalled();
  });

  it('mantém fallback conservador e diagnóstico silencioso em falha', () => {
    const error = new Error('friendship failed');
    const { facade, report } = setup({ friendsError: error });
    const { values, subscription } = collect(facade);

    expect(values.at(-1)).toEqual({
      isFriend: false,
      hasPendingOutboundRequest: false,
      statusVerified: false,
      isBlocked: false,
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
    subscription.unsubscribe();
  });

  it('bloqueia interesse caso o observador de solicitações falhe', () => {
    const { facade, report } = setup({
      outboundError: new Error('requests unreadable'),
    });
    const { values, subscription } = collect(facade);
    expect(values.at(-1)?.statusVerified).toBe(false);
    expect(report).toHaveBeenCalledOnce();
    subscription.unsubscribe();
  });

  it('falha fechado se a leitura de bloqueio próprio for negada', () => {
    const { facade, report } = setup({ blockedError: new Error('permission denied') });
    const { values, subscription } = collect(facade);
    expect(values.at(-1)?.statusVerified).toBe(false);
    expect(values.at(-1)?.isBlocked).toBe(false);
    expect(report).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        operation: 'VisitedProfileFriendshipFacade.watchBlocked',
        presentation: { surface: 'none', severity: 'error' },
      })
    );
    subscription.unsubscribe();
  });

  it('usa bloqueio conhecido para negar interação mesmo com outro observador em erro', () => {
    const { facade } = setup({ blocked: true, friendsError: new Error('offline') });
    const { values, subscription } = collect(facade);
    expect(values.at(-1)).toEqual({
      isFriend: false,
      hasPendingOutboundRequest: false,
      statusVerified: true,
      isBlocked: true,
    });
    subscription.unsubscribe();
  });

  it('começa não verificado até a leitura de bloqueio concluir', () => {
    const pendingBlocked$ = new Subject<boolean>();
    const { facade } = setup({ blocked$: pendingBlocked$ });
    const { values, subscription } = collect(facade);
    expect(values).toEqual([{
      isFriend: false,
      hasPendingOutboundRequest: false,
      statusVerified: false,
      isBlocked: false,
    }]);
    pendingBlocked$.next(false);
    expect(values.at(-1)?.statusVerified).toBe(true);
    subscription.unsubscribe();
  });

  it('revoga e restaura a interação na mudança do bloqueio próprio', () => {
    const blocked$ = new BehaviorSubject(false);
    const { facade, watchBlocked } = setup({
      blocked$: blocked$,
      friends: [{ friendUid: 'target' }],
      outbound: [{ targetUid: 'target', status: 'pending' }],
    });
    const { values, subscription } = collect(facade);
    expect(values.at(-1)?.isFriend).toBe(true);
    expect(values.at(-1)?.isBlocked).toBe(false);

    blocked$.next(true);
    expect(values.at(-1)).toEqual({
      isFriend: false,
      hasPendingOutboundRequest: false,
      statusVerified: true,
      isBlocked: true,
    });

    blocked$.next(false);
    expect(values.at(-1)?.isFriend).toBe(true);
    expect(values.at(-1)?.isBlocked).toBe(false);
    expect(watchBlocked).toHaveBeenCalledWith('viewer', 'target');
    subscription.unsubscribe();
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

  it('re-emite estado seguro ao trocar de perfil, mesmo com relações iguais', () => {
    const { facade, watchFriends, watchOutboundRequests } = setup();
    const target$ = new BehaviorSubject('profile-a');
    const statuses: boolean[] = [];
    const sub = facade.observe$(of('viewer'), target$)
      .subscribe((relation) => statuses.push(relation.statusVerified));

    expect(statuses).toEqual([false, true]);
    facade.refresh();
    expect(statuses).toEqual([false, true, false, true]);
    target$.next('profile-b');
    expect(statuses).toEqual([false, true, false, true, false, true]);
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
