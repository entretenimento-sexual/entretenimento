import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { RouterModule } from '@angular/router';
import { of } from 'rxjs';

import type {
  IPublicMediaViewerHandoffResult,
  IPublicMediaViewerMixedNavigation,
} from 'src/app/core/interfaces/media/i-public-media-viewer-session';
import { PublicPhotoContinuationService } from 'src/app/core/services/media/public-photo-continuation.service';
import {
  IPhotoViewerData,
  PhotoViewerComponent,
} from './photo-viewer.component';

const EMPTY_MIXED_PHOTO_CONTINUATION = {
  loadContinuation$: () => of({
    items: [],
    exhausted: true,
    failed: false,
    degraded: false,
  }),
};

type MixedPhotoViewerData = IPhotoViewerData & {
  readonly mixedNavigation: IPublicMediaViewerMixedNavigation;
};

/**
 * Adapta o viewer de foto existente a uma fila mista sem duplicar sua UI.
 *
 * A continuação específica de fotos é neutralizada nesta sessão porque a ordem
 * canônica pertence ao coordenador misto. Ao atingir uma fronteira de tipo, o
 * dialog devolve um handoff e o coordenador abre o próximo viewer.
 */
@Component({
  selector: 'app-public-mixed-photo-viewer',
  standalone: true,
  imports: [CommonModule, RouterModule, MatDialogModule, ReactiveFormsModule],
  templateUrl: './photo-viewer.component.html',
  styleUrls: ['./photo-viewer.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: PublicPhotoContinuationService,
      useValue: EMPTY_MIXED_PHOTO_CONTINUATION,
    },
  ],
})
export class PublicMixedPhotoViewerComponent extends PhotoViewerComponent {
  private readonly mixedDialogRef = inject<
    MatDialogRef<PublicMixedPhotoViewerComponent, IPublicMediaViewerHandoffResult>
  >(MatDialogRef);

  private get mixedData(): MixedPhotoViewerData {
    return this.data as MixedPhotoViewerData;
  }

  override get hasPrev(): boolean {
    return this.index > 0 || this.mixedData.mixedNavigation.hasPrevious;
  }

  override get hasNext(): boolean {
    return this.index < this.data.items.length - 1 ||
      this.mixedData.mixedNavigation.hasNext;
  }

  override get waitingForContinuation(): boolean {
    return false;
  }

  override prev(): void {
    if (this.index > 0) {
      super.prev();
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
    this.mixedDialogRef.close({
      kind: 'mixed-handoff',
      direction,
    });
  }
}
