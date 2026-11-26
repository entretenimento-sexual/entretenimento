// src/app/core/services/interactions/friendship/repo/requests.repo.spec.ts
import { EnvironmentInjector } from '@angular/core';
import { BehaviorSubject, firstValueFrom, take } from 'rxjs';
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
    repo = new RequestsRepoToken(db, env, functions, session);
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
      await vi.advanceTimersByTimeAsync(50_000);
      expect(callable).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(callable).toHaveBeenCalledTimes(4);
      subscriptions.forEach(sub => sub.unsubscribe());
      await vi.advanceTimersByTimeAsync(120_000);
      expect(callable).toHaveBeenCalledTimes(4);
      subscriptions.push(repo.watchOutboundRequests('bob').subscribe());
      await vi.advanceTimersByTimeAsync(0);
      expect(callable).toHaveBeenCalledTimes(5);
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
      await vi.advanceTimersByTimeAsync(120_000);
      expect(callable).toHaveBeenCalledTimes(3);
    } finally {
      subscriptions.forEach(sub => sub.unsubscribe());
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
