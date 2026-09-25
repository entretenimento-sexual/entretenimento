// src/app/core/services/interactions/friendship/repo/requests.repo.spec.ts
import { EnvironmentInjector } from '@angular/core';
import { firstValueFrom, take } from 'rxjs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

describe('RequestsRepo', () => {
  let RequestsRepoToken: any;
  let repo: any;

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
    repo = new RequestsRepoToken(db, env, functions);
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

    const items = await firstValueFrom(repo.listOutboundRequests('alice'));

    expect(callable).toHaveBeenCalledWith({
      direction: 'outbound',
      limit: 60,
    });
    expect(items).toHaveLength(1);
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
