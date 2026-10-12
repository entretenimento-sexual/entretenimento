import { describe, expect, it, vi } from 'vitest';
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
