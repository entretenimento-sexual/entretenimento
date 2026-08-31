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
import {
  distinctUntilChanged,
  filter,
  finalize,
  map,
  shareReplay,
  switchMap,
} from 'rxjs';

import { ImageFallbackDirective } from 'src/app/shared/directives/image-fallback.directive';
import { CommunityFeedItem } from '../data-access/community-feed.model';
import { CommunityHighlightSnapshot } from '../data-access/community-highlight.model';
import { CommunityHighlightUiService } from './community-highlight-ui.service';

export interface CommunityHighlightNavigateRequest {
  readonly event: Event;
  readonly postId: string;
}

@Component({
  selector: 'app-community-highlight-card',
  standalone: true,
  imports: [AsyncPipe, ImageFallbackDirective],
  template: `
    @if (state$ | async; as state) {
      @if (
        state.status === 'ready'
        && state.highlight
        && (state.item || state.canManage)
      ) {
        <aside class="highlight" aria-label="Publicação fixada no Mural">
          <div class="highlight__heading">
            <span class="highlight__label">
              <i class="fas fa-thumbtack" aria-hidden="true"></i>
              <strong>Publicação fixada</strong>
            </span>
            <span class="highlight__duration">
              {{ durationLabel(state.highlight) }}
            </span>
          </div>

          @if (state.item; as item) {
            <button
              class="highlight__content"
              type="button"
              [attr.aria-label]="'Ver publicação fixada de ' + item.author.label"
              (click)="navigate($event, item.postId)"
            >
              @if (item.image) {
                <span class="highlight__thumb" aria-hidden="true">
                  <img [src]="item.image.url" alt="" loading="lazy" appImageFallback />
                </span>
              } @else {
                <span class="highlight__icon" aria-hidden="true">
                  <i
                    class="fas {{ item.kind === 'location' ? 'fa-location-dot' : 'fa-message' }}"
                  ></i>
                </span>
              }

              <span class="highlight__copy">
                <span class="highlight__author">{{ item.author.label }}</span>
                <span class="highlight__preview">{{ previewText(item) }}</span>
                <span class="highlight__meta">
                  {{ metricsLabel(item) }}
                  <span aria-hidden="true">·</span>
                  Ver publicação
                </span>
              </span>
              <i class="fas fa-chevron-right highlight__chevron" aria-hidden="true"></i>
            </button>
          } @else {
            <div class="highlight__unavailable" role="status">
              <i class="fas fa-circle-exclamation" aria-hidden="true"></i>
              <span>A publicação fixada não pôde ser exibida.</span>
            </div>
          }

          @if (state.canManage) {
            <div class="highlight__management">
              <button
                type="button"
                [disabled]="pending()"
                (click)="unpin(state.communityId)"
              >
                @if (pending()) {
                  <i class="fas fa-spinner fa-spin" aria-hidden="true"></i>
                  Desafixando...
                } @else {
                  <i class="fas fa-thumbtack" aria-hidden="true"></i>
                  Desafixar do Mural
                }
              </button>
              @if (actionError()) {
                <span role="status">Não foi possível desafixar. Tente novamente.</span>
              }
            </div>
          }
        </aside>
      }
    }
  `,
  styles: [`
    :host {
      display: block;
    }

    .highlight {
      margin: 0.52rem 0 0.68rem;
      border: 1px solid color-mix(in oklab, var(--primary-color) 20%, var(--surface-border));
      border-radius: 0.9rem;
      overflow: hidden;
      background: color-mix(in oklab, var(--surface-color) 98%, var(--primary-color) 2%);
    }

    .highlight__heading {
      min-height: 2.15rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      padding: 0.36rem 0.72rem;
      border-bottom: 1px solid color-mix(in oklab, var(--surface-border) 72%, transparent);
      color: color-mix(in oklab, var(--text-color) 68%, transparent);
      font-size: 0.68rem;
    }

    .highlight__label {
      display: inline-flex;
      align-items: center;
      gap: 0.36rem;
      color: color-mix(in oklab, var(--text-color) 78%, var(--primary-color));
    }

    .highlight__label i {
      color: var(--primary-color);
      transform: rotate(-18deg);
    }

    .highlight__duration {
      white-space: nowrap;
    }

    .highlight__content {
      width: 100%;
      min-height: 4.35rem;
      display: grid;
      grid-template-columns: 2.75rem minmax(0, 1fr) auto;
      align-items: center;
      gap: 0.65rem;
      padding: 0.58rem 0.72rem;
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }

    .highlight__content:hover {
      background: color-mix(in oklab, var(--surface-color) 94%, var(--primary-color) 6%);
    }

    .highlight__content:focus-visible,
    .highlight__management button:focus-visible {
      outline: var(--focus-ring);
      outline-offset: var(--focus-offset);
    }

    .highlight__thumb,
    .highlight__icon {
      width: 2.75rem;
      height: 2.75rem;
      display: grid;
      place-items: center;
      overflow: hidden;
      border-radius: 0.7rem;
      background: color-mix(in oklab, var(--surface-color) 91%, var(--primary-color) 9%);
      color: var(--primary-color);
    }

    .highlight__thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .highlight__copy {
      min-width: 0;
      display: grid;
      gap: 0.08rem;
    }

    .highlight__author {
      overflow: hidden;
      color: var(--text-color);
      font-size: 0.76rem;
      font-weight: 750;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .highlight__preview {
      overflow: hidden;
      color: color-mix(in oklab, var(--text-color) 76%, transparent);
      font-size: 0.8rem;
      line-height: 1.35;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .highlight__meta {
      display: inline-flex;
      align-items: center;
      gap: 0.28rem;
      color: color-mix(in oklab, var(--text-color) 52%, transparent);
      font-size: 0.65rem;
    }

    .highlight__chevron {
      color: color-mix(in oklab, var(--text-color) 34%, transparent);
      font-size: 0.72rem;
    }

    .highlight__management {
      min-height: 2.25rem;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 0.65rem;
      padding: 0.28rem 0.62rem;
      border-top: 1px solid color-mix(in oklab, var(--surface-border) 62%, transparent);
    }

    .highlight__management button {
      min-height: 36px;
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.28rem 0.55rem;
      border: 0;
      border-radius: 0.55rem;
      background: transparent;
      color: color-mix(in oklab, var(--text-color) 66%, var(--primary-color));
      font: inherit;
      font-size: 0.68rem;
      font-weight: 700;
      cursor: pointer;
    }

    .highlight__management button:hover:not(:disabled) {
      background: color-mix(in oklab, var(--surface-color) 90%, var(--primary-color) 10%);
      color: var(--primary-color);
    }

    .highlight__management span,
    .highlight__unavailable {
      color: var(--error-color, #b42318);
      font-size: 0.65rem;
    }

    .highlight__unavailable {
      min-height: 3.2rem;
      display: flex;
      align-items: center;
      gap: 0.45rem;
      padding: 0.65rem 0.75rem;
    }

    @media (max-width: 30rem) {
      .highlight {
        border-radius: 0.75rem;
      }

      .highlight__duration {
        display: none;
      }

      .highlight__content {
        grid-template-columns: 2.4rem minmax(0, 1fr) auto;
        gap: 0.5rem;
        padding-inline: 0.58rem;
      }

      .highlight__thumb,
      .highlight__icon {
        width: 2.4rem;
        height: 2.4rem;
      }
    }

    :host-context(.high-contrast) .highlight {
      border: 2px solid var(--text-color);
      background: var(--surface-color);
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityHighlightCardComponent {
  private readonly highlightUi = inject(CommunityHighlightUiService);
  private readonly destroyRef = inject(DestroyRef);
  private pendingRequestId: string | null = null;

  readonly communityId = input<string>('');
  readonly navigateRequested = output<CommunityHighlightNavigateRequest>();
  readonly pending = signal(false);
  readonly actionError = signal(false);

  readonly state$ = toObservable(this.communityId).pipe(
    map((communityId) => communityId.trim()),
    filter((communityId) => communityId.length > 0),
    distinctUntilChanged(),
    switchMap((communityId) => this.highlightUi.state$(communityId)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  previewText(item: CommunityFeedItem): string {
    if (item.text) return item.text;
    if (item.kind === 'photo') return 'Foto compartilhada no Mural';
    if (item.kind === 'location') return 'Localização compartilhada no Mural';
    return 'Publicação no Mural';
  }

  metricsLabel(item: CommunityFeedItem): string {
    const reactions = item.metrics.reactionCount;
    const comments = item.metrics.commentCount;
    const reactionLabel = reactions === 1 ? '1 curtida' : `${reactions} curtidas`;
    const commentLabel = comments === 1 ? '1 resposta' : `${comments} respostas`;
    return `${reactionLabel} · ${commentLabel}`;
  }

  durationLabel(highlight: CommunityHighlightSnapshot): string {
    if (highlight.expiresAt === null) return 'Até desafixar';

    const formatter = new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    return `Até ${formatter.format(new Date(highlight.expiresAt))}`;
  }

  navigate(event: Event, postId: string): void {
    this.navigateRequested.emit({ event, postId });
  }

  unpin(communityId: string): void {
    if (this.pending()) return;

    this.pendingRequestId ??= this.createRequestId();
    this.pending.set(true);
    this.actionError.set(false);

    this.highlightUi.manage$({
      requestId: this.pendingRequestId,
      communityId,
      action: 'unpin',
    }).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.pending.set(false))
    ).subscribe({
      next: () => {
        this.pendingRequestId = null;
        this.actionError.set(false);
      },
      error: () => this.actionError.set(true),
    });
  }

  private createRequestId(): string {
    try {
      const uuid = globalThis.crypto?.randomUUID?.();
      if (uuid) return uuid;
    } catch {
      // Fallback abaixo mantém retries idempotentes para esta interação.
    }

    return `highlight-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 12)}`;
  }
}
