// src/app/core/services/presence/presence-dom-streams.service.ts
// Fonte canônica dos eventos de DOM usados pela presença.
//
// Objetivo:
// - normalizar eventos do browser para PresenceService
// - evitar duplicidade e "oscilações artificiais" de hidden/visible
// - manter cada tipo de evento no seu papel correto
//
// Regra importante:
// - visibility$ = SOMENTE document.visibilityState + visibilitychange
// - NÃO usar blur/focus para inferir hidden/visible
//   Motivo:
//   - blur/focus não significa invisibilidade real da aba
//   - usar blur/focus costuma gerar alternâncias falsas em navegação,
//     devtools, dialogs do browser e trocas rápidas de foco
//
// Resultado:
// - hidden/visible fica semântico e estável
// - beforeUnload/pageHide continuam separados para fluxo de saída
// - online/offline continuam separados para rede

import { Injectable } from '@angular/core';
import { fromEvent, merge, Observable, of } from 'rxjs';
import {
  auditTime,
  distinctUntilChanged,
  map,
  shareReplay,
} from 'rxjs/operators';

export type PresenceVisibilityState = 'hidden' | 'visible';
export type PresenceOfflineReason =
  | 'navigator-offline'
  | 'window-offline'
  | 'offline-event';

export interface PresenceDomStreams {
  visibility$: Observable<PresenceVisibilityState>;
  online$: Observable<'online'>;
  offline$: Observable<PresenceOfflineReason>;
  beforeUnload$: Observable<'beforeunload'>;
  pageHide$: Observable<'pagehide'>;
  storage$: Observable<StorageEvent>;
}

@Injectable({ providedIn: 'root' })
export class PresenceDomStreamsService {
  /**
   * Cache simples da estrutura de streams.
   *
   * Motivo:
   * - evita recriar listeners do DOM desnecessariamente
   * - mantém comportamento previsível se houver mais de um consumidor
   *
   * Observação:
   * - os próprios streams usam shareReplay(refCount)
   * - então listeners soltam quando não há subscriber
   */
  private cached: PresenceDomStreams | null = null;

  create(): PresenceDomStreams {
    if (this.cached) return this.cached;

    const visibility$ = this.createVisibility$();
    const online$ = this.createOnline$();
    const offline$ = this.createOffline$();
    const beforeUnload$ = this.createBeforeUnload$();
    const pageHide$ = this.createPageHide$();
    const storage$ = this.createStorage$();

    this.cached = {
      visibility$,
      online$,
      offline$,
      beforeUnload$,
      pageHide$,
      storage$,
    };

    return this.cached;
  }

  private createVisibility$(): Observable<PresenceVisibilityState> {
    if (typeof document === 'undefined') {
      return of<'visible'>('visible');
    }

    return fromEvent(document, 'visibilitychange').pipe(
      map(() => (document.visibilityState === 'hidden' ? 'hidden' : 'visible')),
      /**
       * micro-coalescência:
       * - reduz duplicidade em navegadores que disparam eventos encadeados
       * - sem deixar a presença "lenta" de forma perceptível
       */
      auditTime(25),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private createOnline$(): Observable<'online'> {
    if (typeof window === 'undefined') {
      return of<'online'>('online');
    }

    return fromEvent(window, 'online').pipe(
      map(() => 'online' as const),
      auditTime(100),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private createOffline$(): Observable<PresenceOfflineReason> {
    if (typeof window === 'undefined') {
      return of<PresenceOfflineReason>('navigator-offline');
    }

    return merge(
      fromEvent(window, 'offline').pipe(
        map(() => 'window-offline' as const)
      ),
      /**
       * fallback leve:
       * - se algum fluxo consultar navigator.onLine logo após boot
       * - não transforma isso em visibilidade
       * - é apenas uma razão coerente de offline
       */
      of(null).pipe(
        map(() =>
          typeof navigator !== 'undefined' && navigator.onLine === false
            ? ('navigator-offline' as const)
            : null
        )
      )
    ).pipe(
      map((reason) => reason ?? 'offline-event'),
      auditTime(100),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private createBeforeUnload$(): Observable<'beforeunload'> {
    if (typeof window === 'undefined') {
      return of<'beforeunload'>('beforeunload');
    }

    return fromEvent(window, 'beforeunload').pipe(
      map(() => 'beforeunload' as const),
      auditTime(25),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private createPageHide$(): Observable<'pagehide'> {
    if (typeof window === 'undefined') {
      return of<'pagehide'>('pagehide');
    }

    return fromEvent(window, 'pagehide').pipe(
      map(() => 'pagehide' as const),
      auditTime(25),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private createStorage$(): Observable<StorageEvent> {
    if (typeof window === 'undefined') {
      return new Observable<StorageEvent>((subscriber) => subscriber.complete());
    }

    return fromEvent<StorageEvent>(window, 'storage').pipe(
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }
} // Linha 177