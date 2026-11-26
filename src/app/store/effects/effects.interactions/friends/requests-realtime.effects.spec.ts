import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { BehaviorSubject, defer, Observable, of, Subject, throwError } from 'rxjs';
import { vi } from 'vitest';
import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';
import { AccessControlService } from '@core/services/autentication/auth/access-control.service';
import * as RT from '../../../actions/actions.interactions/friends/friends-realtime.actions';
import { FriendsRequestsRealtimeEffects } from './requests-realtime.effects';

describe('FriendsRequestsRealtimeEffects / isolamento de sessão', () => {
  it('desinscreve listener antigo imediatamente ao trocar UID A para B', () => {
    const actions = new Subject<ReturnType<typeof RT.startFriendsListener>>();
    const uid = new BehaviorSubject<string | null>('user-a');
    const snapshots = new Subject<unknown[]>();
    const unsubscribe = vi.fn();
    const watchFriends = vi.fn(() => new Observable<unknown[]>((observer) => {
      const sub = snapshots.subscribe(observer);
      return () => {
        unsubscribe();
        sub.unsubscribe();
      };
    }));
    TestBed.configureTestingModule({
      providers: [
        FriendsRequestsRealtimeEffects,
        { provide: Actions, useValue: new Actions(actions) },
        { provide: AccessControlService, useValue: { authUid$: uid.asObservable() } },
        { provide: FriendshipService, useValue: { watchFriends } },
      ],
    });
    const effects = TestBed.inject(FriendsRequestsRealtimeEffects);
    const output: unknown[] = [];
    const sub = effects.listenFriends$.subscribe(action => output.push(action));

    actions.next(RT.startFriendsListener({ uid: 'user-a' }));
    expect(watchFriends).toHaveBeenCalledTimes(1);
    uid.next('user-b');
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    snapshots.next([{ id: 'stale-friend' }]);
    expect(output).toEqual([]);
    actions.next(RT.startFriendsListener({ uid: 'user-a' }));
    expect(watchFriends).toHaveBeenCalledTimes(1);
    sub.unsubscribe();
  });
  it.each([
    ['inbound', 'listenInboundRequests$', RT.startInboundRequestsListener],
    ['outbound', 'listenOutboundRequests$', RT.startOutboundRequestsListener],
  ] as const)('encerra %s após troca direta de conta e ignora ação antiga', (_, effectName, startAction) => {
    const actions = new Subject<ReturnType<typeof RT.startInboundRequestsListener> | ReturnType<typeof RT.startOutboundRequestsListener>>();
    const uid = new BehaviorSubject<string | null>('user-a');
    const snapshots = new Subject<unknown[]>();
    const cleanup = vi.fn();
    const watcher = vi.fn(() => new Observable<unknown[]>((observer) => {
      const sub = snapshots.subscribe(observer);
      return () => { cleanup(); sub.unsubscribe(); };
    }));
    TestBed.configureTestingModule({
      providers: [
        FriendsRequestsRealtimeEffects,
        { provide: Actions, useValue: new Actions(actions) },
        { provide: AccessControlService, useValue: { authUid$: uid.asObservable() } },
        { provide: FriendshipService, useValue: {
          watchInboundRequests: watcher,
          watchOutboundRequests: watcher,
        } },
      ],
    });
    const effects = TestBed.inject(FriendsRequestsRealtimeEffects);
    const output: unknown[] = [];
    const subscription = (effects[effectName] as Observable<unknown>).subscribe((action: unknown) => output.push(action));
    actions.next(startAction({ uid: 'user-a' }));
    expect(watcher).toHaveBeenCalledTimes(1);
    uid.next('user-b');
    expect(cleanup).toHaveBeenCalledTimes(1);
    snapshots.next([]);
    expect(output).toEqual([]);
    actions.next(startAction({ uid: 'user-a' }));
    expect(watcher).toHaveBeenCalledTimes(1);
    subscription.unsubscribe();
  });

  it.each(['inbound', 'outbound'] as const)('recupera %s após falha sem repetir fora da sessão', async direction => {
    vi.useFakeTimers();
    const actions = new Subject<ReturnType<typeof RT.startInboundRequestsListener> | ReturnType<typeof RT.startOutboundRequestsListener>>();
    const uid = new BehaviorSubject<string | null>('user-a');
    const error = new Error('unavailable');
    let attempts = 0;
    const watcher = vi.fn(() => defer(() => ++attempts === 1 ? throwError(() => error) : of([])));
    TestBed.configureTestingModule({
      providers: [
        FriendsRequestsRealtimeEffects,
        { provide: Actions, useValue: new Actions(actions) },
        { provide: AccessControlService, useValue: { authUid$: uid.asObservable() } },
        { provide: FriendshipService, useValue: { watchInboundRequests: watcher, watchOutboundRequests: watcher } },
      ],
    });
    const effects = TestBed.inject(FriendsRequestsRealtimeEffects);
    const stream = direction === 'inbound' ? effects.listenInboundRequests$ : effects.listenOutboundRequests$;
    const output: unknown[] = [];
    const subscription = (stream as Observable<unknown>).subscribe(action => output.push(action));
    try {
      const start = direction === 'inbound' ? RT.startInboundRequestsListener : RT.startOutboundRequestsListener;
      actions.next(start({ uid: 'user-a' }));
      expect(attempts).toBe(1);
      await vi.advanceTimersByTimeAsync(59_999);
      expect(attempts).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(attempts).toBe(2);
      expect(output).toHaveLength(2);
      expect(output[1]).toEqual(direction === 'inbound'
        ? RT.inboundRequestsChanged({ requests: [] })
        : RT.outboundRequestsChanged({ requests: [] }));
      attempts = 0;
      actions.next(start({ uid: 'user-a' }));
      expect(attempts).toBe(1);
      uid.next('user-b');
      await vi.advanceTimersByTimeAsync(120_000);
      expect(attempts).toBe(1);
    } finally {
      subscription.unsubscribe();
      vi.useRealTimers();
    }
  });
});
