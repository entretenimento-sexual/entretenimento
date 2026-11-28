// src/app/core/services/interactions/friendship/repo/requests.repo.spec.ts
import { EnvironmentInjector } from '@angular/core';
import { BehaviorSubject, Observable, firstValueFrom, take, throwError } from 'rxjs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

describe('RequestsRepo', () => {
  let RequestsRepoToken: any;
  let repo: any;
  let uid$: BehaviorSubject<string | null>;
  let authUser$: BehaviorSubject<{ uid: string } | null>;
  let session: { currentAuthUser: { uid: string } | null; uid$: BehaviorSubject<string | null>; authUser$: BehaviorSubject<{ uid: string } | null>; terminationVersionSnapshot: number; isTerminatingSnapshot: boolean };

  function setUser(uid: string) {
    session.currentAuthUser = { uid };
    authUser$.next(session.currentAuthUser);
    uid$.next(uid);
  }

  type Snapshot = { metadata: { fromCache: boolean; hasPendingWrites: boolean }; exists(): boolean; data(): Record<string, unknown> };
  function revision(inbound = 0, outbound = 0, fromCache = false, membership = 0): Snapshot {
    return { metadata: { fromCache, hasPendingWrites: false }, exists: () => true,
      data: () => ({ pendingFriendRequestsInboundRevision: inbound, pendingFriendRequestsOutboundRevision: outbound,
        friendshipMembershipRevision: membership }) };
  }
  let revision$: BehaviorSubject<Snapshot>;
  let online$: BehaviorSubject<boolean>;
  let visibility: 'visible' | 'hidden';
  let visibilityEvents: EventTarget;
  const onSnapshot = vi.fn((_ref: unknown, _opts: unknown, next: (snapshot: Snapshot) => void) => {
    const sub = revision$.subscribe(next);
    return () => sub.unsubscribe();
  });
  const doc = vi.fn((_db: unknown, ...path: string[]) => path.join('/'));
  const report = vi.fn();
  const log = vi.fn();
  const callable = vi.fn();
  const httpsCallable = vi.fn(() => callable);
  const db = {} as any;
  const functions = {} as any;
  const env = {
    runInContext: <T>(fn: () => T) => fn(),
  } as unknown as EnvironmentInjector;

  beforeAll(async () => {
    vi.resetModules();
    vi.doMock('@angular/fire/functions', () => ({
      Functions: class Functions {},
      httpsCallable,
    }));
    vi.doMock('@angular/fire/firestore', () => ({
      Firestore: class Firestore {},
      doc,
      onSnapshot,
    }));

    const repoModule = await import('./requests.repo');
    RequestsRepoToken = repoModule.RequestsRepo;
  });

  afterAll(() => {
    vi.doUnmock('@angular/fire/functions');
    vi.doUnmock('@angular/fire/firestore');
    vi.resetModules();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    uid$ = new BehaviorSubject<string | null>('bob');
    authUser$ = new BehaviorSubject<{ uid: string } | null>({ uid: 'bob' });
    session = { currentAuthUser: authUser$.value, uid$, authUser$, terminationVersionSnapshot: 0, isTerminatingSnapshot: false };
    revision$ = new BehaviorSubject(revision());
    online$ = new BehaviorSubject(true);
    visibility = 'visible';
    visibilityEvents = new EventTarget();
    Object.defineProperty(visibilityEvents, 'visibilityState', { get: () => visibility });
    repo = new RequestsRepoToken(db, env, functions, session, { report }, { log }, { isOnline$: online$ }, visibilityEvents);
  });

  it('compartilha revisão de amizades com solicitações sem gerar leituras redundantes', async () => {
    vi.useFakeTimers();
    const seen = vi.fn();
    callable.mockResolvedValue({ data: { items: [] } });
    const pending = repo.watchOutboundRequests('bob','session').subscribe();
    const membership = repo.watchFriendshipMembership('bob').subscribe(seen);
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(onSnapshot).toHaveBeenCalledTimes(1);
      expect(callable).toHaveBeenCalledTimes(1);
      expect(seen.mock.calls).toEqual([[true]]);
      revision$.next(revision(0,0,false,1));
      await vi.advanceTimersByTimeAsync(0);
      expect(seen.mock.calls).toEqual([[true],[true]]);
      expect(callable).toHaveBeenCalledTimes(1);
      // Uma atualização apenas de solicitações não invalida amigos.
      revision$.next(revision(1,0,false,1));
      await vi.advanceTimersByTimeAsync(0);
      expect(seen.mock.calls).toEqual([[true],[true]]);
      revision$.next(revision(1,0,true,999));
      expect(seen.mock.calls).toEqual([[true],[true],[false]]);
      revision$.next(revision(1,0,false,1));
      expect(seen.mock.calls).toEqual([[true],[true],[false],[true]]);
      // Mesmo UID, novo objeto de sessão: consumidor antigo é encerrado.
      setUser('bob');
      expect(membership.closed).toBe(true);
      revision$.next(revision(1,0,false,2));
      expect(seen).toHaveBeenCalledTimes(4);
    } finally {
      membership.unsubscribe(); pending.unsubscribe(); vi.useRealTimers();
    }
  });

  it('contabiliza uma admissão até o início do transporte', async () => {
    callable.mockResolvedValue({ data: { items: [] } });
    await firstValueFrom(repo.listInboundRequests('bob'));
    expect(log).toHaveBeenCalledWith('friends', 'pending-admission 1 inbound queued');
    expect(log).toHaveBeenCalledWith('friends', 'pending-admission 1 inbound admitted');
    expect(log).toHaveBeenCalledWith('friends', 'pending-admission 1 inbound transport-started');
    expect(log).not.toHaveBeenCalledWith('friends', 'pending-admission 1 inbound cancelled');
    expect(callable).toHaveBeenCalledTimes(1);
  });

  it('cancela uma admissão em espera quando o último consumidor sai, sem transporte', () => {
    const cleanup = vi.fn();
    vi.spyOn(repo.admission, 'wait$').mockImplementation((_uid: unknown, _current: unknown, onWait: unknown) =>
      new Observable<void>(() => {
        (onWait as () => void)();
        return cleanup;
      }));
    const a = repo.listOutboundRequests('bob').subscribe();
    const b = repo.listOutboundRequests('bob').subscribe();
    a.unsubscribe();
    expect(cleanup).not.toHaveBeenCalled();
    b.unsubscribe();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith('friends', 'pending-admission 1 outbound waiting');
    expect(log).toHaveBeenCalledWith('friends', 'pending-admission 1 outbound cancelled');
    expect(log).not.toHaveBeenCalledWith('friends', 'pending-admission 1 outbound transport-started');
    expect(callable).not.toHaveBeenCalled();
  });

  it('registra expiração sem mascarar o erro tipado nem contabilizar transporte', async () => {
    const error = Object.assign(new Error('quota'), { code: 'functions/resource-exhausted' });
    vi.spyOn(repo.admission, 'wait$').mockReturnValue(throwError(() => error));
    await expect(firstValueFrom(repo.listOutboundRequests('bob'))).rejects.toBe(error);
    expect(log).toHaveBeenCalledWith('friends', 'pending-admission 1 outbound expired');
    expect(log).not.toHaveBeenCalledWith('friends', 'pending-admission 1 outbound cancelled');
    expect(callable).not.toHaveBeenCalled();
  });

  it('lista solicitações recebidas pela callable canônica', async () => {
    callable.mockResolvedValue({
      data: {
        items: [{
          id: 'req-in',
          requesterUid: 'alice',
          targetUid: 'bob',
          status: 'pending',
        }],
        fetchedAt: 1,
        scanned: 1,
      },
    });

    const items = await firstValueFrom(repo.listInboundRequests('bob'));

    expect(httpsCallable).toHaveBeenCalledWith(
      functions,
      'getPendingFriendRequests'
    );
    expect(callable).toHaveBeenCalledWith({
      direction: 'inbound',
      limit: 60,
    });
    expect(items).toEqual([
      expect.objectContaining({ id: 'req-in', status: 'pending' }),
    ]);
  });

  it('lista solicitações enviadas pela mesma fronteira backend-only', async () => {
    callable.mockResolvedValue({
      data: {
        items: [{
          id: 'req-out',
          requesterUid: 'alice',
          targetUid: 'bob',
          status: 'pending',
        }],
        fetchedAt: 1,
        scanned: 1,
      },
    });

    setUser('alice');
    const items = await firstValueFrom(repo.listOutboundRequests('alice'));

    expect(callable).toHaveBeenCalledWith({
      direction: 'outbound',
      limit: 60,
    });
    expect(items).toHaveLength(1);
  });

  it('compartilha chamadas simultâneas da mesma direção, sem armazenar respostas', async () => {
    let complete!: (value: unknown) => void;
    callable.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const a = firstValueFrom(repo.listInboundRequests('bob'));
    const b = firstValueFrom(repo.listInboundRequests('bob'));
    expect(callable).toHaveBeenCalledTimes(1);
    complete({ data: { items: [{ id: 'pending' }] } });
    expect(await a).toEqual([{ id: 'pending' }]);
    expect(await b).toEqual([{ id: 'pending' }]);
    callable.mockResolvedValueOnce({ data: { items: [] } });
    await firstValueFrom(repo.listInboundRequests('bob'));
    expect(callable).toHaveBeenCalledTimes(2);
  });

  it('não consulta solicitações para um UID diferente da sessão ativa', async () => {
    await expect(firstValueFrom(repo.listInboundRequests('alice'))).rejects.toMatchObject({
      code: 'functions/permission-denied',
    });
    expect(callable).not.toHaveBeenCalled();
  });

  it('compartilha um relógio entre consumidores sem replay de resposta concluída', async () => {
    vi.useFakeTimers();
    const subscriptions: { unsubscribe(): void }[] = [];
    try {
      callable.mockResolvedValue({ data: { items: [{ id: 'first' }] } });
      const first: unknown[] = [], second: unknown[] = [], third: unknown[] = [];
      subscriptions.push(repo.watchOutboundRequests('bob').subscribe((value: unknown) => first.push(value)));
      await vi.advanceTimersByTimeAsync(0);
      expect(first).toEqual([[{ id: 'first' }]]);
      await vi.advanceTimersByTimeAsync(10_000);
      callable.mockResolvedValue({ data: { items: [{ id: 'fresh' }] } });
      subscriptions.push(repo.watchOutboundRequests('bob').subscribe((value: unknown) => second.push(value)));
      expect(second).toEqual([]);
      await vi.advanceTimersByTimeAsync(0);
      expect(second).toEqual([[{ id: 'fresh' }]]);
      expect(first.at(-1)).toEqual(second[0]);
      subscriptions.push(repo.watchOutboundRequests('bob').subscribe((value: unknown) => third.push(value)));
      expect(third).toEqual([]);
      await vi.advanceTimersByTimeAsync(0);
      expect(callable).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(110_000);
      expect(callable).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(callable).toHaveBeenCalledTimes(4);
      subscriptions.forEach(sub => sub.unsubscribe());
      await vi.advanceTimersByTimeAsync(181_000);
      expect(callable).toHaveBeenCalledTimes(4);
      subscriptions.push(repo.watchOutboundRequests('bob').subscribe());
      await vi.advanceTimersByTimeAsync(0);
      expect(callable).toHaveBeenCalledTimes(5);
    } finally {
      subscriptions.forEach(sub => sub.unsubscribe());
      vi.useRealTimers();
    }
  });

  it('consumidor que entra durante leitura pendente não reinicia o relógio nem recebe replay', async () => {
    vi.useFakeTimers();
    const subscriptions: { unsubscribe(): void }[] = [];
    try {
      let resolve!: (value: unknown) => void;
      callable.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
      callable.mockResolvedValue({ data: { items: [] } });
      const first = vi.fn(), second = vi.fn();
      subscriptions.push(repo.watchOutboundRequests('bob', 'session').subscribe(first));
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(10_000);
      subscriptions.push(repo.watchOutboundRequests('bob', 'profile').subscribe(second));
      expect(second).not.toHaveBeenCalled();
      resolve({ data: { items: [{ id: 'fresh' }] } });
      await vi.advanceTimersByTimeAsync(0);
      expect(first).toHaveBeenCalledWith([{ id: 'fresh' }]);
      expect(second).toHaveBeenCalledWith([{ id: 'fresh' }]);
      expect(callable).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(110_000);
      expect(callable).toHaveBeenCalledTimes(2); // original clock, not 130s
      expect(log).toHaveBeenCalledWith('friends', 'pending-read start outbound session');
      expect(log).toHaveBeenCalledWith('friends', 'pending-read join outbound profile');
      expect(log).toHaveBeenCalledWith('friends', 'pending-read start outbound poll');
    } finally {
      subscriptions.forEach(sub => sub.unsubscribe());
      vi.useRealTimers();
    }
  });

  it('separa direções, descarta respostas tardias e reinicia para nova sessão do mesmo UID', async () => {
    vi.useFakeTimers();
    const subscriptions: { unsubscribe(): void }[] = [];
    try {
      let complete!: (value: unknown) => void;
      callable.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
      callable.mockResolvedValue({ data: { items: [{ id: 'new' }] } });
      const old: unknown[] = [], fresh: unknown[] = [];
      const done = vi.fn();
      subscriptions.push(repo.watchOutboundRequests('bob').subscribe({next: (v: unknown) => old.push(v), complete: done}));
      await vi.advanceTimersByTimeAsync(0);
      subscriptions.push(repo.watchOutboundRequests('bob').subscribe({next: (v: unknown) => old.push(v), complete: done}));
      await vi.advanceTimersByTimeAsync(0);
      expect(callable).toHaveBeenCalledTimes(1);
      subscriptions.push(repo.watchInboundRequests('bob').subscribe());
      await vi.advanceTimersByTimeAsync(0);
      expect(callable).toHaveBeenCalledTimes(2);
      setUser('bob'); // same UID, different SDK User object
      expect(done).toHaveBeenCalledTimes(2);
      subscriptions.push(repo.watchOutboundRequests('bob').subscribe((v: unknown) => fresh.push(v)));
      await vi.advanceTimersByTimeAsync(0);
      complete({ data: { items: [{ id: 'stale' }] } });
      await vi.advanceTimersByTimeAsync(0);
      expect(old).toEqual([]);
      expect(fresh).toEqual([[{ id: 'new' }]]);
      expect(callable).toHaveBeenCalledTimes(3);
      session.isTerminatingSnapshot = true;
      session.terminationVersionSnapshot++;
      authUser$.next(null);
      uid$.next(null);
      await vi.advanceTimersByTimeAsync(181_000);
      expect(callable).toHaveBeenCalledTimes(3);
    } finally {
      subscriptions.forEach(sub => sub.unsubscribe());
      vi.useRealTimers();
    }
  });

  it('encerra listeners no logout e descarta sucesso e erro antigos após login B', async () => {
    vi.useFakeTimers();
    const subs: { unsubscribe(): void }[] = [];
    try {
      let resolveOld!: (value: unknown) => void;
      let rejectOld!: (error: unknown) => void;
      callable.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
      callable.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; }));
      callable.mockResolvedValue({ data: { items: [{ id: 'new-b' }] } });
      const oldNext = vi.fn(), oldError = vi.fn(), oldComplete = vi.fn();
      for (const direction of ['Inbound', 'Outbound']) {
        subs.push(repo['watch' + direction + 'Requests']('bob', 'session').subscribe({
          next: oldNext, error: oldError, complete: oldComplete,
        }));
      }
      await vi.advanceTimersByTimeAsync(0);
      expect(callable).toHaveBeenCalledTimes(2);
      expect(revision$.observers).toHaveLength(1);
      session.isTerminatingSnapshot = true;
      session.terminationVersionSnapshot++;
      authUser$.next(null);
      uid$.next(null);
      expect(oldComplete).toHaveBeenCalledTimes(2);
      expect(revision$.observers).toHaveLength(0);
      session.isTerminatingSnapshot = false;
      setUser('alice');
      const fresh = vi.fn();
      subs.push(repo.watchOutboundRequests('alice', 'session').subscribe(fresh));
      await vi.advanceTimersByTimeAsync(0);
      resolveOld({ data: { items: [{ id: 'old-a' }] } });
      rejectOld(Object.assign(new Error('old error'), { code: 'functions/unavailable' }));
      await vi.advanceTimersByTimeAsync(0);
      expect(oldNext).not.toHaveBeenCalled();
      expect(oldError).not.toHaveBeenCalled();
      expect(fresh).toHaveBeenCalledTimes(1);
      expect(fresh).toHaveBeenCalledWith([{ id: 'new-b' }]);
      expect(callable).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(121_000);
      expect(callable).toHaveBeenCalledTimes(4);
      subs.forEach(sub => sub.unsubscribe());
      expect(revision$.observers).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(181_000);
      expect(callable).toHaveBeenCalledTimes(4);
    } finally {
      subs.forEach(sub => sub.unsubscribe());
      vi.useRealTimers();
    }
  });

  it('propaga falha aos consumidores e permite nova leitura sem cache', async () => {
    vi.useFakeTimers();
    const subscriptions: { unsubscribe(): void }[] = [];
    try {
      const error = Object.assign(new Error('unavailable'), { code: 'functions/unavailable' });
      callable.mockRejectedValueOnce(error);
      const errors = vi.fn();
      subscriptions.push(repo.watchInboundRequests('bob').subscribe({error: errors}));
      subscriptions.push(repo.watchInboundRequests('bob').subscribe({error: errors}));
      await vi.advanceTimersByTimeAsync(0);
      expect(errors).toHaveBeenCalledTimes(2);
      expect(errors).toHaveBeenCalledWith(error);
      expect(callable).toHaveBeenCalledTimes(1);
      callable.mockResolvedValue({ data: { items: [] } });
      const values = vi.fn();
      subscriptions.push(repo.watchInboundRequests('bob').subscribe(values));
      await vi.advanceTimersByTimeAsync(0);
      expect(values).toHaveBeenCalledWith([]);
      expect(callable).toHaveBeenCalledTimes(2);
    } finally {
      subscriptions.forEach(sub => sub.unsubscribe());
      vi.useRealTimers();
    }
  });

  it('invalida imediatamente somente a direção alterada e descarta resposta anterior', async () => {
    vi.useFakeTimers();
    const subs: { unsubscribe(): void }[] = [];
    try {
      let complete!: (value: unknown) => void;
      callable.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
      callable.mockResolvedValue({ data: { items: [{ id: 'fresh' }] } });
      const outbound: unknown[] = [], inbound: unknown[] = [];
      subs.push(repo.watchOutboundRequests('bob').subscribe((v: unknown) => outbound.push(v)));
      await vi.advanceTimersByTimeAsync(0);
      subs.push(repo.watchInboundRequests('bob').subscribe((v: unknown) => inbound.push(v)));
      await vi.advanceTimersByTimeAsync(0);
      expect(onSnapshot).toHaveBeenCalledTimes(1);
      expect(callable).toHaveBeenCalledTimes(2);
      revision$.next(revision(0, 1, true));
      await vi.advanceTimersByTimeAsync(0);
      expect(callable).toHaveBeenCalledTimes(2);
      revision$.next(revision(0, 1));
      await vi.advanceTimersByTimeAsync(0);
      expect(callable).toHaveBeenCalledTimes(3);
      expect(outbound).toEqual([[{ id: 'fresh' }]]);
      expect(inbound).toEqual([[{ id: 'fresh' }]]);
      complete({ data: { items: [{ id: 'stale' }] } });
      await vi.advanceTimersByTimeAsync(0);
      expect(outbound).toEqual([[{ id: 'fresh' }]]);
      revision$.next(revision(0, 1));
      await vi.advanceTimersByTimeAsync(0);
      expect(callable).toHaveBeenCalledTimes(3);
      subs.forEach(sub => sub.unsubscribe());
      expect(revision$.observers).toHaveLength(0);
    } finally {
      subs.forEach(sub => sub.unsubscribe());
      vi.useRealTimers();
    }
  });

  it('a listagem pontual não emite resposta de geração anterior após mutação', async () => {
    let complete!: (value: unknown) => void;
    callable.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    callable.mockResolvedValue({ data: { items: [{ id: 'new' }] } });
    const result = firstValueFrom(repo.listOutboundRequests('bob'));
    expect(callable).toHaveBeenCalledTimes(1);
    revision$.next(revision(0, 1));
    expect(callable).toHaveBeenCalledTimes(2);
    complete({ data: { items: [{ id: 'old' }] } });
    expect(await result).toEqual([{ id: 'new' }]);
  });

  it('adapta relógios direcionais à saúde, visibilidade e conectividade sem reiniciar consumidores', async () => {
    vi.useFakeTimers();
    const subs: { unsubscribe(): void }[] = [];
    const count = (direction: string) => callable.mock.calls.filter(([data]) => data.direction === direction).length;
    const show = (state: 'visible' | 'hidden') => {
      visibility = state;
      visibilityEvents.dispatchEvent(new Event('visibilitychange'));
    };
    try {
      callable.mockResolvedValue({ data: { items: [] } });
      subs.push(repo.watchInboundRequests('bob', 'session').subscribe());
      subs.push(repo.watchOutboundRequests('bob', 'session').subscribe());
      await vi.advanceTimersByTimeAsync(0);
      expect([count('inbound'), count('outbound')]).toEqual([1, 1]);
      await vi.advanceTimersByTimeAsync(65_000);
      expect(callable).toHaveBeenCalledTimes(2);
      show('hidden');
      await vi.advanceTimersByTimeAsync(65_000);
      expect(callable).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(50_000);
      expect(callable).toHaveBeenCalledTimes(4); // maximum hidden deadline
      await vi.advanceTimersByTimeAsync(60_000);
      revision$.next(revision(9, 9, true)); // cache cannot advance canonical epochs
      await vi.advanceTimersByTimeAsync(0);
      expect(callable).toHaveBeenCalledTimes(6); // degraded cadence
      online$.next(false);
      await vi.advanceTimersByTimeAsync(181_000);
      expect(callable).toHaveBeenCalledTimes(6);
      revision$.next(revision());
      online$.next(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(callable).toHaveBeenCalledTimes(8);
      show('visible');
      await vi.advanceTimersByTimeAsync(5_000);
      expect(callable).toHaveBeenCalledTimes(8); // recent healthy reconnection already reconciled
      revision$.next(revision(0, 1));
      await vi.advanceTimersByTimeAsync(0);
      expect([count('inbound'), count('outbound')]).toEqual([4, 5]);
      expect(onSnapshot).toHaveBeenCalledTimes(1);
      subs.forEach(sub => sub.unsubscribe());
      expect(revision$.observers).toHaveLength(0);
      expect(online$.observers).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(181_000);
      expect(callable).toHaveBeenCalledTimes(9);
    } finally {
      subs.forEach(sub => sub.unsubscribe());
      vi.useRealTimers();
    }
  });

  it('coalesce retornos recentes, mantém reconexão e invalida gerações concorrentes sem replay', async () => {
    vi.useFakeTimers();
    const subs: { unsubscribe(): void }[] = [];
    const show = (state: 'visible' | 'hidden') => {
      visibility = state;
      visibilityEvents.dispatchEvent(new Event('visibilitychange'));
    };
    try {
      let resolveOld!: (value: unknown) => void;
      callable.mockResolvedValue({ data: { items: [{ id: 'fresh' }] } });
      const inbound = vi.fn(), outbound = vi.fn();
      for (let i = 0; i < 6; i++) {
        subs.push(repo.watchInboundRequests('bob', 'other').subscribe(inbound));
        subs.push(repo.watchOutboundRequests('bob', 'profile').subscribe(outbound));
      }
      await vi.advanceTimersByTimeAsync(0);
      expect(callable).toHaveBeenCalledTimes(2);
      expect(onSnapshot).toHaveBeenCalledTimes(1);
      for (let i = 0; i < 4; i++) {
        show('hidden');
        await vi.advanceTimersByTimeAsync(2_000);
        show('visible');
        await vi.advanceTimersByTimeAsync(2_000);
      }
      expect(callable).toHaveBeenCalledTimes(2);
      online$.next(false);
      await vi.advanceTimersByTimeAsync(1_000);
      online$.next(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(callable).toHaveBeenCalledTimes(4);
      // Burst of two confirmed epochs while first callable is held.
      callable.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
      revision$.next(revision(0, 1));
      await vi.advanceTimersByTimeAsync(0);
      expect(callable).toHaveBeenCalledTimes(5);
      revision$.next(revision(0, 2));
      await vi.advanceTimersByTimeAsync(0);
      expect(callable).toHaveBeenCalledTimes(6);
      resolveOld({ data: { items: [{ id: 'obsolete' }] } });
      await vi.advanceTimersByTimeAsync(0);
      expect(outbound.mock.calls.some(([items]) => items.some((item: { id: string }) => item.id === 'obsolete'))).toBe(false);
      expect(inbound).toHaveBeenCalledTimes(12);
      // All consumers closed; no clock or canonical listener survives.
      subs.forEach(sub => sub.unsubscribe());
      expect(revision$.observers).toHaveLength(0);
      expect(online$.observers).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(181_000);
      expect(callable).toHaveBeenCalledTimes(6);
    } finally {
      subs.forEach(sub => sub.unsubscribe());
      vi.useRealTimers();
    }
  });

  it('watch inbound reutiliza a leitura backend-only sem write Firestore', async () => {
    callable.mockResolvedValue({
      data: {
        items: [],
        fetchedAt: 1,
        scanned: 0,
      },
    });

    const items = await firstValueFrom(
      repo.watchInboundRequests('bob').pipe(take(1))
    );

    expect(items).toEqual([]);
    expect(callable).toHaveBeenCalledWith({
      direction: 'inbound',
      limit: 60,
    });
  });
});
