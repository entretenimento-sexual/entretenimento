import { EnvironmentInjector } from '@angular/core';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  projections: new Map<string, BehaviorSubject<unknown>>(),
  callable: vi.fn(),
}));

vi.mock('@angular/fire/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
  docData: (path: string) => {
    let source = mocks.projections.get(path);
    if (!source) {
      source = new BehaviorSubject<unknown>(undefined);
      mocks.projections.set(path, source);
    }
    return source.asObservable();
  },
}));

vi.mock('@angular/fire/functions', () => ({
  httpsCallable: () => mocks.callable,
}));

import { DirectChatAvailabilityService } from './direct-chat-availability.service';

const path = 'direct_chat_access/user-a/peers/user-b';
let injector: EnvironmentInjector;

function service(): DirectChatAvailabilityService {
  return new DirectChatAvailabilityService({} as any, injector, {} as any);
}

beforeEach(() => {
  mocks.projections.clear();
  mocks.callable.mockReset();
  injector = {
    runInContext: (fn: () => unknown) => fn(),
  } as unknown as EnvironmentInjector;
});

afterEach(() => vi.restoreAllMocks());

describe('DirectChatAvailabilityService runtime reconciliation', () => {
  it('mantém dois observadores fechados e compartilha um único callable', async () => {
    let release!: (value: unknown) => void;
    mocks.callable.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const sut = service();
    const first: boolean[] = [];
    const second: boolean[] = [];
    const a = sut.observe$('user-a', 'user-b').subscribe((value) => first.push(value));
    const b = sut.observe$('user-a', 'user-b').subscribe((value) => second.push(value));
    await Promise.resolve();
    expect(mocks.callable).toHaveBeenCalledTimes(1);
    mocks.projections.get(path)?.next({ version: 1, available: true });
    expect(first.at(-1)).toBe(true);
    expect(second.at(-1)).toBe(true);
    release({ data: { reconciled: true } });
    await Promise.resolve();
    a.unsubscribe();
    b.unsubscribe();
  });

  it('não reenvia chamadas durante cooldown após falha e exige snapshot para liberar', async () => {
    mocks.callable.mockRejectedValue(new Error('temporarily unavailable'));
    const sut = service();
    expect(await firstValueFrom(sut.observe$('user-a', 'user-b'))).toBe(false);
    await Promise.resolve();
    expect(await firstValueFrom(sut.observe$('user-a', 'user-b'))).toBe(false);
    expect(mocks.callable).toHaveBeenCalledTimes(1);
    const values: boolean[] = [];
    const sub = sut.observe$('user-a', 'user-b').subscribe(v => values.push(v));
    mocks.projections.get(path)?.next({ version: 1, available: false });
    expect(values.at(-1)).toBe(false);
    mocks.projections.get(path)?.next({ version: 1, available: true });
    expect(values.at(-1)).toBe(true);
    sub.unsubscribe();
  });

  it('resposta tardia após cancelamento não produz autorização', async () => {
    let release!: (value: unknown) => void;
    mocks.callable.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const values: boolean[] = [];
    const sut = service();
    const subscription = sut.observe$('user-a', 'user-b').subscribe(v => values.push(v));
    await Promise.resolve();
    subscription.unsubscribe();
    release({ data: { reconciled: true } });
    await Promise.resolve();
    expect(values).not.toContain(true);
  });
});
