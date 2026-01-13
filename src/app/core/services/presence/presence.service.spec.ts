// src/app/core/services/autentication/auth/presence.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { NgZone } from '@angular/core';
import { Firestore, updateDoc, serverTimestamp } from '@angular/fire/firestore';
import { PresenceService } from './presence.service';

describe('PresenceService', () => {
  let service: PresenceService;
  let zone: NgZone;

  const updateDocMock = updateDoc as unknown as jest.Mock;
  const serverTsMock = serverTimestamp as unknown as jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    updateDocMock.mockClear();
    serverTsMock.mockClear();

    TestBed.configureTestingModule({
      providers: [PresenceService, { provide: Firestore, useValue: {} }],
    });

    service = TestBed.inject(PresenceService);
    zone = TestBed.inject(NgZone);
    expect(zone).toBeTruthy();
  });

  afterEach(() => {
    try { service.stop(); } catch { }
    jest.useRealTimers();
  });

  function lastCallArgs() {
    const calls = updateDocMock.mock.calls;
    return calls[calls.length - 1] as [any, Record<string, unknown>];
  }

  it('faz o primeiro beat imediato ao iniciar', () => {
    service.start('u1');

    expect(updateDocMock).toHaveBeenCalled();
    const [ref, data] = lastCallArgs();

    expect(ref?.__path).toBe('users/u1');
    expect('lastSeen' in data).toBe(true);
    expect((data as any).isOnline).toBe(true); // compat
  });

  it('agenda heartbeats a cada ~30s quando online', () => {
    service.start('u1');
    updateDocMock.mockClear();

    jest.advanceTimersByTime(29_000);
    expect(updateDocMock).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1_000);
    expect(updateDocMock).toHaveBeenCalledTimes(1);
    let [, data] = lastCallArgs();
    expect('lastSeen' in data).toBe(true);
    expect((data as any).isOnline).toBe(true);

    jest.advanceTimersByTime(30_000);
    expect(updateDocMock).toHaveBeenCalledTimes(2);
  });

  it('marca offline em beforeunload/offline/pagehide', () => {
    service.start('u1');
    updateDocMock.mockClear();

    window.dispatchEvent(new Event('offline'));
    expect(updateDocMock).toHaveBeenCalled();
    let [, data] = lastCallArgs();
    expect((data as any).isOnline).toBe(false);
    expect('lastOfflineAt' in data).toBe(true);

    updateDocMock.mockClear();
    window.dispatchEvent(new Event('pagehide'));
    expect(updateDocMock).toHaveBeenCalled();
    [, data] = lastCallArgs();
    expect((data as any).isOnline).toBe(false);
    expect('lastOfflineAt' in data).toBe(true);

    updateDocMock.mockClear();
    window.dispatchEvent(new Event('beforeunload'));
    expect(updateDocMock).toHaveBeenCalled();
    [, data] = lastCallArgs();
    expect((data as any).isOnline).toBe(false);
    expect('lastOfflineAt' in data).toBe(true);
  });

  it('no visibilitychange->hidden atualiza só lastSeen', () => {
    service.start('u1');
    updateDocMock.mockClear();

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(updateDocMock).toHaveBeenCalled();
    const [, data] = lastCallArgs();
    expect('lastSeen' in data).toBe(true);
    expect((data as any).isOnline).toBeUndefined();
  });

  it('stop() limpa intervalos e listeners', () => {
    service.start('u1');
    updateDocMock.mockClear();

    service.stop();
    jest.advanceTimersByTime(60_000);
    expect(updateDocMock).not.toHaveBeenCalled();

    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('beforeunload'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(updateDocMock).not.toHaveBeenCalled();
  });
});
