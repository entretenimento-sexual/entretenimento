import { describe, expect, it, vi } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { DirectChatAvailabilityService } from './direct-chat-availability.service';
import { DirectChatReconciliationCoordinator } from './direct-chat-reconciliation-coordinator';

describe('DirectChatReconciliationCoordinator', () => {
  it('compartilha uma solicitação em andamento entre observadores do mesmo par', async () => {
    const coordinator = new DirectChatReconciliationCoordinator();
    let release!: () => void;
    const request = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const first = coordinator.run('user-a', 'user-b', request);
    const second = coordinator.run('user-a', 'user-b', request);
    expect(first).toBe(second);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    release();
    await Promise.all([first, second]);
  });

  it('não repete chamadas durante cooldown depois de falha', async () => {
    const coordinator = new DirectChatReconciliationCoordinator();
    const request = vi.fn().mockRejectedValue(new Error('indisponível'));
    await coordinator.run('user-a', 'user-b', request);
    await coordinator.run('user-a', 'user-b', request);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('ignora respostas tardias e não transforma resultado de callable em permissão', async () => {
    const coordinator = new DirectChatReconciliationCoordinator();
    let resolve!: (value: unknown) => void;
    const request = vi.fn(() => new Promise<unknown>(r => { resolve = r; }));
    const pending = coordinator.run('user-a', 'user-b', request);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    resolve({ data: { reconciled: true } });
    await expect(pending).resolves.toBeUndefined();
  });
});


describe('DirectChatAvailabilityService session-bound entry points', () => {
  it('requires current owner, gate and confirmed pair; revokes and restores without polling', () => {
    const authUid$ = new BehaviorSubject<string | null>('owner');
    const canRunChatRealtime$ = new BehaviorSubject(false);
    const projection$ = new BehaviorSubject(true);
    const observe$ = vi.fn(() => projection$);
    const service = {
      accessControl: { authUid$, canRunChatRealtime$ }, observe$,
    } as unknown as DirectChatAvailabilityService;
    const values: boolean[] = [];
    const sub = DirectChatAvailabilityService.prototype.observeForCurrentUser$
      .call(service, 'peer', 'owner').subscribe(value => values.push(value));
    expect(values.at(-1)).toBe(false);
    expect(observe$).not.toHaveBeenCalled();
    canRunChatRealtime$.next(true);
    expect(observe$).toHaveBeenCalledWith('owner', 'peer');
    expect(values.at(-1)).toBe(true);
    projection$.next(false);
    expect(values.at(-1)).toBe(false);
    projection$.next(true);
    expect(values.at(-1)).toBe(true);
    authUid$.next('other');
    expect(values.at(-1)).toBe(false);
    expect(projection$.observers.length).toBe(0);
    projection$.next(true);
    expect(values.at(-1)).toBe(false);
    authUid$.next('owner');
    expect(values.at(-1)).toBe(true);
    canRunChatRealtime$.next(false);
    expect(values.at(-1)).toBe(false);
    expect(projection$.observers.length).toBe(0);
    sub.unsubscribe();
  });
});
