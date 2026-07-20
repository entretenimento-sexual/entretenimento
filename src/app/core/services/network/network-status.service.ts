// src/app/core/services/network/network-status.service.ts
// -----------------------------------------------------------------------------
// NETWORK STATUS SERVICE
// -----------------------------------------------------------------------------
// Fonte única e Observable-first para o estado de conexão informado pelo browser.
// `navigator.onLine` é tratado como sinal operacional, não como prova de que um
// backend específico está saudável.
// -----------------------------------------------------------------------------
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { Observable, fromEvent, merge, of } from 'rxjs';
import {
  distinctUntilChanged,
  filter,
  map,
  pairwise,
  shareReplay,
  startWith,
} from 'rxjs/operators';

export interface NetworkConnectionState {
  online: boolean;
  changedAt: number;
  source: 'initial' | 'browser-online' | 'browser-offline' | 'server';
}

@Injectable({ providedIn: 'root' })
export class NetworkStatusService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);
  private readonly browserWindow = isPlatformBrowser(this.platformId)
    ? this.document.defaultView
    : null;

  readonly connectionState$: Observable<NetworkConnectionState> =
    this.buildConnectionState$().pipe(
      distinctUntilChanged((previous, current) =>
        previous.online === current.online
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly isOnline$: Observable<boolean> = this.connectionState$.pipe(
    map((state) => state.online),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly isOffline$: Observable<boolean> = this.isOnline$.pipe(
    map((online) => !online),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly reconnected$: Observable<NetworkConnectionState> =
    this.connectionState$.pipe(
      pairwise(),
      filter(([previous, current]) => !previous.online && current.online),
      map(([, current]) => current),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  isOnlineSnapshot(): boolean {
    return this.browserWindow?.navigator.onLine !== false;
  }

  private buildConnectionState$(): Observable<NetworkConnectionState> {
    const initial = this.createState(
      this.isOnlineSnapshot(),
      this.browserWindow ? 'initial' : 'server'
    );

    if (!this.browserWindow) return of(initial);

    const online$ = fromEvent(this.browserWindow, 'online').pipe(
      map(() => this.createState(true, 'browser-online'))
    );
    const offline$ = fromEvent(this.browserWindow, 'offline').pipe(
      map(() => this.createState(false, 'browser-offline'))
    );

    return merge(online$, offline$).pipe(startWith(initial));
  }

  private createState(
    online: boolean,
    source: NetworkConnectionState['source']
  ): NetworkConnectionState {
    return {
      online,
      changedAt: Date.now(),
      source,
    };
  }
}
