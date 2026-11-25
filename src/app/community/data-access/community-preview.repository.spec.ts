import { TestBed } from '@angular/core/testing';
import { Functions } from '@angular/fire/functions';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { CommunityPreviewRepository } from './community-preview.repository';

describe('CommunityPreviewRepository discovery concurrency', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('compartilha somente a página normalizada em voo e preserva cursores e revogação', async () => {
    const uid$ = new BehaviorSubject<string | null>('viewer');
    const session = {
      currentAuthUser: { uid: 'viewer' },
      uid$,
      terminationVersionSnapshot: 0,
      isTerminatingSnapshot: false,
    };
    TestBed.configureTestingModule({ providers: [
      { provide: Functions, useValue: {} },
      { provide: AuthSessionService, useValue: session },
    ] });
    const repo = TestBed.inject(CommunityPreviewRepository);
    const page = { items: [], nextCursor: null, generatedAt: 123 };
    let finish!: (value: { data: typeof page }) => void;
    const load = vi.fn(() => new Promise<{ data: typeof page }>(resolve => { finish = resolve; }));
    Reflect.set(repo, 'getDiscoveryPageCallable', load);
    const one = firstValueFrom(repo.getDiscoveryPage$());
    const two = firstValueFrom(repo.getDiscoveryPage$({ cursor: null }));
    expect(load).toHaveBeenCalledTimes(1);
    load.mockResolvedValueOnce({ data: page });
    await firstValueFrom(repo.getDiscoveryPage$({ cursor: 'different' }));
    expect(load).toHaveBeenCalledTimes(2);
    finish({ data: page });
    expect(await one).toEqual(page);
    expect(await two).toEqual(page);
    const seen: unknown[] = [];
    const old = repo.getDiscoveryPage$().subscribe(value => seen.push(value));
    expect(load).toHaveBeenCalledTimes(3);
    session.isTerminatingSnapshot = true;
    session.terminationVersionSnapshot++;
    uid$.next(null);
    expect(old.closed).toBe(true);
    finish({ data: page });
    await Promise.resolve();
    expect(seen).toEqual([]);
  });
});
