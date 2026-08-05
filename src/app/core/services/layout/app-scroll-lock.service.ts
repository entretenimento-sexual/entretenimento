import { DOCUMENT } from '@angular/common';
import {
  Injectable,
  Renderer2,
  RendererFactory2,
  inject,
} from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { distinctUntilChanged, shareReplay } from 'rxjs/operators';

const PRIMARY_SCROLL_CONTAINER_SELECTOR =
  '[data-app-scroll-container="primary"]';
const SCROLL_LOCK_CLASS = 'app-scroll-container--locked';

/**
 * Coordena o bloqueio do container rolável principal da aplicação.
 *
 * O shell autenticado usa um scroll container interno em vez do document.
 * Por isso, o BlockScrollStrategy do CDK protege o viewport, mas não consegue
 * bloquear sozinho esse container. O serviço usa tokens aninháveis para que
 * overlays concorrentes não liberem a rolagem uns dos outros.
 */
@Injectable({ providedIn: 'root' })
export class AppScrollLockService {
  private readonly document = inject(DOCUMENT);
  private readonly renderer: Renderer2 = inject(
    RendererFactory2
  ).createRenderer(null, null);

  private readonly activeLocks = new Set<symbol>();
  private readonly lockedSubject = new BehaviorSubject(false);
  private lockedElement: HTMLElement | null = null;
  private lockedScrollTop = 0;

  readonly locked$: Observable<boolean> = this.lockedSubject.asObservable().pipe(
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  acquire(scope = 'overlay'): () => void {
    const token = Symbol(scope);
    this.activeLocks.add(token);

    if (this.activeLocks.size === 1) {
      this.enableLock();
    }

    let released = false;

    return () => {
      if (released) {
        return;
      }

      released = true;
      this.activeLocks.delete(token);

      if (this.activeLocks.size === 0) {
        this.disableLock();
      }
    };
  }

  private enableLock(): void {
    const target = this.resolveScrollContainer();
    this.lockedElement = target;
    this.lockedScrollTop = target?.scrollTop ?? 0;

    if (target) {
      this.renderer.addClass(target, SCROLL_LOCK_CLASS);
    }

    this.lockedSubject.next(true);
  }

  private disableLock(): void {
    const target = this.lockedElement;

    if (target) {
      this.renderer.removeClass(target, SCROLL_LOCK_CLASS);
      target.scrollTop = this.lockedScrollTop;
    }

    this.lockedElement = null;
    this.lockedScrollTop = 0;
    this.lockedSubject.next(false);
  }

  private resolveScrollContainer(): HTMLElement | null {
    const primary = this.document.querySelector<HTMLElement>(
      PRIMARY_SCROLL_CONTAINER_SELECTOR
    );

    if (primary) {
      return primary;
    }

    return (this.document.scrollingElement as HTMLElement | null) ??
      this.document.documentElement ??
      null;
  }
}
