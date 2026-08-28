import { TestBed } from '@angular/core/testing';
import { Subscription } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { NetworkStatusService } from './network-status.service';

describe('NetworkStatusService', () => {
  it('publica offline, online e reconexão a partir dos eventos do browser', () => {
    TestBed.configureTestingModule({});
    const service = TestBed.inject(NetworkStatusService);
    const onlineStates: boolean[] = [];
    const reconnectSources: string[] = [];
    const subscriptions = new Subscription();

    subscriptions.add(
      service.isOnline$.subscribe((online) => onlineStates.push(online))
    );
    subscriptions.add(
      service.reconnected$.subscribe((state) => {
        reconnectSources.push(state.source);
      })
    );

    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));

    expect(onlineStates.slice(-2)).toEqual([false, true]);
    expect(reconnectSources).toEqual(['browser-online']);

    subscriptions.unsubscribe();
    TestBed.resetTestingModule();
  });
});
