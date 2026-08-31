import { AsyncPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import {
  distinctUntilChanged,
  filter,
  finalize,
  map,
  shareReplay,
  switchMap,
} from 'rxjs';

import { CommunityHighlightDuration } from '../data-access/community-highlight.model';
import { CommunityHighlightUiService } from './community-highlight-ui.service';

@Component({
  selector: 'app-community-highlight-menu-action',
  standalone: true,
  imports: [AsyncPipe, ReactiveFormsModule],
  template: `
    @if (state$ | async; as state) {
      @if (state.status === 'ready' && state.canManage) {
        <div class="highlight-action">
          @if (state.highlight?.targetId === normalizedPostId()) {
            <button
              class="highlight-action__menu-button"
              type="button"
              [disabled]="pending()"
              (click)="unpin(state.communityId)"
            >
              @if (pending()) {
                <i class="fas fa-spinner fa-spin" aria-hidden="true"></i>
                <span>Desafixando...</span>
              } @else {
                <i class="fas fa-thumbtack" aria-hidden="true"></i>
                <span>Desafixar do Mural</span>
              }
            </button>
          } @else {
            <button
              class="highlight-action__menu-button"
              type="button"
              [attr.aria-expanded]="expanded()"
              [disabled]="pending()"
              (click)="toggleEditor()"
            >
              <i class="fas fa-thumbtack" aria-hidden="true"></i>
              <span>
                {{ state.highlight ? 'Substituir publicação fixada' : 'Fixar no Mural' }}
              </span>
            </button>

            @if (expanded()) {
              <div
                class="highlight-action__editor"
                role="group"
                aria-label="Duração da publicação fixada"
                (click)="$event.stopPropagation()"
              >
                <label [for]="'community-highlight-duration-' + normalizedPostId()">
                  Manter fixada por
                </label>
                <select
                  [id]="'community-highlight-duration-' + normalizedPostId()"
                  [formControl]="duration"
                  [disabled]="pending()"
                >
                  <option value="24h">24 horas</option>
                  <option value="3d">3 dias</option>
                  <option value="7d">7 dias</option>
                  <option value="30d">30 dias</option>
                  <option value="until_unpinned">Até desafixar</option>
                </select>
                <div class="highlight-action__editor-actions">
                  <button
                    type="button"
                    [disabled]="pending()"
                    (click)="cancelEditor()"
                  >
                    Cancelar
                  </button>
                  <button
                    class="is-primary"
                    type="button"
                    [disabled]="pending()"
                    (click)="pin(state.communityId)"
                  >
                    @if (pending()) {
                      <i class="fas fa-spinner fa-spin" aria-hidden="true"></i>
                      Fixando...
                    } @else {
                      Fixar
                    }
                  </button>
                </div>
              </div>
            }
          }

          @if (actionError()) {
            <span class="highlight-action__error" role="status">
              Não foi possível alterar o destaque. Tente novamente.
            </span>
          }
        </div>
      }
    }
  `,
  styles: [`
    :host {
      display: contents;
    }

    .highlight-action {
      display: contents;
    }

    .highlight-action__menu-button {
      width: 100%;
      min-height: 44px;
      display: flex;
      align-items: center;
      gap: 0.55rem;
      padding: 0.52rem 0.72rem;
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }

    .highlight-action__menu-button:hover:not(:disabled) {
      background: color-mix(in oklab, var(--surface-color) 92%, var(--primary-color) 8%);
      color: var(--primary-color);
    }

    .highlight-action__menu-button i {
      width: 1rem;
      color: color-mix(in oklab, var(--text-color) 64%, var(--primary-color));
      text-align: center;
    }

    .highlight-action__editor {
      display: grid;
      gap: 0.42rem;
      padding: 0.55rem 0.65rem 0.65rem;
      border-top: 1px solid color-mix(in oklab, var(--surface-border) 72%, transparent);
      background: color-mix(in oklab, var(--surface-color) 98%, var(--primary-color) 2%);
    }

    .highlight-action__editor label {
      color: color-mix(in oklab, var(--text-color) 64%, transparent);
      font-size: 0.66rem;
      font-weight: 700;
    }

    .highlight-action__editor select {
      min-height: 40px;
      width: 100%;
      border: 1px solid var(--surface-border);
      border-radius: 0.55rem;
      padding: 0.35rem 0.5rem;
      background: var(--surface-color);
      color: var(--text-color);
      font: inherit;
      font-size: 0.72rem;
    }

    .highlight-action__editor-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.4rem;
    }

    .highlight-action__editor-actions button {
      min-height: 38px;
      padding: 0.35rem 0.62rem;
      border: 1px solid var(--surface-border);
      border-radius: 0.55rem;
      background: var(--surface-color);
      color: var(--text-color);
      font: inherit;
      font-size: 0.68rem;
      font-weight: 700;
      cursor: pointer;
    }

    .highlight-action__editor-actions button.is-primary {
      border-color: var(--primary-color);
      background: var(--primary-color);
      color: var(--primary-contrast, #fff);
    }

    .highlight-action__menu-button:focus-visible,
    .highlight-action__editor select:focus-visible,
    .highlight-action__editor-actions button:focus-visible {
      outline: var(--focus-ring);
      outline-offset: var(--focus-offset);
    }

    .highlight-action__error {
      display: block;
      padding: 0.25rem 0.65rem 0.5rem;
      color: var(--error-color, #b42318);
      font-size: 0.64rem;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityHighlightMenuActionComponent {
  private readonly highlightUi = inject(CommunityHighlightUiService);
  private readonly destroyRef = inject(DestroyRef);
  private pendingRequestId: string | null = null;
  private pendingRequestFingerprint: string | null = null;

  readonly communityId = input<string>('');
  readonly postId = input<string>('');
  readonly completed = output<void>();
  readonly expanded = signal(false);
  readonly pending = signal(false);
  readonly actionError = signal(false);
  readonly duration = new FormControl<CommunityHighlightDuration>('7d', {
    nonNullable: true,
  });

  readonly state$ = toObservable(this.communityId).pipe(
    map((communityId) => communityId.trim()),
    filter((communityId) => communityId.length > 0),
    distinctUntilChanged(),
    switchMap((communityId) => this.highlightUi.state$(communityId)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  normalizedPostId(): string {
    return this.postId().trim();
  }

  toggleEditor(): void {
    if (this.pending()) return;
    this.actionError.set(false);
    this.expanded.update((current) => !current);
  }

  cancelEditor(): void {
    if (this.pending()) return;
    this.expanded.set(false);
    this.actionError.set(false);
    this.pendingRequestId = null;
    this.pendingRequestFingerprint = null;
    this.duration.setValue('7d');
  }

  pin(communityId: string): void {
    const postId = this.normalizedPostId();
    if (!postId || this.pending()) return;

    const duration = this.duration.value;
    const fingerprint = `pin:${communityId}:${postId}:${duration}`;
    if (this.pendingRequestFingerprint !== fingerprint) {
      this.pendingRequestId = this.createRequestId();
      this.pendingRequestFingerprint = fingerprint;
    }

    this.runAction({
      requestId: this.pendingRequestId!,
      communityId,
      action: 'pin',
      targetType: 'feed_post',
      targetId: postId,
      duration,
    });
  }

  unpin(communityId: string): void {
    if (this.pending()) return;

    const fingerprint = `unpin:${communityId}`;
    if (this.pendingRequestFingerprint !== fingerprint) {
      this.pendingRequestId = this.createRequestId();
      this.pendingRequestFingerprint = fingerprint;
    }

    this.runAction({
      requestId: this.pendingRequestId!,
      communityId,
      action: 'unpin',
    });
  }

  private runAction(request: Parameters<CommunityHighlightUiService['manage$']>[0]): void {
    this.pending.set(true);
    this.actionError.set(false);

    this.highlightUi.manage$(request).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.pending.set(false))
    ).subscribe({
      next: () => {
        this.pendingRequestId = null;
        this.pendingRequestFingerprint = null;
        this.expanded.set(false);
        this.actionError.set(false);
        this.duration.setValue('7d');
        this.completed.emit();
      },
      error: () => this.actionError.set(true),
    });
  }

  private createRequestId(): string {
    try {
      const uuid = globalThis.crypto?.randomUUID?.();
      if (uuid) return uuid;
    } catch {
      // Fallback abaixo mantém a mesma tentativa idempotente em retries.
    }

    return `highlight-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 12)}`;
  }
}
