// src/app/core/services/autentication/auth/presence/presence-dom-streams.service.ts
import { Injectable } from '@angular/core';
import { EMPTY, Observable, fromEvent } from 'rxjs';
import { distinctUntilChanged, map, startWith } from 'rxjs/operators';

export type DomStreams = {
  beforeUnload$: Observable<'beforeunload'>;
  pageHide$: Observable<'pagehide'>;
  offline$: Observable<'offline'>;
  online$: Observable<'online'>;
  visibility$: Observable<'hidden' | 'visible'>;
  storage$: Observable<StorageEvent>;
};

@Injectable({ providedIn: 'root' })
export class PresenceDomStreamsService {
  create(): DomStreams {
    const hasWindow = typeof window !== 'undefined';
    const hasDoc = typeof document !== 'undefined';

    const beforeUnload$ = hasWindow
      ? fromEvent(window, 'beforeunload').pipe(map(() => 'beforeunload' as const))
      : EMPTY;

    const pageHide$ = hasWindow
      ? fromEvent(window, 'pagehide').pipe(map(() => 'pagehide' as const))
      : EMPTY;

    const offline$ = hasWindow
      ? fromEvent(window, 'offline').pipe(map(() => 'offline' as const))
      : EMPTY;

    const online$ = hasWindow
      ? fromEvent(window, 'online').pipe(map(() => 'online' as const))
      : EMPTY;

    const visibility$ = hasDoc
      ? fromEvent(document, 'visibilitychange').pipe(
        startWith(0),
        map((): 'hidden' | 'visible' =>
          document.visibilityState === 'hidden' ? 'hidden' : 'visible'
        ),
        distinctUntilChanged()
      )
      : EMPTY;

    const storage$ = hasWindow ? fromEvent<StorageEvent>(window, 'storage') : EMPTY;

    return { beforeUnload$, pageHide$, offline$, online$, visibility$, storage$ };
  }
}
