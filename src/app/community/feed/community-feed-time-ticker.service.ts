import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import {
  EMPTY,
  Observable,
  defer,
  distinctUntilChanged,
  fromEvent,
  map,
  merge,
  of,
  shareReplay,
  switchMap,
  timer,
} from 'rxjs';

/**
 * Relógio compartilhado para rótulos relativos do domínio de Comunidades.
 *
 * Há um único ticker por aplicação, compartilhado por Mural e comentários.
 * Enquanto a aba está oculta o ticker é suspenso; ao voltar ao foreground ele
 * emite imediatamente e retoma a cadência barata de 30 segundos.
 */
@Injectable({ providedIn: 'root' })
export class CommunityFeedTimeTickerService {
  private readonly document = inject(DOCUMENT);

  readonly now$: Observable<number> = defer(() => {
    const visibility$ = merge(
      of(this.document.visibilityState),
      fromEvent(this.document, 'visibilitychange').pipe(
        map(() => this.document.visibilityState)
      )
    ).pipe(distinctUntilChanged());

    return visibility$.pipe(
      switchMap((visibilityState) =>
        visibilityState === 'hidden'
          ? EMPTY
          : timer(0, 30_000).pipe(map(() => Date.now()))
      )
    );
  }).pipe(
    shareReplay({ bufferSize: 1, refCount: true })
  );
}
