import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
} from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { RouterModule } from '@angular/router';
import { of } from 'rxjs';

import type {
  IPublicMediaViewerHandoffResult,
  IPublicMediaViewerMixedNavigation,
} from 'src/app/core/interfaces/media/i-public-media-viewer-session';
import { PublicVideoContinuationService } from 'src/app/core/services/media/public-video-continuation.service';
import { PublicVideoShareActionsComponent } from '../public-video-share-actions/public-video-share-actions.component';
import {
  IPublicVideoViewerData,
  PublicVideoViewerComponent,
} from './public-video-viewer.component';
import { PublicVideoPlaybackFeedbackDirective } from './public-video-playback-feedback.directive';
import {
  PublicVideoViewQualificationDirective,
} from './public-video-view-qualification.directive';

const EMPTY_MIXED_VIDEO_CONTINUATION = {
  loadContinuation$: () => of({
    items: [],
    exhausted: true,
    failed: false,
    degraded: false,
  }),
};

type MixedVideoViewerData = IPublicVideoViewerData & {
  readonly mixedNavigation: IPublicMediaViewerMixedNavigation;
};

/**
 * Adapta o viewer de vídeo existente à ordem de uma sessão mista.
 *
 * Playback, retenção, refresh de URL, comentários, ratings e swipe continuam
 * no componente base. Somente a decisão de fronteira anterior/próxima muda.
 */
@Component({
  selector: 'app-public-mixed-video-viewer',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule,
    MatDialogModule,
    PublicVideoPlaybackFeedbackDirective,
    PublicVideoViewQualificationDirective,
    PublicVideoShareActionsComponent,
  ],
  templateUrl: './public-video-viewer.component.html',
  styleUrls: ['./public-video-viewer.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: PublicVideoContinuationService,
      useValue: EMPTY_MIXED_VIDEO_CONTINUATION,
    },
  ],
})
export class PublicMixedVideoViewerComponent extends PublicVideoViewerComponent {
  private readonly mixedDialogRef = inject<
    MatDialogRef<PublicMixedVideoViewerComponent, IPublicMediaViewerHandoffResult>
  >(MatDialogRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  private get mixedData(): MixedVideoViewerData {
    return this.data as MixedVideoViewerData;
  }

  override get hasPrevious(): boolean {
    return this.index > 0 || this.mixedData.mixedNavigation.hasPrevious;
  }

  override get hasNext(): boolean {
    return this.index < this.data.items.length - 1 ||
      this.mixedData.mixedNavigation.hasNext;
  }

  override get waitingForContinuation(): boolean {
    return false;
  }

  override previous(): void {
    if (this.index > 0) {
      super.previous();
      return;
    }

    if (this.mixedData.mixedNavigation.hasPrevious) {
      this.closeForHandoff('previous');
    }
  }

  override next(): void {
    if (this.index < this.data.items.length - 1) {
      super.next();
      return;
    }

    if (this.mixedData.mixedNavigation.hasNext) {
      this.closeForHandoff('next');
    }
  }

  private closeForHandoff(
    direction: IPublicMediaViewerHandoffResult['direction']
  ): void {
    this.cancelSwipeNavigation();
    this.host.nativeElement.querySelector('video')?.pause();
    this.mixedDialogRef.close({
      kind: 'mixed-handoff',
      direction,
    });
  }
}
